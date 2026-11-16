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
  const afd = await pool.query('SELECT * FROM public.afdeling;');
  console.table(afd.rows);

  // Jika belum ada afdeling untuk Kebun Bakalan (id 5), tambahkan Afdeling A & B
  const bklAfd = await pool.query('SELECT id FROM public.afdeling WHERE kebun_id = 5;');
  if (bklAfd.rowCount === 0) {
    await pool.query(`
      INSERT INTO public.afdeling (kebun_id, kode_afdeling, nama_afdeling, keterangan)
      VALUES 
        (5, 'AFD-BKL-1', 'Afdeling Bakalan I', 'Afdeling Bakalan Barat'),
        (5, 'AFD-BKL-2', 'Afdeling Bakalan II', 'Afdeling Bakalan Timur');
    `);
    console.log('Added Afdeling Bakalan I & II');
  }

  await pool.end();
}
check();
