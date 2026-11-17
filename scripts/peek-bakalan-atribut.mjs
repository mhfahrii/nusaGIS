import pg from 'pg';
import fs from 'node:fs';
if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
const pool = new pg.Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
});
const client = await pool.connect();
try {
  const layer = await client.query(
    `SELECT id, nama_layer FROM layer_peta WHERE nama_layer ILIKE '%bakalan%' ORDER BY id DESC LIMIT 1`
  );
  console.log('layer', layer.rows[0]);
  if (!layer.rows[0]) process.exit(0);
  const rows = await client.query(
    'SELECT id, atribut FROM fitur_peta WHERE layer_id = $1 ORDER BY id LIMIT 5',
    [layer.rows[0].id]
  );
  for (const row of rows.rows) {
    console.log('\n--- feature', row.id, 'keys:', Object.keys(row.atribut).join(', '));
    console.log('PopupInfo:', JSON.stringify(row.atribut.PopupInfo ?? row.atribut.popupinfo ?? row.atribut.POPUPINFO));
    console.log('NAME:', row.atribut.NAME ?? row.atribut.Name);
    console.log('LUAS:', row.atribut.LUAS ?? row.atribut.luas);
  }
} finally {
  client.release();
  await pool.end();
}