import pg from 'pg';
import fs from 'node:fs';

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

const DEFAULT_PERUSAHAAN = 'PT Perkebunan Nusantara I (Regional 4)';

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('--- MEMULAI MIGRASI public.kebun (kolom perusahaan) ---');

    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE public.kebun
        ADD COLUMN IF NOT EXISTS perusahaan VARCHAR(150) DEFAULT '${DEFAULT_PERUSAHAAN.replace(/'/g, "''")}';
    `);

    const updated = await client.query(
      `UPDATE public.kebun
       SET perusahaan = $1
       WHERE perusahaan IS NULL OR BTRIM(perusahaan) = '';`,
      [DEFAULT_PERUSAHAAN]
    );
    console.log(`Baris kebun di-backfill: ${updated.rowCount ?? 0}`);

    await client.query('COMMIT');
    console.log('--- MIGRASI BERHASIL ---');

    const colsRes = await client.query(`
      SELECT column_name, data_type, character_maximum_length, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'kebun'
      ORDER BY ordinal_position;
    `);
    console.table(colsRes.rows);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error('Migrasi gagal:', err);
  process.exit(1);
});