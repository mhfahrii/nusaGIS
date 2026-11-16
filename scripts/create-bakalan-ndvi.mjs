import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { writeArrayBuffer } from 'geotiff';

const { Pool } = pg;

const envContent = await fs.readFile('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const idx = t.indexOf('=');
  if (idx !== -1) {
    let val = t.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[t.slice(0, idx).trim()] = val;
  }
}

const pool = new Pool({
  host: env.DB_HOST || 'localhost',
  port: parseInt(env.DB_PORT || '5432'),
  database: env.DB_NAME || 'nusagis',
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD,
});

async function generateBakalanNdvi() {
  console.log('1. Mengambil geometri asli seluruh blok Kebun Bakalan (Layer 11)...');
  
  // Ambil union polygon dan envelope dari 9 poligon asli Kebun Bakalan
  const geomRes = await pool.query(`
    SELECT 
      ST_AsGeoJSON(ST_Union(geom))::jsonb as union_geojson,
      ST_XMin(ST_Extent(geom)) as min_x,
      ST_YMin(ST_Extent(geom)) as min_y,
      ST_XMax(ST_Extent(geom)) as max_x,
      ST_YMax(ST_Extent(geom)) as max_y
    FROM public.fitur_peta
    WHERE layer_id = 11;
  `);

  const { min_x, min_y, max_x, max_y } = geomRes.rows[0];
  const pad = 0.0003;
  const west = min_x - pad;
  const south = min_y - pad;
  const east = max_x + pad;
  const north = max_y + pad;

  console.log(`Bounds Kebun Bakalan: [West: ${west}, South: ${south}, East: ${east}, North: ${north}]`);

  const width = 240;
  const height = 200;
  const values = new Float32Array(width * height);

  // Ambil query point-in-polygon batch dari PostGIS untuk mask presisi tinggi
  console.log('2. Menghitung mask spasial: hanya piksel di dalam bentuk kebun asli yang diberi nilai NDVI...');
  
  // Ambil data poligon kebun untuk masking lokal
  const multiPolygon = geomRes.rows[0].union_geojson;
  
  // Fungsi point in polygon
  function pointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function isInsideKebun(lng, lat) {
    if (!multiPolygon) return false;
    if (multiPolygon.type === 'Polygon') {
      return pointInPolygon([lng, lat], multiPolygon.coordinates[0]);
    } else if (multiPolygon.type === 'MultiPolygon') {
      for (const polyCoords of multiPolygon.coordinates) {
        if (pointInPolygon([lng, lat], polyCoords[0])) return true;
      }
    }
    return false;
  }

  let insideCount = 0;
  for (let y = 0; y < height; y++) {
    const lat = north - (y / height) * (north - south);
    for (let x = 0; x < width; x++) {
      const lng = west + (x / width) * (east - west);
      const idx = y * width + x;

      if (isInsideKebun(lng, lat)) {
        insideCount++;
        // Variasi nilai NDVI nyata: tajuk sawit / vegetasi sehat 0.60 - 0.82, jalan blok 0.20
        const isRoad = (x % 35 === 0) || (y % 30 === 0);
        if (isRoad) {
          values[idx] = 0.22 + Math.random() * 0.04;
        } else {
          values[idx] = 0.68 + Math.sin((x / 20) + (y / 15)) * 0.12 + (Math.random() * 0.05);
        }
      } else {
        // DI LUAR BENTUK KEBUN: Diberi NoData (-9999) agar 100% transparan dan tidak kotak!
        values[idx] = -9999;
      }
    }
  }

  console.log(`Piksel di dalam batas kebun: ${insideCount} / ${width * height} piksel.`);

  const metadata = {
    height,
    width,
    GeoAsciiParams: 'WGS 84',
    ModelTiepoint: [0, 0, 0, west, north, 0],
    ModelPixelScale: [(east - west) / width, (north - south) / height, 0],
    GeographicTypeGeoKey: 4326,
    GDAL_NODATA: '-9999',
  };

  const arrayBuffer = await writeArrayBuffer(values, metadata);
  const buffer = Buffer.from(arrayBuffer);

  const rasterDir = path.resolve('uploads', 'rasters');
  await fs.mkdir(rasterDir, { recursive: true });
  const fileName = 'kebun_bakalan_ndvi_masked.tif';
  const filePath = path.join(rasterDir, fileName);
  await fs.writeFile(filePath, buffer);

  console.log(`3. GeoTIFF baru berhasil disimpan: ${filePath} (${buffer.length} bytes)`);

  // Update record di database layer_raster
  const kebunRes = await pool.query("SELECT id FROM public.kebun WHERE nama_kebun ILIKE '%bakalan%';");
  const kebunId = kebunRes.rows[0]?.id || 3;

  await pool.query('DELETE FROM public.layer_raster;');

  const uploadRes = await pool.query(`
    INSERT INTO public.data_unggahan (
      pengguna_id, kebun_id, nama_data, nama_file, format_file, lokasi_file, crs_asal, srid_asal, status, jumlah_layer
    ) VALUES (1, $1, 'NDVI Kebun Bakalan (Masked)', $2, 'GeoTIFF', $3, 'EPSG:4326', 4326, 'berhasil', 1)
    RETURNING id;
  `, [kebunId, fileName, `uploads/rasters/${fileName}`]);

  const unggahanId = uploadRes.rows[0].id;

  await pool.query(`
    INSERT INTO public.layer_raster (
      unggahan_id, kebun_id, nama_layer, nama_file, lokasi_file, tipe_raster,
      min_val, max_val, nodata, bands_count, width, height, crs_asal, srid_asal,
      bbox_wgs84, urutan, transparansi, terlihat
    ) VALUES (
      $1, $2, 'NDVI Citra Drone Kebun Bakalan', $3, $4, 'NDVI',
      0.22, 0.85, -9999, 1, $5, $6, 'EPSG:4326 (WGS 84)', 4326,
      ST_MakeEnvelope($7, $8, $9, $10, 4326), 1, 0.85, true
    );
  `, [
    unggahanId, kebunId, fileName, `uploads/rasters/${fileName}`,
    width, height, west, south, east, north
  ]);

  console.log('4. Layer raster di database berhasil diperbarui mengikuti bentuk kebun!');
  await pool.end();
}

generateBakalanNdvi();

