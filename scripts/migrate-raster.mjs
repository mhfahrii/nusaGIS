import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Pool } = pg;

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
}

const pool = new Pool({
  host: env.DB_HOST || 'localhost',
  port: parseInt(env.DB_PORT || '5432'),
  database: env.DB_NAME || 'nusagis',
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Starting migration for public.layer_raster...');
    await client.query('BEGIN;');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.layer_raster (
        id BIGSERIAL PRIMARY KEY,
        unggahan_id BIGINT REFERENCES public.data_unggahan(id) ON DELETE CASCADE,
        kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL,
        afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
        blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
        nama_layer VARCHAR(255) NOT NULL,
        nama_file VARCHAR(255) NOT NULL,
        lokasi_file TEXT NOT NULL,
        tipe_raster VARCHAR(50) DEFAULT 'thematic', -- 'NDVI', 'RGB', 'ELEVATION'
        min_val NUMERIC,
        max_val NUMERIC,
        nodata NUMERIC,
        bands_count INTEGER DEFAULT 1,
        width INTEGER,
        height INTEGER,
        crs_asal VARCHAR(100),
        srid_asal INTEGER,
        bbox_wgs84 GEOMETRY(Polygon, 4326),
        transparansi NUMERIC DEFAULT 0.85,
        terlihat BOOLEAN DEFAULT true,
        urutan INTEGER DEFAULT 0,
        dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_layer_raster_bbox ON public.layer_raster USING GIST (bbox_wgs84);
    `);

    // Tambahkan juga foreign key atau indexing pendukung
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_layer_raster_kebun ON public.layer_raster(kebun_id);
    `);

    await client.query('COMMIT;');
    console.log('Migration committed successfully!');

    // Verifikasi
    const res = await client.query(`
      SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name = 'layer_raster'
      ORDER BY ordinal_position;
    `);
    console.log('--- TABLE layer_raster STRUCTURE ---');
    console.table(res.rows);

  } catch (err) {
    await client.query('ROLLBACK;');
    console.error('Migration failed and rolled back:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

