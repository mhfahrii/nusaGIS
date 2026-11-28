import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { checkCsrf } from '@/lib/auth/csrf';
import { SESSION_COOKIE, sessionCookieOptions, verifySessionToken } from '@/lib/auth/session';
import {
  hasPermission,
  normalizeHakAkses,
  type HakAksesFitur,
  type Peran,
  type PenggunaPublik,
} from '@/types/auth';

export const KOLOM_PENGGUNA_PUBLIK =
  'id, nama, email, peran, aktif, afdeling_id, kebun_id, hak_akses, foto_profil, dibuat_pada';

type AuthResult = { user: PenggunaPublik; response?: never } | { user?: never; response: NextResponse };

interface RequireUserOptions {
  /** Peran yang diizinkan. Kosong berarti semua pengguna yang login. */
  roles?: Peran[];
  /** Izin spesifik fitur GIS yang wajib dimiliki pengguna. */
  permission?: keyof HakAksesFitur;
  /** Teruskan ke pemeriksaan CSRF. */
  requireJson?: boolean;
}

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json({ status: 'error', message }, { status });
}

function unauthorized(message: string, clearCookie = false): NextResponse {
  const res = errorResponse(401, message);
  if (clearCookie) res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return res;
}

export async function findActiveUserById(id: number): Promise<PenggunaPublik | null> {
  const res = await query<PenggunaPublik>(
    `SELECT p.id, p.nama, p.email, p.peran, p.aktif, p.afdeling_id,
            COALESCE(p.kebun_id, a.kebun_id) AS kebun_id,
            a.nama_afdeling AS afdeling_nama,
            COALESCE(k.nama_kebun, ka.nama_kebun) AS kebun_nama,
            p.hak_akses, p.foto_profil, p.dibuat_pada
     FROM public.pengguna p
     LEFT JOIN public.afdeling a ON p.afdeling_id = a.id
     LEFT JOIN public.kebun ka ON a.kebun_id = ka.id
     LEFT JOIN public.kebun k ON p.kebun_id = k.id
     WHERE p.id = $1;`,
    [id]
  );
  const user = res.rows[0];
  if (!user || !user.aktif) return null;

  const baseHakAkses = normalizeHakAkses(user.hak_akses, user.peran);

  // Gabungkan dengan hak sementara yang sedang aktif disetujui admin (otomatis berakhir setelah 24 jam)
  try {
    await query(
      `UPDATE public.permintaan_hak_sementara
       SET status = 'dicabut', diperbarui_pada = NOW()
       WHERE pengguna_id = $1 AND status = 'disetujui'
         AND diperbarui_pada < NOW() - INTERVAL '24 hours';`,
      [id]
    );
    const tempRes = await query<{ jenis_hak: string }>(
      `SELECT jenis_hak FROM public.permintaan_hak_sementara
       WHERE pengguna_id = $1 AND status = 'disetujui'
         AND diperbarui_pada >= NOW() - INTERVAL '24 hours';`,
      [id]
    );
    for (const row of tempRes.rows) {
      if (row.jenis_hak === 'upload_layer') baseHakAkses.upload_layer = true;
      if (row.jenis_hak === 'edit_data') baseHakAkses.edit_data = true;
    }
  } catch {
    // Abaikan jika tabel belum dimigrasi
  }

  return {
    ...user,
    id: Number(user.id),
    afdeling_id: user.afdeling_id ? Number(user.afdeling_id) : null,
    kebun_id: user.kebun_id ? Number(user.kebun_id) : null,
    afdeling_nama: user.afdeling_nama ?? null,
    kebun_nama: user.kebun_nama ?? null,
    hak_akses: baseHakAkses,
  };
}

export async function requireUser(
  req: NextRequest,
  options: RequireUserOptions = {}
): Promise<AuthResult> {
  const csrfError = checkCsrf(req, { requireJson: options.requireJson });
  if (csrfError) return { response: errorResponse(403, csrfError) };

  const claims = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!claims) {
    return { response: unauthorized('Sesi tidak valid atau telah berakhir. Silakan login.') };
  }

  const userId = Number(claims.sub);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { response: unauthorized('Sesi tidak valid. Silakan login.', true) };
  }

  let user: PenggunaPublik | null;
  try {
    user = await findActiveUserById(userId);
  } catch {
    return { response: errorResponse(503, 'Gagal memverifikasi sesi: database tidak tersedia.') };
  }

  if (!user) {
    return { response: unauthorized('Akun tidak ditemukan atau telah dinonaktifkan.', true) };
  }

  if (options.roles && options.roles.length > 0 && !options.roles.includes(user.peran)) {
    return { response: errorResponse(403, 'Anda tidak memiliki hak akses untuk tindakan ini.') };
  }

  if (options.permission && !hasPermission(user, options.permission)) {
    return {
      response: errorResponse(
        403,
        'Akses ditolak: Akun Anda tidak memiliki izin untuk fitur ini. Silakan ajukan Hak Sementara kepada Administrator.'
      ),
    };
  }

  return { user };
}

/** Pencatatan ke riwayat_aktivitas. Kegagalan pencatatan tidak menggagalkan request utama. */
export async function catatAktivitas(
  penggunaId: number | null,
  aktivitas: string,
  keterangan: string | null = null
): Promise<void> {
  try {
    await query(
      'INSERT INTO riwayat_aktivitas (pengguna_id, aktivitas, keterangan) VALUES ($1, $2, $3);',
      [penggunaId, aktivitas, keterangan]
    );
  } catch (err) {
    console.error('Gagal mencatat aktivitas:', (err as Error).message);
  }
}

/** Menyembunyikan pesan error internal SQL/server pada mode production untuk mencegah Sensitive Data Exposure. */
export function safeErrorDetail(err: unknown): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return err instanceof Error ? err.message : String(err);
}


