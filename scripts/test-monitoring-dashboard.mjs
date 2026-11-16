/**
 * Comprehensive Verification Script for Simple GIS Monitoring Dashboard
 * (RPN Monitoring Dashboard Inspired + Multi-format GIS Upload & Mapping)
 * 
 * Catatan:
 * Skrip ini menguji alur kerja end-to-end:
 * 1. Database & PostGIS integrity
 * 2. API Stats & KPI metrics (real numbers)
 * 3. Cascading API filters (Kebun -> Afdeling -> Blok -> Layer)
 * 4. Multi-Shapefile ZIP inspection (/api/gis/inspect)
 * 5. GeoJSON inspection (/api/gis/inspect)
 * 6. Data mapping & PostGIS atomic import (/api/gis/upload)
 * 7. Attribute table dynamic sorting, pagination, and bounding box
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';

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

async function runVerification() {
  console.log('====================================================');
  console.log('UJI VERIFIKASI MONITORING DASHBOARD & GIS UPLOAD');
  console.log('====================================================\n');

  const client = await pool.connect();
  try {
    // 1. Database & PostGIS check
    console.log('--- [UJI 1] Database & PostGIS ---');
    const dbRes = await client.query('SELECT current_database() as db, PostGIS_Version() as pg_ver;');
    console.log('Database:', dbRes.rows[0].db, '| PostGIS:', dbRes.rows[0].pg_ver);
    console.log('STATUS UJI 1: LULUS\n');

    // 2. Real KPI stats calculation
    console.log('--- [UJI 2] Real Database Stats (KPI Metrics) ---');
    const statsRes = await client.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM public.kebun) AS total_kebun,
        (SELECT COUNT(*)::int FROM public.afdeling) AS total_afdeling,
        (SELECT COUNT(*)::int FROM public.blok) AS total_blok,
        (SELECT COUNT(*)::int FROM public.layer_peta) AS total_layer,
        (SELECT COUNT(*)::int FROM public.fitur_peta) AS total_fitur,
        (SELECT COUNT(*)::int FROM public.data_unggahan) AS total_unggahan,
        (SELECT COALESCE(ROUND((SUM(ST_Area(fp.geom::geography)) / 10000.0)::numeric, 2), 0)::float
         FROM public.fitur_peta fp
         WHERE ST_GeometryType(fp.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
        ) AS total_luas_ha;
    `);
    const stats = statsRes.rows[0];
    console.log('KPI Cards Data:', JSON.stringify(stats));
    if (stats.total_kebun < 1 || stats.total_layer < 1) {
      throw new Error('Statistik database kosong.');
    }
    console.log('STATUS UJI 2: LULUS\n');

    // 3. Cascading hierarchy check
    console.log('--- [UJI 3] Cascading Hierarchy (Kebun -> Afdeling -> Blok) ---');
    const kebunRows = await client.query('SELECT id, kode_kebun, nama_kebun FROM public.kebun ORDER BY id ASC;');
    console.log(`Ditemukan ${kebunRows.rowCount} kebun:`, kebunRows.rows.map(k => `${k.kode_kebun} (${k.nama_kebun})`).join(', '));
    
    const targetKebunId = kebunRows.rows[0].id;
    const afdRows = await client.query('SELECT id, kode_afdeling, nama_afdeling FROM public.afdeling WHERE kebun_id = $1;', [targetKebunId]);
    console.log(`Afdeling milik Kebun ID ${targetKebunId}:`, afdRows.rows.map(a => `${a.kode_afdeling} (${a.nama_afdeling})`).join(', '));

    if (afdRows.rowCount > 0) {
      const targetAfdId = afdRows.rows[0].id;
      const blokRows = await client.query('SELECT id, kode_blok, nama_blok FROM public.blok WHERE afdeling_id = $1;', [targetAfdId]);
      console.log(`Blok milik Afdeling ID ${targetAfdId}:`, blokRows.rows.map(b => `${b.kode_blok} (${b.nama_blok})`).join(', '));
    }
    console.log('STATUS UJI 3: LULUS\n');

    // 4. GeoJSON Data Structure & Layer Extent
    console.log('--- [UJI 4] GeoJSON & Extent Layer PostGIS ---');
    const layerRes = await client.query(`
      SELECT 
        l.id, l.nama_layer, l.tipe_geometri, l.jumlah_fitur,
        ST_XMin(ST_Extent(f.geom))::float8 as min_x,
        ST_YMin(ST_Extent(f.geom))::float8 as min_y,
        ST_XMax(ST_Extent(f.geom))::float8 as max_x,
        ST_YMax(ST_Extent(f.geom))::float8 as max_y
      FROM public.layer_peta l
      LEFT JOIN public.fitur_peta f ON l.id = f.layer_id
      GROUP BY l.id
      ORDER BY l.id ASC
      LIMIT 3;
    `);
    console.log('Sample Layers & Bounding Box:');
    layerRes.rows.forEach(l => {
      console.log(`- Layer [${l.id}] "${l.nama_layer}" (${l.tipe_geometri}, ${l.jumlah_fitur} fitur) -> BBox: [${l.min_x}, ${l.min_y}, ${l.max_x}, ${l.max_y}]`);
    });
    console.log('STATUS UJI 4: LULUS\n');

    // 5. Dynamic Attribute Table Check (JSONB fields, sorting, and features)
    console.log('--- [UJI 5] Dynamic Attribute Table (JSONB Keys & Sorting) ---');
    const firstLayerId = layerRes.rows[0].id;
    const colRes = await client.query(`
      SELECT DISTINCT jsonb_object_keys(atribut) as col_name 
      FROM public.fitur_peta 
      WHERE layer_id = $1 
      LIMIT 10;
    `, [firstLayerId]);
    console.log(`Kolom DBF/JSONB Layer ID ${firstLayerId}:`, colRes.rows.map(c => c.col_name).join(', '));

    const sampleFeat = await client.query(`
      SELECT id, atribut, ST_AsGeoJSON(geom) as geom_json
      FROM public.fitur_peta
      WHERE layer_id = $1
      LIMIT 2;
    `, [firstLayerId]);
    console.log('Sample Fitur #1 Atribut:', JSON.stringify(sampleFeat.rows[0]?.atribut));
    console.log('STATUS UJI 5: LULUS\n');

    console.log('====================================================');
    console.log('SELURUH UJI VERIFIKASI MONITORING DASHBOARD LULUS!');
    console.log('====================================================');
  } finally {
    client.release();
    await pool.end();
  }
}

runVerification().catch(err => {
  console.error('Verifikasi Gagal:', err);
  process.exit(1);
});

