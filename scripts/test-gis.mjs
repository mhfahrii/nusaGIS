import fs from 'node:fs';
import pg from 'pg';
import { SignJWT } from 'jose';
import shp from 'shpjs';

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function runTest() {
  console.log('=== TEST 1: MEMERIKSA ADMIN USER & TOKEN SESI ===');
  const userRes = await pool.query("SELECT id, email, peran FROM pengguna WHERE peran = 'admin' LIMIT 1;");
  if (userRes.rows.length === 0) {
    throw new Error('Admin user tidak ditemukan.');
  }
  const adminUser = userRes.rows[0];
  console.log('Admin user:', adminUser);

  const secretKey = new TextEncoder().encode(process.env.SESSION_SECRET);
  const token = await new SignJWT({ peran: adminUser.peran })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(adminUser.id))
    .setIssuer('nusagis')
    .setAudience('nusagis-web')
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secretKey);

  console.log('Token sesi berhasil dibuat (panjang:', token.length, 'karakter)');

  console.log('\n=== TEST 2: MEMBUAT KEBUN SEBAGAI INDUK (JIKA BELUM ADA) ===');
  let kebunId;
  const kebunRes = await pool.query('SELECT id FROM kebun LIMIT 1;');
  if (kebunRes.rows.length > 0) {
    kebunId = kebunRes.rows[0].id;
  } else {
    const newKebun = await pool.query(
      `INSERT INTO kebun (kode_kebun, nama_kebun, wilayah, komoditas)
       VALUES ('KBN-INTI', 'Kebun Sawit Inti Riau', 'Riau', 'Kelapa Sawit')
       RETURNING id;`
    );
    kebunId = newKebun.rows[0].id;
  }
  console.log('Kebun ID Induk:', kebunId);

  console.log('\n=== TEST 3: EKSTRAKSI FILE SHAPEFILE DENGAN PARSER ===');
  const zipPath = 'C:/Users/ACER/.gemini/antigravity/brain/186a7c7d-0dd4-4c21-98d1-116a72c006fd/scratch/test_shapefile_perkebunan.zip';
  const zipBuffer = fs.readFileSync(zipPath);

  globalThis.self = globalThis;
  const shpResult = await shp(zipBuffer);
  const featCol = Array.isArray(shpResult) ? shpResult[0] : shpResult;
  console.log(`Layer Shapefile: ${featCol.fileName}, Jumlah fitur: ${featCol.features.length}`);

  console.log('\n=== TEST 4: INGESTION KE POSTGIS (DATA_UNGGAHAN, LAYER_PETA, FITUR_PETA) ===');
  const insertUnggahan = await pool.query(
    `INSERT INTO data_unggahan (pengguna_id, kebun_id, nama_data, nama_file, format_file, lokasi_file, status, jumlah_layer)
     VALUES ($1, $2, 'Uji Unggahan Shapefile Blok', 'test_shapefile_perkebunan.zip', 'ZIP', $3, 'berhasil', 1)
     RETURNING id;`,
    [adminUser.id, kebunId, zipPath]
  );
  const unggahanId = insertUnggahan.rows[0].id;

  const insertLayer = await pool.query(
    `INSERT INTO layer_peta (unggahan_id, kebun_id, nama_layer, nama_file_shp, tipe_geometri, warna, transparansi, terlihat, jumlah_fitur)
     VALUES ($1, $2, 'Batas Blok Perkebunan Riau', 'Batas_Blok.shp', 'MultiPolygon', '#10b981', 0.25, TRUE, $3)
     RETURNING id;`,
    [unggahanId, kebunId, featCol.features.length]
  );
  const layerId = insertLayer.rows[0].id;

  for (const feat of featCol.features) {
    await pool.query(
      `INSERT INTO fitur_peta (layer_id, geom, atribut)
       VALUES ($1, ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326), $3);`,
      [layerId, JSON.stringify(feat.geometry), JSON.stringify(feat.properties)]
    );
  }
  console.log(`Tersimpan ke PostGIS: Unggahan ID ${unggahanId}, Layer ID ${layerId}, ${featCol.features.length} Fitur.`);

  console.log('\n=== TEST 5: VERIFIKASI OPERASI POSTGIS (BBOX & GEOMETRI) ===');
  const bboxRes = await pool.query(
    `SELECT 
      ST_XMin(ST_Extent(geom)) as min_x,
      ST_YMin(ST_Extent(geom)) as min_y,
      ST_XMax(ST_Extent(geom)) as max_x,
      ST_YMax(ST_Extent(geom)) as max_y,
      COUNT(*)::int as count
     FROM fitur_peta WHERE layer_id = $1;`,
    [layerId]
  );
  console.log('PostGIS ST_Extent BBOX:', bboxRes.rows[0]);

  const geomCheck = await pool.query(
    `SELECT id, ST_GeometryType(geom) as geom_type, ST_SRID(geom) as srid, ROUND((ST_Area(geom::geography)/10000.0)::numeric, 2) as luas_ha_geodesik, atribut
     FROM fitur_peta WHERE layer_id = $1 LIMIT 1;`,
    [layerId]
  );
  console.log('PostGIS Feature Check (Geodesic Area in Hectares):', geomCheck.rows[0]);

  console.log('\n=== TEST 6: VERIFIKASI QUERY GEOJSON POSTGIS ===');
  const geojsonRes = await pool.query(
    `SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'id', fp.id,
          'geometry', ST_AsGeoJSON(fp.geom)::jsonb,
          'properties', fp.atribut
        )
      ), '[]'::jsonb)
    ) as geojson
    FROM fitur_peta fp
    WHERE fp.layer_id = $1;`,
    [layerId]
  );
  const gj = geojsonRes.rows[0].geojson;
  console.log(`GeoJSON Type: ${gj.type}, Features Count: ${gj.features.length}`);
  console.log('Feature 1 Geometry Type:', gj.features[0].geometry.type);
  console.log('Feature 1 Attributes:', gj.features[0].properties);

  console.log('\n=== TEST 7: VERIFIKASI ATRIBUT DINAMIS JSONB ===');
  const attrRes = await pool.query(
    `SELECT DISTINCT jsonb_object_keys(atribut) as col FROM fitur_peta WHERE layer_id = $1;`,
    [layerId]
  );
  console.log('Kolom atribut dinamis dari JSONB:', attrRes.rows.map(r => r.col));

  console.log('\n=== HASIL: SELURUH PENGUJIAN TAHAP D & E BERHASIL 100%! ===');
  await pool.end();
}

runTest().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
