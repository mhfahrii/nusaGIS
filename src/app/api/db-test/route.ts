import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

interface PgError extends Error {
  code?: string;
  errno?: number | string;
  syscall?: string;
  address?: string;
  port?: number;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req, { roles: ['admin'] });
  if (auth.response) return auth.response;

  // 1. Validasi keberadaan Environment Variable
  const hasIndividualEnv = Boolean(
    process.env.DB_HOST &&
    process.env.DB_NAME &&
    process.env.DB_USER
  );
  const hasUrlEnv = Boolean(process.env.DATABASE_URL);

  if (!hasIndividualEnv && !hasUrlEnv) {
    return NextResponse.json(
      {
        status: 'error',
        error_type: 'MISSING_ENV_VARIABLES',
        message: 'Environment variable untuk koneksi database belum tersedia.',
        detail:
          'Pastikan variabel DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD atau DATABASE_URL telah diisi di file .env.local.',
      },
      { status: 500 }
    );
  }

  try {
    // 2. Eksekusi query pengujian koneksi dan fungsi-fungsi yang diminta
    const sql = `
      SELECT 
        current_database() AS "database",
        current_user AS "user",
        PostGIS_Full_Version() AS "postgis_version",
        NOW() AS "server_time";
    `;

    const result = await query<{
      database: string;
      user: string;
      postgis_version: string;
      server_time: string;
    }>(sql);

    const row = result.rows[0];

    return NextResponse.json({
      status: 'success',
      message: 'Koneksi ke database PostgreSQL dan PostGIS berhasil.',
      data: {
        database: row.database,
        user: row.user,
        postgis_version: row.postgis_version,
        server_time: row.server_time,
      },
    });
  } catch (error: unknown) {
    const pgErr = error as PgError;
    const errorCode = pgErr.code;
    const errorMessage = pgErr.message || 'Terjadi kesalahan pada database.';

    // Penanganan error spesifik berdasarkan kode PostgreSQL atau Node error
    if (errorCode === '3D000') {
      return NextResponse.json(
        {
          status: 'error',
          error_type: 'DATABASE_NOT_FOUND',
          message: 'Database tidak ditemukan di server PostgreSQL.',
          detail: errorMessage,
        },
        { status: 500 }
      );
    }

    if (errorCode === '28P01' || errorCode === '28000') {
      return NextResponse.json(
        {
          status: 'error',
          error_type: 'AUTHENTICATION_FAILED',
          message: 'Autentikasi gagal. Password atau username salah.',
          detail: errorMessage,
        },
        { status: 401 }
      );
    }

    if (errorCode === 'ECONNREFUSED' || pgErr.errno === -4078 || pgErr.errno === -4092) {
      return NextResponse.json(
        {
          status: 'error',
          error_type: 'POSTGRESQL_INACTIVE',
          message: 'Layanan PostgreSQL tidak aktif atau menolak koneksi.',
          detail: errorMessage,
        },
        { status: 503 }
      );
    }

    if (errorCode === 'ETIMEDOUT' || errorCode === 'ENOTFOUND') {
      return NextResponse.json(
        {
          status: 'error',
          error_type: 'INVALID_HOST_OR_PORT',
          message: 'Host atau port PostgreSQL salah atau koneksi timeout.',
          detail: errorMessage,
        },
        { status: 504 }
      );
    }

    if (errorCode === '42883') {
      return NextResponse.json(
        {
          status: 'error',
          error_type: 'POSTGIS_NOT_ACTIVE',
          message: 'Ekstensi PostGIS belum aktif pada database ini (fungsi PostGIS_Full_Version() tidak ditemukan).',
          detail: errorMessage,
        },
        { status: 500 }
      );
    }

    // Default error handler
    return NextResponse.json(
      {
        status: 'error',
        error_type: 'UNKNOWN_DB_ERROR',
        message: 'Gagal terhubung atau menjalankan query pada database.',
        detail: errorMessage,
      },
      { status: 500 }
    );
  }
}
