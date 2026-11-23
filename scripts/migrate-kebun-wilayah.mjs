import fs from 'fs';
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

async function migrate() {
  console.log('1. Adding provinsi and kabupaten_kota columns to kebun table...');
  await pool.query(`
    ALTER TABLE public.kebun 
    ADD COLUMN IF NOT EXISTS provinsi VARCHAR(100),
    ADD COLUMN IF NOT EXISTS kabupaten_kota VARCHAR(100);
  `);

  console.log('2. Populating provinsi and kabupaten_kota for existing kebun records...');
  // Standardize existing records
  const updateQueries = [
    {
      id: 12,
      nama: 'Kebun Bakalan',
      provinsi: 'Jawa Timur',
      kabupaten: 'Pasuruan',
      wilayah: 'Pasuruan, Jawa Timur',
    },
    {
      id: 18,
      nama: 'Kebun Pakuncen',
      provinsi: 'Jawa Timur',
      kabupaten: 'Pasuruan',
      wilayah: 'Pasuruan, Jawa Timur',
    },
    {
      id: 14,
      nama: 'Kebun Sarongge',
      provinsi: 'Jawa Barat',
      kabupaten: 'Kabupaten Cianjur',
      wilayah: 'Kabupaten Cianjur, Jawa Barat',
    },
    {
      id: 17,
      nama: 'Kebun Cibeureum',
      provinsi: 'Jawa Barat',
      kabupaten: 'Kabupaten Bandung',
      wilayah: 'Kabupaten Bandung, Jawa Barat',
    },
    {
      id: 16,
      nama: 'Peta Kebun Sei Aek Pancur',
      provinsi: 'Sumatera Utara',
      kabupaten: 'Kabupaten Deli Serdang',
      wilayah: 'Kabupaten Deli Serdang, Sumatera Utara',
    },
    {
      id: 19,
      nama: 'Kebun Teluk Dalan',
      provinsi: 'Sumatera Utara',
      kabupaten: 'Kabupaten Asahan',
      wilayah: 'Kabupaten Asahan, Sumatera Utara',
    },
    {
      id: 15,
      nama: 'Kebun Sragi',
      provinsi: 'Jawa Tengah',
      kabupaten: 'Kabupaten Pekalongan',
      wilayah: 'Kabupaten Pekalongan, Jawa Tengah',
    },
  ];

  for (const item of updateQueries) {
    await pool.query(
      `UPDATE public.kebun 
       SET provinsi = $1, kabupaten_kota = $2, wilayah = $3 
       WHERE id = $4 OR nama_kebun ILIKE $5`,
      [item.provinsi, item.kabupaten, item.wilayah, item.id, item.nama]
    );
  }

  // Generic fallback update for any unpopulated records
  await pool.query(`
    UPDATE public.kebun
    SET 
      provinsi = CASE 
        WHEN wilayah ILIKE '%Sumatera Utara%' THEN 'Sumatera Utara'
        WHEN wilayah ILIKE '%Sumatera Selatan%' THEN 'Sumatera Selatan'
        WHEN wilayah ILIKE '%Sumatera Barat%' THEN 'Sumatera Barat'
        WHEN wilayah ILIKE '%Jawa Timur%' THEN 'Jawa Timur'
        WHEN wilayah ILIKE '%Jawa Barat%' THEN 'Jawa Barat'
        WHEN wilayah ILIKE '%Jawa Tengah%' THEN 'Jawa Tengah'
        WHEN wilayah ILIKE '%Riau%' THEN 'Riau'
        WHEN wilayah ILIKE '%Aceh%' THEN 'Aceh'
        WHEN wilayah ILIKE '%Lampung%' THEN 'Lampung'
        WHEN wilayah ILIKE '%Jambi%' THEN 'Jambi'
        ELSE COALESCE(provinsi, 'Wilayah Operasional')
      END
    WHERE provinsi IS NULL;
  `);

  const res = await pool.query(`
    SELECT id, nama_kebun, kabupaten_kota, provinsi, wilayah FROM public.kebun ORDER BY id ASC;
  `);
  console.log('Migration completed successfully. Current kebun records:');
  console.table(res.rows);

  await pool.end();
}

migrate().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
