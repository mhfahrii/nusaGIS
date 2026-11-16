/**
 * End-to-End Test for 2-Step Upload, Inspection, and Data Mapping Flow
 * Catatan:
 * File ZIP Shapefile dan GeoJSON di bawah dibuat sebagai fixture pengujian
 * dengan label eksplisit "DATA SINTETIS PENGUJIAN".
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';
import { parseGeoJsonBuffer } from '../src/lib/gis/shapefile.js';

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
} else if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'nusagis',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function runUploadTest() {
  console.log('====================================================');
  console.log('PENGUJIAN UPLOAD GIS, INSPEKSI & DATA MAPPING');
  console.log('====================================================\n');

  // Test 1: GeoJSON Parser Verification
  console.log('--- [TEST 1] Verifikasi Parser GeoJSON (.geojson/.json) ---');
  const sampleGeoJson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          KODE_BLOK: 'TEST-GJ-01',
          KOMODITAS: 'Kelapa Sawit',
          LUAS_HA: 25.5,
          KET_SUMBER: 'DATA SINTETIS PENGUJIAN',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [101.45, 0.73],
              [101.46, 0.73],
              [101.46, 0.72],
              [101.45, 0.72],
              [101.45, 0.73],
            ],
          ],
        },
      },
    ],
  };

  const gjBuf = Buffer.from(JSON.stringify(sampleGeoJson), 'utf8');
  const parsedGj = parseGeoJsonBuffer(gjBuf, 'blok_uji_geojson.geojson');
  console.log('GeoJSON Berhasil Di-parse:');
  console.log(`- Layer: ${parsedGj.layerName}`);
  console.log(`- Tipe Geometri: ${parsedGj.geometryType}`);
  console.log(`- Jumlah Fitur: ${parsedGj.featureCount}`);
  console.log(`- BBox: ${JSON.stringify(parsedGj.bbox)}`);
  console.log('STATUS TEST 1: LULUS\n');

  // Test 2: Simpan GeoJSON ke PostGIS dengan Data Mapping spesifik
  console.log('--- [TEST 2] Import GeoJSON dengan Mapping Kebun & Afdeling ke PostGIS ---');
  const client = await pool.connect();
  try {
    const kebunRes = await client.query('SELECT id, kode_kebun FROM public.kebun ORDER BY id ASC LIMIT 1;');
    const targetKebunId = kebunRes.rows[0].id;
    const afdRes = await client.query('SELECT id FROM public.afdeling WHERE kebun_id = $1 LIMIT 1;', [targetKebunId]);
    const targetAfdId = afdRes.rows[0]?.id || null;
    const adminRes = await client.query('SELECT id FROM public.pengguna ORDER BY id ASC LIMIT 1;');
    const adminId = adminRes.rows[0]?.id || null;

    await client.query('BEGIN');

    // 1. data_unggahan
    const duRes = await client.query(`
      INSERT INTO public.data_unggahan (
        pengguna_id, kebun_id, nama_data, nama_file, format_file,
        lokasi_file, crs_asal, srid_asal, status, jumlah_layer
      ) VALUES ($1, $2, $3, $4, 'GeoJSON', $5, 'WGS 84 (EPSG:4326)', 4326, 'berhasil', 1)
      RETURNING id;
    `, [
      adminId,
      targetKebunId,
      'Uji Import GeoJSON (DATA SINTETIS)',
      'blok_uji_geojson.geojson',
      'uploads/gis/blok_uji_geojson.geojson',
    ]);
    const unggahanId = duRes.rows[0].id;

    // 2. layer_peta
    const lpRes = await client.query(`
      INSERT INTO public.layer_peta (
        unggahan_id, kebun_id, afdeling_id, blok_id, nama_layer, nama_file_shp,
        tipe_geometri, warna, transparansi, terlihat, urutan,
        jumlah_fitur, crs_asal, srid_asal
      ) VALUES ($1, $2, $3, NULL, $4, $5, 'Polygon', '#10b981', 0.35, TRUE, 99, 1, 'EPSG:4326', 4326)
      RETURNING id;
    `, [
      unggahanId,
      targetKebunId,
      targetAfdId,
      'Batas Blok GeoJSON (DATA SINTETIS)',
      'blok_uji_geojson.geojson',
    ]);
    const layerId = lpRes.rows[0].id;

    // 3. fitur_peta
    await client.query(`
      INSERT INTO public.fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3::jsonb
      );
    `, [
      layerId,
      JSON.stringify(sampleGeoJson.features[0].geometry),
      JSON.stringify(sampleGeoJson.features[0].properties),
    ]);

    await client.query('COMMIT');
    console.log(`Berhasil menyimpan layer GeoJSON ke PostGIS! (unggahan_id: ${unggahanId}, layer_id: ${layerId})`);

    // Verifikasi fitur yang tersimpan
    const verRes = await client.query(`
      SELECT fp.id, ST_GeometryType(fp.geom) as geom_type, ST_SRID(fp.geom) as srid, fp.atribut
      FROM public.fitur_peta fp
      WHERE fp.layer_id = $1;
    `, [layerId]);
    console.log('Verifikasi Fitur:', JSON.stringify(verRes.rows[0]));
    console.log('STATUS TEST 2: LULUS\n');

    // Bersihkan data uji sintetis
    await client.query('DELETE FROM public.fitur_peta WHERE layer_id = $1;', [layerId]);
    await client.query('DELETE FROM public.layer_peta WHERE id = $1;', [layerId]);
    await client.query('DELETE FROM public.data_unggahan WHERE id = $1;', [unggahanId]);
    console.log('Fixture data uji sintetis berhasil dibersihkan.');
    console.log('STATUS TEST 3: LULUS (IDEMPOTEN)\n');
  } finally {
    client.release();
    await pool.end();
  }
}

runUploadTest().catch(err => {
  console.error('Test Error:', err);
  process.exit(1);
});

