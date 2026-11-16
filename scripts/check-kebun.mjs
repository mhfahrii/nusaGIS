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

async function checkKebunCols() {
  const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'kebun';");
  console.table(cols.rows);

  const kebunRows = await pool.query("SELECT * FROM public.kebun;");
  console.table(kebunRows.rows);

  await pool.end();
}
checkKebunCols();

