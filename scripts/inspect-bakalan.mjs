import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Pool } = pg;

const envContent = fs.readFileSync('.env.local', 'utf8');
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

async function inspectFeatures() {
  const res = await pool.query(`
    SELECT id, ST_AsText(geom) as wkt, ST_NPoints(geom) as npoints, GeometryType(geom) as gtype, atribut
    FROM public.fitur_peta
    WHERE layer_id = 11
    LIMIT 5;
  `);
  console.log('--- FEATURES OF LAYER 11 (kebun bakalan_v1) ---');
  for (const r of res.rows) {
    console.log('ID:', r.id, 'Type:', r.gtype, 'Points:', r.npoints);
    console.log('WKT snippet:', r.wkt.slice(0, 160) + '...');
    console.log('Atribut:', r.atribut);
    console.log('----------------');
  }

  // Check all layers and their geometry types
  const allLayers = await pool.query(`
    SELECT id, nama_layer, tipe_geometri, jumlah_fitur FROM public.layer_peta ORDER BY id DESC;
  `);
  console.log('--- ALL LAYERS ---');
  console.table(allLayers.rows);

  await pool.end();
}
inspectFeatures();

