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

async function fixLayers() {
  console.log('1. Setting terlihat = false for old synthetic dummy layers (ID 2, 3, 4, 5, 6, 7)...');
  await pool.query(`
    UPDATE public.layer_peta
    SET terlihat = false
    WHERE id IN (2, 3, 4, 5, 6, 7) OR nama_layer ILIKE '%percobaan%' OR nama_layer ILIKE '%sintetis%';
  `);

  console.log('2. Setting terlihat = true and priority for uploaded real layer 11 (kebun bakalan_v1)...');
  await pool.query(`
    UPDATE public.layer_peta
    SET terlihat = true, urutan = 1
    WHERE id = 11;
  `);

  // Update kebun list to include or link Bakalan
  const checkKebun = await pool.query("SELECT id, nama_kebun FROM public.kebun WHERE nama_kebun ILIKE '%bakalan%';");
  let kebunBakalanId;
  if (checkKebun.rowCount === 0) {
    const newKebun = await pool.query(`
      INSERT INTO public.kebun (kode_kebun, nama_kebun, wilayah, komoditas, keterangan)
      VALUES ('KBN-BKL', 'Kebun Bakalan', 'Pasuruan, Jawa Timur', 'Tebu / Kelapa Sawit', 'Kebun Bakalan Pasuruan')
      RETURNING id;
    `);
    kebunBakalanId = newKebun.rows[0].id;
  } else {
    kebunBakalanId = checkKebun.rows[0].id;
  }

  // Link layer 11 to kebun Bakalan
  await pool.query('UPDATE public.layer_peta SET kebun_id = $1 WHERE id = 11;', [kebunBakalanId]);

  console.log('3. Verified current active layers:');
  const active = await pool.query(`
    SELECT l.id, l.nama_layer, l.terlihat, l.tipe_geometri, l.jumlah_fitur,
           ST_XMin(ST_Extent(f.geom)) as min_x,
           ST_YMin(ST_Extent(f.geom)) as min_y,
           ST_XMax(ST_Extent(f.geom)) as max_x,
           ST_YMax(ST_Extent(f.geom)) as max_y
    FROM public.layer_peta l
    LEFT JOIN public.fitur_peta f ON l.id = f.layer_id
    GROUP BY l.id, l.nama_layer, l.terlihat, l.tipe_geometri, l.jumlah_fitur, l.urutan
    ORDER BY l.urutan ASC, l.id DESC;
  `);
  console.table(active.rows);

  await pool.end();
}

fixLayers();
