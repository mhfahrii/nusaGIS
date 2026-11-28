import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';
import type { CatatanAktivitasBlok, StatusVerifikasiLaporan } from '@/types/perkebunan';

const VALID_VERIFICATION_STATUSES: StatusVerifikasiLaporan[] = [
  'menunggu_asisten',
  'diverifikasi_asisten',
  'disetujui_kepala_kebun',
  'ditolak',
  'selesai',
];

// GET /api/catatan-aktivitas - Mengambil daftar catatan harian lapangan (terfilter otomatis jika akun mandor afdeling)
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const blokId = searchParams.get('blok_id');
    const afdelingIdParam = searchParams.get('afdeling_id');
    const kebunIdParam = searchParams.get('kebun_id');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10), 1), 300);

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Jika user ditugaskan di 1 afdeling tertentu (Mandor) dan bukan Admin, batasi ke afdeling penugasannya
    const assignedAfdId = auth.user.peran !== 'admin' && auth.user.afdeling_id ? Number(auth.user.afdeling_id) : null;

    if (blokId) {
      params.push(Number(blokId));
      conditions.push(`c.blok_id = $${params.length}`);
    }
    if (assignedAfdId) {
      params.push(assignedAfdId);
      conditions.push(`b.afdeling_id = $${params.length}`);
    } else if (afdelingIdParam) {
      params.push(Number(afdelingIdParam));
      conditions.push(`b.afdeling_id = $${params.length}`);
    }
    if (kebunIdParam) {
      params.push(Number(kebunIdParam));
      conditions.push(`b.kebun_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const sql = `
      SELECT
        c.id,
        c.blok_id,
        c.aktivitas_id,
        c.pengguna_id,
        TO_CHAR(c.tanggal_aktivitas, 'YYYY-MM-DD') AS tanggal_aktivitas,
        c.volume_hasil::float AS volume_hasil,
        c.satuan,
        c.tenaga_kerja_hk,
        c.pusingan_petik,
        c.persen_peko::float AS persen_peko,
        c.kondisi_tanaman,
        c.status_risiko_manual,
        c.catatan,
        COALESCE(c.status_verifikasi, 'menunggu_asisten') AS status_verifikasi,
        c.diverifikasi_oleh,
        c.disetujui_oleh,
        c.catatan_verifikasi,
        c.dibuat_pada,
        m.nama_aktivitas,
        m.kode_aktivitas,
        m.kategori AS kategori_aktivitas,
        m.komoditas,
        b.nama_blok,
        b.kode_blok,
        b.kebun_id,
        b.afdeling_id,
        a.nama_afdeling,
        k.nama_kebun,
        u.nama AS nama_petugas,
        uv.nama AS nama_verifikator,
        ua.nama AS nama_approver
      FROM public.catatan_aktivitas_blok c
      JOIN public.master_aktivitas m ON c.aktivitas_id = m.id
      JOIN public.blok b ON c.blok_id = b.id
      LEFT JOIN public.afdeling a ON b.afdeling_id = a.id
      LEFT JOIN public.kebun k ON b.kebun_id = k.id
      LEFT JOIN public.pengguna u ON c.pengguna_id = u.id
      LEFT JOIN public.pengguna uv ON c.diverifikasi_oleh = uv.id
      LEFT JOIN public.pengguna ua ON c.disetujui_oleh = ua.id
      ${whereClause}
      ORDER BY c.tanggal_aktivitas DESC, c.id DESC
      LIMIT $${params.length};
    `;

    const res = await query<CatatanAktivitasBlok>(sql, params);

    return NextResponse.json({
      status: 'success',
      total: res.rows.length,
      data: res.rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memuat riwayat catatan aktivitas harian.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// POST /api/catatan-aktivitas - Mandor / Karyawan menginput catatan harian blok (Opsi C: Langsung update popup & risiko + antrean verifikasi)
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ status: 'error', message: 'Payload JSON tidak valid.' }, { status: 400 });
    }

    const blokId = Number(body.blok_id);
    const aktivitasId = Number(body.aktivitas_id);
    const tanggal = typeof body.tanggal_aktivitas === 'string' && body.tanggal_aktivitas ? body.tanggal_aktivitas : new Date().toISOString().slice(0, 10);
    const volumeHasil = body.volume_hasil !== undefined && body.volume_hasil !== '' ? Number(body.volume_hasil) : 0;
    const satuan = typeof body.satuan === 'string' && body.satuan.trim() ? body.satuan.trim() : 'Kg';
    const tenagaKerjaHk = body.tenaga_kerja_hk !== undefined && body.tenaga_kerja_hk !== '' ? parseInt(String(body.tenaga_kerja_hk), 10) : 0;
    const pusinganPetik = body.pusingan_petik !== undefined && body.pusingan_petik !== '' ? parseInt(String(body.pusingan_petik), 10) : null;
    const persenPeko = body.persen_peko !== undefined && body.persen_peko !== '' ? Number(body.persen_peko) : null;
    const kondisiTanaman = typeof body.kondisi_tanaman === 'string' ? body.kondisi_tanaman : 'sehat';
    const statusRisikoManual = typeof body.status_risiko_manual === 'string' ? body.status_risiko_manual : 'normal';
    const catatan = typeof body.catatan === 'string' && body.catatan.trim() ? body.catatan.trim() : null;

    if (!Number.isSafeInteger(blokId) || blokId <= 0) {
      return NextResponse.json({ status: 'error', message: 'Pilih Blok / Petak tujuan terlebih dahulu.' }, { status: 400 });
    }
    if (!Number.isSafeInteger(aktivitasId) || aktivitasId <= 0) {
      return NextResponse.json({ status: 'error', message: 'Pilih Jenis Aktivitas dari Master Data.' }, { status: 400 });
    }

    // Validasi blok & hak akses afdeling mandor
    const blokRes = await query<{
      id: number;
      kebun_id: number;
      afdeling_id: number | null;
      nama_blok: string;
      kode_blok: string;
    }>('SELECT id, kebun_id, afdeling_id, nama_blok, kode_blok FROM public.blok WHERE id = $1;', [blokId]);

    if (blokRes.rows.length === 0) {
      return NextResponse.json({ status: 'error', message: 'Data blok tidak ditemukan.' }, { status: 404 });
    }
    const blok = blokRes.rows[0];

    if (auth.user.peran !== 'admin' && auth.user.afdeling_id && Number(blok.afdeling_id) !== Number(auth.user.afdeling_id)) {
      return NextResponse.json(
        { status: 'error', message: 'Anda hanya dapat menginput catatan harian untuk blok di dalam afdeling penugasan Anda.' },
        { status: 403 }
      );
    }

    const aktRes = await query<{ id: number; nama_aktivitas: string; satuan_hasil: string }>(
      'SELECT id, nama_aktivitas, satuan_hasil FROM public.master_aktivitas WHERE id = $1;',
      [aktivitasId]
    );
    if (aktRes.rows.length === 0) {
      return NextResponse.json({ status: 'error', message: 'Master aktivitas tidak ditemukan.' }, { status: 404 });
    }
    const akt = aktRes.rows[0];
    const effectiveSatuan = satuan || akt.satuan_hasil || 'Kg';

    // Insert catatan harian dengan status awal 'menunggu_asisten' (atau langsung disetujui jika admin)
    const initialVerif: StatusVerifikasiLaporan = auth.user.peran === 'admin' ? 'disetujui_kepala_kebun' : 'menunggu_asisten';

    const insRes = await query<CatatanAktivitasBlok>(
      `INSERT INTO public.catatan_aktivitas_blok (
         blok_id, aktivitas_id, pengguna_id, tanggal_aktivitas, volume_hasil, satuan,
         tenaga_kerja_hk, pusingan_petik, persen_peko, kondisi_tanaman, status_risiko_manual,
         catatan, status_verifikasi
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *;`,
      [
        blokId,
        aktivitasId,
        auth.user.id,
        tanggal,
        volumeHasil,
        effectiveSatuan,
        tenagaKerjaHk,
        pusinganPetik,
        persenPeko,
        kondisiTanaman,
        statusRisikoManual,
        catatan,
        initialVerif,
      ]
    );

    // Format ringkasan aktivitas terakhir untuk tampil di Pop-up Peta GIS
    const volText = volumeHasil > 0 ? ` (${volumeHasil} ${effectiveSatuan}${tenagaKerjaHk > 0 ? `, ${tenagaKerjaHk} HK` : ''})` : tenagaKerjaHk > 0 ? ` (${tenagaKerjaHk} HK)` : '';
    const ringkasanAktivitas = `${akt.nama_aktivitas}${volText}`;

    // 1. Update tabel master public.blok
    await query(
      `UPDATE public.blok
       SET aktivitas_terakhir = $1,
           tanggal_aktivitas_terakhir = $2
       WHERE id = $3;`,
      [ringkasanAktivitas, tanggal, blokId]
    );

    // 2. Sinkronkan ke atribut JSONB poligon di public.fitur_peta agar Pop-up Peta langsung menampilkan Aktivitas Terakhir & Status
    await query(
      `UPDATE public.fitur_peta f
       SET atribut = f.atribut || jsonb_build_object(
         'blok_id', $1::int,
         'aktivitas_terakhir', $2::text,
         'tanggal_aktivitas_terakhir', $3::text,
         'kondisi_tanaman', $4::text,
         'status_risiko_manual', $5::text,
         'status_verifikasi_aktivitas', $6::text,
         'petugas_terakhir', $7::text
       )
       FROM public.layer_peta l
       WHERE f.layer_id = l.id
         AND l.kebun_id = $8
         AND (
           (f.atribut->>'blok_id')::int = $1
           OR LOWER(TRIM(COALESCE(f.atribut->>'Name', f.atribut->>'nama_blok', f.atribut->>'nama_unit', f.atribut->>'block', ''))) = LOWER(TRIM($9))
           OR LOWER(TRIM(COALESCE(f.atribut->>'kode_blok', f.atribut->>'Kode_Kebun', ''))) = LOWER(TRIM($10))
         );`,
      [
        blokId,
        ringkasanAktivitas,
        tanggal,
        kondisiTanaman,
        statusRisikoManual,
        initialVerif,
        auth.user.nama,
        blok.kebun_id,
        blok.nama_blok,
        blok.kode_blok,
      ]
    );

    await catatAktivitas(
      auth.user.id,
      'input_catatan_harian',
      `Mencatat aktivitas "${ringkasanAktivitas}" pada ${blok.nama_blok} tanggal ${tanggal}.`
    );

    return NextResponse.json(
      {
        status: 'success',
        message: `Catatan harian untuk "${blok.nama_blok}" berhasil disimpan dan disinkronkan ke Peta GIS.`,
        data: insRes.rows[0],
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal menyimpan catatan aktivitas harian.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// PATCH /api/catatan-aktivitas - Verifikasi Asisten Kebun -> Persetujuan Kepala Kebun
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ status: 'error', message: 'Payload JSON tidak valid.' }, { status: 400 });
    }

    const id = Number(body.id);
    const nextStatus = body.status_verifikasi as StatusVerifikasiLaporan;
    const catatanVerifikasi = typeof body.catatan_verifikasi === 'string' ? body.catatan_verifikasi.trim() : null;

    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ status: 'error', message: 'ID catatan tidak valid.' }, { status: 400 });
    }
    if (!VALID_VERIFICATION_STATUSES.includes(nextStatus)) {
      return NextResponse.json({ status: 'error', message: 'Status verifikasi tidak valid.' }, { status: 400 });
    }

    const isVerifAsisten = nextStatus === 'diverifikasi_asisten';
    const isApproveKepala = nextStatus === 'disetujui_kepala_kebun';

    const updRes = await query<CatatanAktivitasBlok>(
      `UPDATE public.catatan_aktivitas_blok
       SET status_verifikasi = $1,
           diverifikasi_oleh = CASE WHEN $2 THEN $4 ELSE COALESCE(diverifikasi_oleh, $4) END,
           disetujui_oleh = CASE WHEN $3 THEN $4 ELSE disetujui_oleh END,
           catatan_verifikasi = COALESCE($5, catatan_verifikasi)
       WHERE id = $6
       RETURNING *;`,
      [nextStatus, isVerifAsisten, isApproveKepala, auth.user.id, catatanVerifikasi, id]
    );

    if (updRes.rows.length === 0) {
      return NextResponse.json({ status: 'error', message: 'Catatan aktivitas tidak ditemukan.' }, { status: 404 });
    }

    const updated = updRes.rows[0];

    // Sinkronkan status verifikasi terbaru ke poligon fitur_peta
    await query(
      `UPDATE public.fitur_peta
       SET atribut = atribut || jsonb_build_object('status_verifikasi_aktivitas', $1::text)
       WHERE (atribut->>'blok_id')::int = $2;`,
      [nextStatus, Number(updated.blok_id)]
    );

    await catatAktivitas(
      auth.user.id,
      'verifikasi_catatan_harian',
      `Mengubah status verifikasi catatan harian #${id} menjadi ${nextStatus}.`
    );

    return NextResponse.json({
      status: 'success',
      message: `Status catatan harian berhasil diperbarui menjadi "${nextStatus.replace(/_/g, ' ').toUpperCase()}".`,
      data: updated,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memperbarui status verifikasi catatan harian.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
