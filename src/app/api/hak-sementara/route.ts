import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser } from '@/lib/auth/guard';
import { hasPermission } from '@/types/auth';

export type JenisHakSementara = 'upload_layer' | 'edit_data';
export type StatusHakSementara = 'pending' | 'disetujui' | 'ditolak' | 'dicabut';

export interface PermintaanHakSementaraItem {
  id: number;
  pengguna_id: number;
  nama_pengguna: string;
  email: string;
  foto_profil: string | null;
  peran: string;
  jenis_hak: JenisHakSementara;
  alasan: string | null;
  status: StatusHakSementara;
  dikonfirmasi_oleh: number | null;
  nama_konfirmator: string | null;
  dibuat_pada: string;
  diperbarui_pada: string;
}

const VALID_JENIS_HAK = new Set<JenisHakSementara>(['upload_layer', 'edit_data']);

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const canManage = hasPermission(auth.user, 'kelola_karyawan');
    const params: unknown[] = [];
    const whereClause = canManage ? '' : 'WHERE p.pengguna_id = $1';
    if (!canManage) {
      params.push(auth.user.id);
    }

    const res = await query<{
      id: string | number;
      pengguna_id: string | number;
      nama_pengguna: string;
      email: string;
      foto_profil: string | null;
      peran: string;
      jenis_hak: JenisHakSementara;
      alasan: string | null;
      status: StatusHakSementara;
      dikonfirmasi_oleh: string | number | null;
      nama_konfirmator: string | null;
      dibuat_pada: string;
      diperbarui_pada: string;
    }>(
      `SELECT
         p.id,
         p.pengguna_id,
         u.nama AS nama_pengguna,
         u.email,
         u.foto_profil,
         u.peran,
         p.jenis_hak,
         p.alasan,
         p.status,
         p.dikonfirmasi_oleh,
         adm.nama AS nama_konfirmator,
         p.dibuat_pada::text AS dibuat_pada,
         p.diperbarui_pada::text AS diperbarui_pada
       FROM public.permintaan_hak_sementara p
       JOIN public.pengguna u ON u.id = p.pengguna_id
       LEFT JOIN public.pengguna adm ON adm.id = p.dikonfirmasi_oleh
       ${whereClause}
       ORDER BY
         CASE p.status
           WHEN 'pending' THEN 0
           WHEN 'disetujui' THEN 1
           WHEN 'ditolak' THEN 2
           ELSE 3
         END ASC,
         p.dibuat_pada DESC
       LIMIT 100`,
      params
    );

    const data: PermintaanHakSementaraItem[] = res.rows.map((row) => ({
      id: Number(row.id),
      pengguna_id: Number(row.pengguna_id),
      nama_pengguna: row.nama_pengguna,
      email: row.email,
      foto_profil: row.foto_profil,
      peran: row.peran,
      jenis_hak: row.jenis_hak,
      alasan: row.alasan,
      status: row.status,
      dikonfirmasi_oleh: row.dikonfirmasi_oleh ? Number(row.dikonfirmasi_oleh) : null,
      nama_konfirmator: row.nama_konfirmator,
      dibuat_pada: row.dibuat_pada,
      diperbarui_pada: row.diperbarui_pada,
    }));

    return NextResponse.json({ status: 'success', sukses: true, data });
  } catch (err) {
    console.error('[API HAK SEMENTARA GET]', err);
    return NextResponse.json(
      { status: 'error', sukses: false, message: 'Gagal memuat daftar permintaan hak akses sementara.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { requireJson: true });
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { status: 'error', sukses: false, message: 'Format data JSON tidak valid.' },
        { status: 400 }
      );
    }

    const jenisHak = String(body.jenis_hak ?? '').trim() as JenisHakSementara;
    const alasan = String(body.alasan ?? '').trim() || null;

    if (!VALID_JENIS_HAK.has(jenisHak)) {
      return NextResponse.json(
        {
          status: 'error',
          sukses: false,
          message: 'Jenis hak akses sementara tidak valid. Pilih Upload Data atau Edit Data.',
        },
        { status: 400 }
      );
    }

    const existing = await query<{ id: string | number; status: StatusHakSementara }>(
      `SELECT id, status
       FROM public.permintaan_hak_sementara
       WHERE pengguna_id = $1 AND jenis_hak = $2 AND status IN ('pending', 'disetujui')
       LIMIT 1`,
      [auth.user.id, jenisHak]
    );

    if (existing.rows.length > 0) {
      const currentStatus = existing.rows[0].status;
      return NextResponse.json(
        {
          status: 'error',
          sukses: false,
          message:
            currentStatus === 'pending'
              ? 'Permintaan untuk hak akses ini sedang menunggu konfirmasi Administrator.'
              : 'Hak akses sementara ini sudah disetujui dan sedang aktif pada akun Anda.',
        },
        { status: 409 }
      );
    }

    await query(
      `INSERT INTO public.permintaan_hak_sementara (pengguna_id, jenis_hak, alasan, status)
       VALUES ($1, $2, $3, 'pending')`,
      [auth.user.id, jenisHak, alasan]
    );

    const labelHak = jenisHak === 'upload_layer' ? 'Hak Upload Data GIS' : 'Hak Edit Data & Layer';

    await catatAktivitas(
      auth.user.id,
      'minta_hak_sementara',
      `Mengajukan permintaan ${labelHak}${alasan ? ` (Alasan: ${alasan})` : ''}.`
    );

    return NextResponse.json({
      status: 'success',
      sukses: true,
      message: `Permintaan ${labelHak} berhasil dikirim. Menunggu konfirmasi dari Administrator.`,
    });
  } catch (err) {
    console.error('[API HAK SEMENTARA POST]', err);
    return NextResponse.json(
      { status: 'error', sukses: false, message: 'Gagal mengirim permintaan hak akses sementara.' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req, { requireJson: true, permission: 'kelola_karyawan' });
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { status: 'error', sukses: false, message: 'Format data JSON tidak valid.' },
        { status: 400 }
      );
    }

    const id = Number(body.id);
    const action = String(body.action ?? '').trim();

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { status: 'error', sukses: false, message: 'ID permintaan hak sementara tidak valid.' },
        { status: 400 }
      );
    }

    const statusMap: Record<string, StatusHakSementara> = {
      setujui: 'disetujui',
      tolak: 'ditolak',
      cabut: 'dicabut',
    };

    const nextStatus = statusMap[action];
    if (!nextStatus) {
      return NextResponse.json(
        { status: 'error', sukses: false, message: 'Tindakan tidak valid. Gunakan setujui, tolak, atau cabut.' },
        { status: 400 }
      );
    }

    const updated = await query<{
      id: string | number;
      pengguna_id: string | number;
      jenis_hak: JenisHakSementara;
      nama_pengguna: string;
    }>(
      `UPDATE public.permintaan_hak_sementara p
       SET status = $1,
           dikonfirmasi_oleh = $2,
           diperbarui_pada = NOW()
       FROM public.pengguna u
       WHERE p.id = $3 AND u.id = p.pengguna_id
       RETURNING p.id, p.pengguna_id, p.jenis_hak, u.nama AS nama_pengguna`,
      [nextStatus, auth.user.id, id]
    );

    const row = updated.rows[0];
    if (!row) {
      return NextResponse.json(
        { status: 'error', sukses: false, message: 'Permintaan hak sementara tidak ditemukan.' },
        { status: 404 }
      );
    }

    const labelHak = row.jenis_hak === 'upload_layer' ? 'Hak Upload Data GIS' : 'Hak Edit Data & Layer';
    const labelAksi =
      nextStatus === 'disetujui'
        ? 'disetujui dan diaktifkan'
        : nextStatus === 'ditolak'
          ? 'ditolak'
          : 'dicabut kembali';

    await catatAktivitas(
      auth.user.id,
      `hak_sementara_${nextStatus}`,
      `${labelHak} untuk akun "${row.nama_pengguna}" telah ${labelAksi}.`
    );

    return NextResponse.json({
      status: 'success',
      sukses: true,
      message: `${labelHak} untuk akun "${row.nama_pengguna}" berhasil ${labelAksi}.`,
    });
  } catch (err) {
    console.error('[API HAK SEMENTARA PATCH]', err);
    return NextResponse.json(
      { status: 'error', sukses: false, message: 'Gagal memperbarui status hak akses sementara.' },
      { status: 500 }
    );
  }
}
