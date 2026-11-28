import fs from 'node:fs';
import pg from 'pg';

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
else if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL } = process.env;
const client = new pg.Client(
  DB_HOST
    ? { host: DB_HOST, port: Number(DB_PORT || 5432), database: DB_NAME, user: DB_USER, password: DB_PASSWORD || '' }
    : { connectionString: DATABASE_URL }
);

const expectFail = async (label, sql, params) => {
  await client.query('SAVEPOINT s');
  try {
    await client.query(sql, params);
    console.log(`FAIL ${label}: diterima padahal harus ditolak`);
    process.exitCode = 1;
  } catch (e) {
    console.log(`OK   ${label}: ditolak (${e.code})`);
  }
  await client.query('ROLLBACK TO SAVEPOINT s');
};

await client.connect();
try {
  const cols = await client.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='blok' AND column_name IN ('kebun_id','afdeling_id') ORDER BY 1`);
  console.table(cols.rows);

  await client.query('BEGIN');
  const afd = await client.query('SELECT id, kebun_id FROM afdeling ORDER BY id LIMIT 1');
  const otherKebun = await client.query('SELECT id FROM kebun WHERE id <> $1 ORDER BY id LIMIT 1', [afd.rows[0].kebun_id]);
  const { id: afdId, kebun_id: kebunId } = afd.rows[0];
  const kebunLain = otherKebun.rows[0].id;

  await client.query(`INSERT INTO blok (kebun_id, afdeling_id, kode_blok, nama_blok) VALUES ($1, $2, 'T01', 'Uji')`, [kebunId, afdId]);
  console.log('OK   blok dengan afdeling diterima');
  await client.query(`INSERT INTO blok (kebun_id, afdeling_id, kode_blok, nama_blok) VALUES ($1, NULL, 'T01', 'Uji')`, [kebunLain]);
  console.log('OK   blok tanpa afdeling diterima');

  await expectFail('afdeling dari kebun lain', `INSERT INTO blok (kebun_id, afdeling_id, kode_blok, nama_blok) VALUES ($1, $2, 'T02', 'Uji')`, [kebunLain, afdId]);
  await expectFail('kode ganda di afdeling sama (beda huruf)', `INSERT INTO blok (kebun_id, afdeling_id, kode_blok, nama_blok) VALUES ($1, $2, 't01', 'Uji')`, [kebunId, afdId]);
  await expectFail('kode ganda di kebun tanpa afdeling', `INSERT INTO blok (kebun_id, afdeling_id, kode_blok, nama_blok) VALUES ($1, NULL, 'T01', 'Uji')`, [kebunLain]);
  await expectFail('blok tanpa kebun', `INSERT INTO blok (kebun_id, afdeling_id, kode_blok, nama_blok) VALUES (NULL, NULL, 'T03', 'Uji')`, []);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
