import pg from 'pg';
import fs from 'node:fs';

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'nusagis',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('--- MEMULAI MIGRASI public.layer_peta ---');
    const beforeCount = await client.query('SELECT COUNT(*)::int AS total FROM public.layer_peta;');
    const beforeFeatCount = await client.query('SELECT COUNT(*)::int AS total FROM public.fitur_peta;');
    console.log('Jumlah layer sebelum migrasi:', beforeCount.rows[0].total);
    console.log('Jumlah fitur sebelum migrasi:', beforeFeatCount.rows[0].total);

    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE public.layer_peta
        ADD COLUMN IF NOT EXISTS crs_asal VARCHAR(100),
        ADD COLUMN IF NOT EXISTS srid_asal INTEGER;
    `);

    await client.query('COMMIT');
    console.log('--- MIGRASI BERHASIL DI-COMMIT ---');

    // Verifikasi struktur kolom setelah migrasi
    const colsRes = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'layer_peta'
      ORDER BY ordinal_position;
    `);
    console.log('Struktur kolom public.layer_peta saat ini:');
    console.table(colsRes.rows);

    const colsUnggahanRes = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'data_unggahan'
        AND column_name IN ('crs_asal', 'srid_asal')
      ORDER BY ordinal_position;
    `);
    console.log('Kolom CRS pada public.data_unggahan tetap utuh:');
    console.table(colsUnggahanRes.rows);

    const afterCount = await client.query('SELECT COUNT(*)::int AS total FROM public.layer_peta;');
    const afterFeatCount = await client.query('SELECT COUNT(*)::int AS total FROM public.fitur_peta;');
    console.log('Jumlah layer setelah migrasi:', afterCount.rows[0].total);
    console.log('Jumlah fitur setelah migrasi:', afterFeatCount.rows[0].total);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('MIGRASI GAGAL, TRANSAKSI DI-ROLLBACK:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

