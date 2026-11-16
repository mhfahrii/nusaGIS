import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Pool } = pg;

// Read .env.local
const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
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

async function audit() {
  try {
    const ext = await pool.query(
      "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name LIKE '%raster%' OR name LIKE '%postgis%'"
    );
    console.log('--- EXTENSIONS ---');
    console.table(ext.rows);

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log('--- TABLES ---');
    console.log(tables.rows.map(r => r.table_name));

    const layerCols = await pool.query(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'layer_peta' ORDER BY ordinal_position"
    );
    console.log('--- LAYER_PETA COLUMNS ---');
    console.table(layerCols.rows);

    const fiturCols = await pool.query(
      "SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_name = 'fitur_peta' ORDER BY ordinal_position"
    );
    console.log('--- FITUR_PETA COLUMNS ---');
    console.table(fiturCols.rows);

    const uploadsCols = await pool.query(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'data_unggahan' ORDER BY ordinal_position"
    );
    console.log('--- DATA_UNGGAHAN COLUMNS ---');
    console.table(uploadsCols.rows);

    const layers = await pool.query(
      "SELECT id, nama_layer, tipe_geometri, crs_asal, srid_asal, jumlah_fitur, dibuat_pada FROM layer_peta ORDER BY id DESC"
    );
    console.log('--- EXISTING LAYERS ---');
    console.table(layers.rows);

  } catch (err) {
    console.error('Audit error:', err);
  } finally {
    await pool.end();
  }
}

audit();
