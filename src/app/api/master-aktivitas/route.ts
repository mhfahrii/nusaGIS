import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';
import type { MasterAktivitas } from '@/types/perkebunan';

// GET /api/master-aktivitas - Mengambil daftar master aktivitas perkebunan
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const komoditas = searchParams.get('komoditas');
    const kategori = searchParams.get('kategori');
    const semua = searchParams.get('semua') === 'true';

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!semua) {
      conditions.push('is_aktif = TRUE');
    }

    if (komoditas && komoditas !== 'Semua') {
      params.push(komoditas);
      conditions.push(`(komoditas = $${params.length} OR komoditas = 'Umum')`);
    }

    if (kategori && kategori !== 'semua') {
      params.push(kategori);
      conditions.push(`kategori = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT id, kode_aktivitas, nama_aktivitas, komoditas, kategori, satuan_hasil, deskripsi, is_aktif, dibuat_pada
      FROM public.master_aktivitas
      ${whereClause}
      ORDER BY komoditas ASC, kategori ASC, nama_aktivitas ASC;
    `;

    const res = await query<MasterAktivitas>(sql, params);

    return NextResponse.json({
      status: 'success',
      total: res.rows.length,
      data: res.rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memuat daftar master data aktivitas.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// POST /api/master-aktivitas - Menambahkan jenis aktivitas baru (Admin/Manajer)
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  if (auth.user.peran !== 'admin' && !auth.user.hak_akses?.edit_data) {
    return NextResponse.json(
      { status: 'error', message: 'Anda tidak memiliki hak akses untuk menambah master aktivitas.' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ status: 'error', message: 'Payload JSON tidak valid.' }, { status: 400 });
    }

    const nama = typeof body.nama_aktivitas === 'string' ? body.nama_aktivitas.trim() : '';
    const komoditas = typeof body.komoditas === 'string' ? body.komoditas.trim() : 'Umum';
    const kategori = typeof body.kategori === 'string' ? body.kategori.trim().toLowerCase() : 'pemeliharaan';
    const satuanHasil = typeof body.satuan_hasil === 'string' ? body.satuan_hasil.trim() : 'Kg';
    const deskripsi = typeof body.deskripsi === 'string' ? body.deskripsi.trim() : null;

    if (!nama || nama.length < 3) {
      return NextResponse.json(
        { status: 'error', message: 'Nama aktivitas wajib diisi (minimal 3 karakter).' },
        { status: 400 }
      );
    }

    // Generate kode aktivitas otomatis jika tidak diisi
    let kode = typeof body.kode_aktivitas === 'string' ? body.kode_aktivitas.trim().toUpperCase() : '';
    if (!kode) {
      const prefix = komoditas.substring(0, 3).toUpperCase();
      const katPrefix = kategori.substring(0, 3).toUpperCase();
      const randomNum = Math.floor(100 + Math.random() * 900);
      kode = `${prefix}-${katPrefix}-${randomNum}`;
    }

    const res = await query<MasterAktivitas>(
      `INSERT INTO public.master_aktivitas (kode_aktivitas, nama_aktivitas, komoditas, kategori, satuan_hasil, deskripsi, is_aktif)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, kode_aktivitas, nama_aktivitas, komoditas, kategori, satuan_hasil, deskripsi, is_aktif, dibuat_pada;`,
      [kode, nama, komoditas, kategori, satuanHasil, deskripsi]
    );

    const created = res.rows[0];

    await catatAktivitas(
      auth.user.id,
      'tambah_master_aktivitas',
      `Menambahkan aktivitas baru "${created.nama_aktivitas}" (${created.kode_aktivitas}) untuk komoditas ${created.komoditas}.`
    );

    return NextResponse.json(
      {
        status: 'success',
        message: `Aktivitas "${created.nama_aktivitas}" berhasil ditambahkan ke master data.`,
        data: created,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal menyimpan aktivitas baru.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// PATCH /api/master-aktivitas - Memperbarui master data aktivitas
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  if (auth.user.peran !== 'admin' && !auth.user.hak_akses?.edit_data) {
    return NextResponse.json(
      { status: 'error', message: 'Anda tidak memiliki hak akses untuk mengubah master aktivitas.' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ status: 'error', message: 'Payload JSON tidak valid.' }, { status: 400 });
    }

    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ status: 'error', message: 'ID aktivitas tidak valid.' }, { status: 400 });
    }

    const curr = await query<MasterAktivitas>(
      'SELECT id, kode_aktivitas, nama_aktivitas, komoditas, kategori, satuan_hasil, deskripsi, is_aktif FROM public.master_aktivitas WHERE id = $1;',
      [id]
    );

    if (curr.rows.length === 0) {
      return NextResponse.json({ status: 'error', message: 'Aktivitas tidak ditemukan.' }, { status: 404 });
    }

    const current = curr.rows[0];
    const nama = typeof body.nama_aktivitas === 'string' ? body.nama_aktivitas.trim() : current.nama_aktivitas;
    const komoditas = typeof body.komoditas === 'string' ? body.komoditas.trim() : current.komoditas;
    const kategori = typeof body.kategori === 'string' ? body.kategori.trim().toLowerCase() : current.kategori;
    const satuanHasil = typeof body.satuan_hasil === 'string' ? body.satuan_hasil.trim() : current.satuan_hasil;
    const deskripsi = body.deskripsi !== undefined ? (typeof body.deskripsi === 'string' ? body.deskripsi.trim() : null) : current.deskripsi;
    const isAktif = typeof body.is_aktif === 'boolean' ? body.is_aktif : current.is_aktif;

    const res = await query<MasterAktivitas>(
      `UPDATE public.master_aktivitas
       SET nama_aktivitas = $1,
           komoditas = $2,
           kategori = $3,
           satuan_hasil = $4,
           deskripsi = $5,
           is_aktif = $6
       WHERE id = $7
       RETURNING id, kode_aktivitas, nama_aktivitas, komoditas, kategori, satuan_hasil, deskripsi, is_aktif, dibuat_pada;`,
      [nama, komoditas, kategori, satuanHasil, deskripsi, isAktif, id]
    );

    const updated = res.rows[0];

    await catatAktivitas(
      auth.user.id,
      'ubah_master_aktivitas',
      `Memperbarui master aktivitas "${updated.nama_aktivitas}" (${updated.kode_aktivitas}).`
    );

    return NextResponse.json({
      status: 'success',
      message: `Aktivitas "${updated.nama_aktivitas}" berhasil diperbarui.`,
      data: updated,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memperbarui master data aktivitas.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
