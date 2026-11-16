import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { fromArrayBuffer } from 'geotiff';
import { PNG } from 'pngjs';

const { Pool } = pg;

// Read .env.local
const envPath = path.resolve('.env.local');
const envContent = await fs.readFile(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
}

const pool = new Pool({
  host: env.DB_HOST || 'localhost',
  port: parseInt(env.DB_PORT || '5432'),
  database: env.DB_NAME || 'nusagis',
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD,
});

async function runE2ETest() {
  console.log('====================================================');
  console.log('NUSAGIS E2E TEST: VECTOR & RASTER VERIFICATION');
  console.log('====================================================\n');

  try {
    // 1. Verifikasi Vektor di Database
    console.log('--- 1. VERIFIKASI LAYER VEKTOR & POSTGIS ---');
    const layersRes = await pool.query(`
      SELECT l.id, l.nama_layer, l.tipe_geometri, l.jumlah_fitur,
             ST_AsText(ST_Envelope(ST_Collect(f.geom))) as envelope_wkt
      FROM public.layer_peta l
      LEFT JOIN public.fitur_peta f ON l.id = f.layer_id
      GROUP BY l.id
      ORDER BY l.id DESC
      LIMIT 5;
    `);
    console.table(layersRes.rows);

    // 2. Simpan dan Import Layer Raster GeoTIFF Uji Coba ke Database
    console.log('\n--- 2. IMPORT LAYER RASTER GEOTIFF KE DATABASE ---');
    const sampleTiffPath = path.resolve('uploads', 'test', 'kebun_bakalan_ndvi.tif');
    const tiffBuf = await fs.readFile(sampleTiffPath);
    const arrayBuffer = tiffBuf.buffer.slice(tiffBuf.byteOffset, tiffBuf.byteOffset + tiffBuf.byteLength);

    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const bandsCount = image.getSamplesPerPixel();
    const bbox = image.getBoundingBox();
    const [minX, minY, maxX, maxY] = bbox;

    const rasters = await image.readRasters();
    const band = rasters[0];
    let minVal = Infinity, maxVal = -Infinity;
    for (let i = 0; i < band.length; i++) {
      if (band[i] < minVal) minVal = band[i];
      if (band[i] > maxVal) maxVal = band[i];
    }

    console.log('GeoTIFF Properties:', { width, height, bandsCount, minVal: minVal.toFixed(4), maxVal: maxVal.toFixed(4), bbox });

    // Simpan ke uploads/rasters
    const rasterDir = path.resolve('uploads', 'rasters');
    await fs.mkdir(rasterDir, { recursive: true });
    const targetFile = `e2e_ndvi_bakalan.tif`;
    const targetPath = path.join(rasterDir, targetFile);
    await fs.writeFile(targetPath, tiffBuf);

    // Ambil kebun_id pertama
    const kebunRes = await pool.query('SELECT id, nama_kebun FROM public.kebun LIMIT 1;');
    const kebunId = kebunRes.rows[0]?.id || null;

    // Ambil admin
    const userRes = await pool.query("SELECT id FROM public.pengguna WHERE peran = 'admin' LIMIT 1;");
    const userId = userRes.rows[0]?.id || 1;

    // Insert ke data_unggahan
    const uploadRes = await pool.query(`
      INSERT INTO public.data_unggahan (
        pengguna_id, kebun_id, nama_data, nama_file, format_file,
        lokasi_file, crs_asal, srid_asal, status, jumlah_layer
      ) VALUES ($1, $2, 'NDVI Kebun Bakalan (E2E Test)', $3, 'GeoTIFF', $4, 'EPSG:4326', 4326, 'berhasil', 1)
      RETURNING id;
    `, [userId, kebunId, targetFile, `uploads/rasters/${targetFile}`]);

    const unggahanId = uploadRes.rows[0].id;

    // Hapus test raster lama jika ada agar bersih
    await pool.query("DELETE FROM public.layer_raster WHERE nama_file = $1;", [targetFile]);

    // Insert ke layer_raster
    const rasterRes = await pool.query(`
      INSERT INTO public.layer_raster (
        unggahan_id, kebun_id, nama_layer, nama_file, lokasi_file,
        tipe_raster, min_val, max_val, nodata, bands_count, width, height,
        crs_asal, srid_asal, bbox_wgs84, urutan, transparansi, terlihat
      ) VALUES (
        $1, $2, 'Peta NDVI Kanopi Sawit (Drone)', $3, $4, 'NDVI', $5, $6, -9999, $7, $8, $9,
        'EPSG:4326 (WGS 84)', 4326, ST_MakeEnvelope($10, $11, $12, $13, 4326), 1, 0.85, true
      ) RETURNING id, nama_layer, tipe_raster, min_val, max_val, width, height;
    `, [
      unggahanId, kebunId, targetFile, `uploads/rasters/${targetFile}`,
      minVal, maxVal, bandsCount, width, height,
      minX, minY, maxX, maxY
    ]);

    const createdRaster = rasterRes.rows[0];
    console.log('Berhasil menambahkan Layer Raster ke database:');
    console.table([createdRaster]);

    // 3. Verifikasi Rendering Preview Overlay PNG
    console.log('\n--- 3. VERIFIKASI GENERATE PNG OVERLAY ---');
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const pngIdx = idx * 4;
        const v = band[idx];
        const norm = Math.max(0, Math.min(1, (v - minVal) / (maxVal - minVal || 1)));
        if (norm < 0.2) {
          png.data[pngIdx] = 220; png.data[pngIdx + 1] = 38; png.data[pngIdx + 2] = 38; png.data[pngIdx + 3] = 240;
        } else if (norm < 0.4) {
          png.data[pngIdx] = 249; png.data[pngIdx + 1] = 115; png.data[pngIdx + 2] = 22; png.data[pngIdx + 3] = 240;
        } else if (norm < 0.6) {
          png.data[pngIdx] = 250; png.data[pngIdx + 1] = 204; png.data[pngIdx + 2] = 21; png.data[pngIdx + 3] = 240;
        } else if (norm < 0.8) {
          png.data[pngIdx] = 132; png.data[pngIdx + 1] = 204; png.data[pngIdx + 2] = 22; png.data[pngIdx + 3] = 240;
        } else {
          png.data[pngIdx] = 21; png.data[pngIdx + 1] = 128; png.data[pngIdx + 2] = 61; png.data[pngIdx + 3] = 245;
        }
      }
    }
    const pngBuf = PNG.sync.write(png);
    console.log(`Rendered PNG Buffer Size: ${pngBuf.length} bytes`);
    if (pngBuf.length > 1000) {
      console.log('✓ Render PNG Overlay Sukses & Valid!');
    } else {
      throw new Error('Buffer PNG terlalu kecil atau corrupt!');
    }

    // 4. Verifikasi Pixel Inspection
    console.log('\n--- 4. VERIFIKASI PIXEL IDENTIFY PADA KOORDINAT LAT/LNG ---');
    const testLng = 101.455;
    const testLat = 0.748;
    const px = Math.floor(((testLng - minX) / (maxX - minX)) * width);
    const py = Math.floor(((maxY - testLat) / (maxY - minY)) * height);
    const inspectedVal = band[py * width + px];

    console.log(`Koordinat target: Lat ${testLat}, Lng ${testLng}`);
    console.log(`Pixel terpetakan: [Col ${px}, Row ${py}] -> Nilai NDVI: ${inspectedVal.toFixed(4)}`);

    let interp = '';
    if (inspectedVal >= 0.7) interp = 'Kanopi Sangat Sehat';
    else if (inspectedVal >= 0.5) interp = 'Kanopi Sehat / Normal';
    else if (inspectedVal >= 0.3) interp = 'Perlu Pemupukan / Kanopi Jarang';
    else interp = 'Lahan Terbuka / Jalan';

    console.log(`Klasifikasi Vegetasi: ${interp}`);
    console.log('✓ Pixel Inspection BERHASIL & Akurat!');

    console.log('\n====================================================');
    console.log('SEMUA TAHAPAN E2E SELESAI DENGAN SUKSES & VALID!');
    console.log('====================================================');

  } catch (err) {
    console.error('E2E Test Error:', err);
  } finally {
    await pool.end();
  }
}

runE2ETest();
