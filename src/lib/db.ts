import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

function getPoolConfig(): PoolConfig {
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  if (host && database && user) {
    return {
      host,
      port,
      database,
      user,
      password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }

  return {
    host: host || 'localhost',
    port: port || 5432,
    database: database || 'nusagis',
    user: user || 'postgres',
    password: password || '',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

// Mencegah kebocoran koneksi berulang pada mode development Next.js
declare global {
  var __nusagisPool: Pool | undefined;
}

let pool: Pool;

if (process.env.NODE_ENV === 'production') {
  pool = new Pool(getPoolConfig());
} else {
  if (!global.__nusagisPool) {
    global.__nusagisPool = new Pool(getPoolConfig());
  }
  pool = global.__nusagisPool;
}

export { pool };

export function getPool(): Pool {
  return pool;
}

let migrationExecuted = false;

/**
 * Auto-Init Migration: Memastikan Indeks Spasial PostGIS GiST, GIN, dan Indeks Relasional
 * selalu terpasang sesuai standar Enterprise Web GIS tanpa menghapus data yang ada.
 */
export async function ensureGisSpatialIndices(): Promise<void> {
  if (migrationExecuted) return;
  migrationExecuted = true;
  try {
    // 1. Indeks Spasial R-Tree / GiST pada kolom geometri fitur_peta (Pencarian & Bounding Box)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_peta_geom ON public.fitur_peta USING GIST (geom);`);
    // 2. Indeks B-Tree Foreign Key layer_id
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_peta_layer_id ON public.fitur_peta (layer_id);`);
    // 3. Indeks Inverted GIN pada atribut JSONB (Filter Kode Blok, Nama Kebun, Varietas)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_peta_atribut ON public.fitur_peta USING GIN (atribut);`);
    // 4. Indeks Relasional layer_peta
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_layer_peta_kebun ON public.layer_peta (kebun_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_layer_peta_unggahan ON public.layer_peta (unggahan_id);`);
    // 5. Dukungan Soft Delete & Audit Trail pada fitur_peta (Standar Enterprise)
    await pool.query(`ALTER TABLE public.fitur_peta ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE public.fitur_peta ADD COLUMN IF NOT EXISTS dihapus_pada TIMESTAMP WITHOUT TIME ZONE;`);
    await pool.query(`ALTER TABLE public.fitur_peta ADD COLUMN IF NOT EXISTS dibuat_oleh_user_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE public.fitur_peta ADD COLUMN IF NOT EXISTS diubah_pada TIMESTAMP WITHOUT TIME ZONE;`);
    await pool.query(`ALTER TABLE public.fitur_peta ADD COLUMN IF NOT EXISTS diubah_oleh_user_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE public.fitur_peta ADD COLUMN IF NOT EXISTS dihapus_oleh_user_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL;`);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_peta_is_deleted ON public.fitur_peta (is_deleted);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_peta_dibuat_oleh ON public.fitur_peta (dibuat_oleh_user_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_peta_diubah_oleh ON public.fitur_peta (diubah_oleh_user_id);`);

    // 6. Indeks Ekspresi B-Tree JSONB untuk Analitik & Filter Agregasi Cepat
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_expr_nama_blok ON public.fitur_peta (((atribut->>'nama_blok')));`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_expr_status_lahan ON public.fitur_peta (((atribut->>'status_lahan')));`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fitur_expr_varietas ON public.fitur_peta (((atribut->>'varietas')));`);

    // 7. View Relasional Agronomi (Standar Enterprise Geodatabase ArcGIS Pro)
    await pool.query(`
      CREATE OR REPLACE VIEW public.v_fitur_lahan_agronomi AS
      SELECT 
          fp.id,
          fp.layer_id,
          lp.nama_layer,
          lp.kebun_id,
          k.nama_kebun,
          k.kode_kebun,
          lp.afdeling_id,
          a.nama_afdeling,
          a.kode_afdeling,
          COALESCE(
              fp.atribut->>'nama_blok',
              fp.atribut->>'Name',
              fp.atribut->>'KODE_BLOK',
              fp.atribut->>'BLOK',
              CONCAT('Blok #', fp.id)
          ) AS nama_blok,
          COALESCE(
              fp.atribut->>'kode_blok',
              fp.atribut->>'KODE_BLOK',
              fp.atribut->>'kode',
              fp.atribut->>'Name'
          ) AS kode_blok,
          COALESCE(
              fp.atribut->>'status_lahan',
              fp.atribut->>'STATUS',
              fp.atribut->>'Status',
              fp.atribut->>'DESKRIPSI',
              'Belum Ditentukan'
          ) AS status_lahan,
          COALESCE(
              fp.atribut->>'varietas',
              fp.atribut->>'VARIETAS',
              fp.atribut->>'komoditas',
              fp.atribut->>'KOMODITAS',
              'Tebu'
          ) AS varietas,
          COALESCE(
              fp.atribut->>'masa_tanam',
              fp.atribut->>'MT',
              fp.atribut->>'TAHUN_TANAM',
              '2023/2024'
          ) AS masa_tanam,
          CASE 
              WHEN (fp.atribut->>'luas_baku') ~ '^[0-9]+(\.[0-9]+)?$' THEN (fp.atribut->>'luas_baku')::numeric
              WHEN (fp.atribut->>'LUAS_HA') ~ '^[0-9]+(\.[0-9]+)?$' THEN (fp.atribut->>'LUAS_HA')::numeric
              WHEN (fp.atribut->>'luas') ~ '^[0-9]+(\.[0-9]+)?$' THEN (fp.atribut->>'luas')::numeric
              ELSE NULL
          END AS luas_baku_ha,
          ROUND((ST_Area(fp.geom::geography) / 10000.0)::numeric, 4)::float8 AS luas_ukur_ha,
          ROUND((
              (ST_Area(fp.geom::geography) / 10000.0) - 
              COALESCE(
                  CASE 
                      WHEN (fp.atribut->>'luas_baku') ~ '^[0-9]+(\.[0-9]+)?$' THEN (fp.atribut->>'luas_baku')::numeric
                      WHEN (fp.atribut->>'LUAS_HA') ~ '^[0-9]+(\.[0-9]+)?$' THEN (fp.atribut->>'LUAS_HA')::numeric
                      WHEN (fp.atribut->>'luas') ~ '^[0-9]+(\.[0-9]+)?$' THEN (fp.atribut->>'luas')::numeric
                      ELSE NULL
                  END, 0
              )
          )::numeric, 4)::float8 AS selisih_luas_ha,
          ROUND(ST_Perimeter(fp.geom::geography)::numeric, 2)::float8 AS keliling_m,
          fp.geom,
          fp.atribut,
          fp.is_deleted,
          fp.dihapus_pada,
          fp.dibuat_pada,
          fp.dibuat_oleh_user_id,
          fp.diubah_pada,
          fp.diubah_oleh_user_id,
          fp.dihapus_oleh_user_id
      FROM public.fitur_peta fp
      JOIN public.layer_peta lp ON lp.id = fp.layer_id
      LEFT JOIN public.kebun k ON k.id = lp.kebun_id
      LEFT JOIN public.afdeling a ON a.id = lp.afdeling_id;
    `);
  } catch (err) {
    // Abaikan jika tabel belum ada atau indeks sedang dibuat paralel
    console.warn('Notice (Spatial Indices Check):', (err as Error).message);
  }
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  if (!migrationExecuted) {
    ensureGisSpatialIndices().catch(() => {});
  }
  return pool.query<T>(text, params);
}
