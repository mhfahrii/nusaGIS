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

async function check() {
  const client = await pool.connect();
  try {
    const tables = ['pengguna', 'kebun', 'afdeling', 'blok', 'data_unggahan', 'layer_peta', 'fitur_peta', 'riwayat_aktivitas'];
    console.log('--- TABLE RECORD COUNTS ---');
    for (const t of tables) {
      try {
        const res = await client.query(`SELECT COUNT(*)::int AS cnt FROM public.${t}`);
        console.log(`${t}: ${res.rows[0].cnt} rows`);
      } catch (e) {
        console.log(`${t}: ERROR ${e.message}`);
      }
    }

    console.log('\n--- KEBUN LIST ---');
    const kebunRes = await client.query('SELECT id, kode_kebun, nama_kebun, wilayah, komoditas FROM public.kebun');
    console.log(kebunRes.rows);

    console.log('\n--- AFDELING LIST ---');
    const afdRes = await client.query('SELECT id, kebun_id, kode_afdeling, nama_afdeling FROM public.afdeling');
    console.log(afdRes.rows);

    console.log('\n--- BLOK LIST ---');
    const blokRes = await client.query('SELECT id, afdeling_id, kode_blok, nama_blok FROM public.blok LIMIT 10');
    console.log(blokRes.rows);

    console.log('\n--- LAYER_PETA COLUMNS ---');
    const cols = await client.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'layer_peta'`);
    console.log(cols.rows.map(c => `${c.column_name} (${c.data_type}, nullable:${c.is_nullable})`));

    console.log('\n--- LAYER_PETA ROWS ---');
    const layers = await client.query('SELECT id, nama_layer, tipe_geometri, crs_asal, srid_asal, kebun_id, afdeling_id, blok_id FROM public.layer_peta');
    console.log(layers.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

check().catch(console.error);

