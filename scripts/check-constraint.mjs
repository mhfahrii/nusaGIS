import pg from 'pg';
import fs from 'node:fs';

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function main() {
  const r = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) as def 
    FROM pg_constraint 
    WHERE conrelid = 'data_unggahan'::regclass;
  `);
  console.log(r.rows);
  await pool.end();
}
main();
