const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:1234@localhost:5432/nusaGis'
});

async function run() {
  const akt = await pool.query('SELECT count(*) FROM master_aktivitas');
  console.log('Total Master Aktivitas in DB:', akt.rows[0].count);

  const kbn = await pool.query("SELECT id, kode_kebun, nama_kebun, komoditas FROM kebun WHERE nama_kebun = 'Kebun Gamboeng'");
  console.log('Kebun Gamboeng:', kbn.rows[0]);

  const afd = await pool.query('SELECT id, kode_afdeling, nama_afdeling FROM afdeling WHERE kebun_id = $1', [kbn.rows[0].id]);
  console.log('Afdeling Gamboeng:', afd.rows);

  const blk = await pool.query('SELECT count(*) FROM blok WHERE kebun_id = $1', [kbn.rows[0].id]);
  console.log('Total Gamboeng Blocks in DB:', blk.rows[0].count);

  const samples = await pool.query('SELECT kode_blok, nama_blok, komoditas, keterangan FROM blok WHERE kebun_id = $1 LIMIT 3', [kbn.rows[0].id]);
  console.log('Sample Blocks:', samples.rows);

  await pool.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
