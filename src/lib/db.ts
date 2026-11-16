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
