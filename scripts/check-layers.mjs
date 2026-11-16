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

async function check() {
  const res = await pool.query(`
    SELECT l.id, l.nama_layer, l.terlihat, l.jumlah_fitur,
           ST_AsGeoJSON(ST_Envelope(ST_Collect(f.geom)))::jsonb as bbox_geom
    FROM public.layer_peta l
    LEFT JOIN public.fitur_peta f ON l.id = f.layer_id
    GROUP BY l.id
    ORDER BY l.id ASC;
  `);
  console.log('--- LAYERS WITH BBOX ---');
  for (const r of res.rows) {
    console.log(`Layer ${r.id}: "${r.nama_layer}" (terlihat: ${r.terlihat}, fitur: ${r.jumlah_fitur})`);
    console.log('Bbox coords:', r.bbox_geom?.coordinates?.[0]);
  }
  await pool.end();
}

check();

