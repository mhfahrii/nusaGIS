import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';
import type { LaporanKendalaLapangan, StatusVerifikasiLaporan } from '@/types/perkebunan';

const VALID_STATUSES: StatusVerifikasiLaporan[] = [
  'menunggu_asisten',
  'diverifikasi_asisten',
  'disetujui_kepala_kebun',
  'ditolak',
  'selesai',
];

// GET /api/laporan-kendala - Mengambil daftar laporan kendala lapangan (fleksibel: jalan, hama, drainase, irigasi, batas, dll)
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const kebunIdParam = searchParams.get('kebun_id');
    const afdelingIdParam = searchParams.get('afdeling_id');
    const statusParam = searchParams.get('status');

    const conditions: string[] = [];
    const params: unknown[] = [];

    const assignedAfdId = auth.user.peran !== 'admin' && auth.user.afdeling_id ? Number(auth.user.afdeling_id) : null;

    if (assignedAfdId) {
      params.push(assignedAfdId);
      conditions.push(`l.afdeling_id = $${params.length}`);
    } else if (afdelingIdParam) {
      params.push(Number(afdelingIdParam));
      conditions.push(`l.afdeling_id = $${params.length}`);
    }
    if (kebunIdParam) {
      params.push(Number(kebunIdParam));
      conditions.push(`l.kebun_id = $${params.length}`);
    }
    if (statusParam && statusParam !== 'all') {
      params.push(statusParam);
      conditions.push(`l.status_verifikasi = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        l.id,
        l.kebun_id,
        l.afdeling_id,
        l.blok_id,
        l.fitur_id,
        l.pelapor_id,
        l.judul_kendala,
        l.kategori_kendala,
        l.tingkat_urgensi,
        l.deskripsi,
        l.koordinat_geojson,
        l.luas_area_ha::float AS luas_area_ha,
        l.status_verifikasi,
        l.diverifikasi_oleh,
        l.disetujui_oleh,
        l.catatan_tindak_lanjut,
        l.dibuat_pada,
        u.nama AS nama_pelapor,
        uv.nama AS nama_verifikator,
        ua.nama AS nama_approver,
        k.nama_kebun,
        a.nama_afdeling,
        b.nama_blok
      FROM public.laporan_kendala_lapangan l
      LEFT JOIN public.pengguna u ON l.pelapor_id = u.id
      LEFT JOIN public.pengguna uv ON l.diverifikasi_oleh = uv.id
      LEFT JOIN public.pengguna ua ON l.disetujui_oleh = ua.id
      LEFT JOIN public.kebun k ON l.kebun_id = k.id
      LEFT JOIN public.afdeling a ON l.afdeling_id = a.id
      LEFT JOIN public.blok b ON l.blok_id = b.id
      ${whereClause}
      ORDER BY
        CASE l.tingkat_urgensi WHEN 'darurat' THEN 0 WHEN 'sedang' THEN 1 ELSE 2 END,
        l.id DESC
      LIMIT 150;
    `;

    const res = await query<LaporanKendalaLapangan>(sql, params);

    return NextResponse.json({
      status: 'success',
      total: res.rows.length,
      data: res.rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memuat daftar laporan kendala lapangan.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// POST /api/laporan-kendala - Mandor / Karyawan mengirim laporan kendala (dari Dashboard atau dari Digitasi Kontrol Peta)
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ status: 'error', message: 'Payload JSON tidak valid.' }, { status: 400 });
    }

    const judul = typeof body.judul_kendala === 'string' ? body.judul_kendala.trim() : '';
    const kategori = typeof body.kategori_kendala === 'string' && body.kategori_kendala ? body.kategori_kendala : 'lainnya';
    const urgensi =
      body.tingkat_urgensi === 'darurat' || body.tingkat_urgensi === 'rendah'
        ? body.tingkat_urgensi
        : 'sedang';
    const deskripsi = typeof body.deskripsi === 'string' && body.deskripsi.trim() ? body.deskripsi.trim() : null;

    if (!judul || judul.length < 3) {
      return NextResponse.json(
        { status: 'error', message: 'Judul / Nama Kendala Lapangan wajib diisi (minimal 3 karakter).' },
        { status: 400 }
      );
    }

    let kebunId = body.kebun_id ? Number(body.kebun_id) : (auth.user.kebun_id ? Number(auth.user.kebun_id) : null);
    let afdelingId = body.afdeling_id ? Number(body.afdeling_id) : (auth.user.afdeling_id ? Number(auth.user.afdeling_id) : null);
    const blokId = body.blok_id ? Number(body.blok_id) : null;
    let fiturId = body.fitur_id ? Number(body.fitur_id) : null;
    const luasAreaHa = body.luas_area_ha ? Number(body.luas_area_ha) : null;

    if (blokId && (!kebunId || !afdelingId)) {
      const bRes = await query<{ kebun_id: number; afdeling_id: number | null }>(
        'SELECT kebun_id, afdeling_id FROM public.blok WHERE id = $1;',
        [blokId]
      );
      if (bRes.rows.length > 0) {
        kebunId = kebunId || Number(bRes.rows[0].kebun_id);
        afdelingId = afdelingId || (bRes.rows[0].afdeling_id ? Number(bRes.rows[0].afdeling_id) : null);
      }
    }

    // Jika dikirim dari Digitasi Kontrol Peta (memiliki coordinates array >= 3 titik & layer_id)
    let koordinatGeojson: unknown = body.koordinat_geojson || null;
    const rawCoords: [number, number][] = Array.isArray(body.coordinates) ? body.coordinates : [];
    const targetLayerId = body.layer_id ? Number(body.layer_id) : null;

    if (rawCoords.length >= 3) {
      const ring = [...rawCoords];
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }
      const geojsonObj = {
        type: 'MultiPolygon',
        coordinates: [[ring]],
      };
      koordinatGeojson = geojsonObj;

      // Simpan juga ke fitur_peta jika targetLayerId tersedia agar area kendala langsung tampil sebagai poligon di peta!
      if (targetLayerId && Number.isSafeInteger(targetLayerId) && targetLayerId > 0) {
        try {
          const atributKendala = {
            Name: `[KENDALA] ${judul}`,
            nama_blok: `[KENDALA] ${judul}`,
            kategori_kendala: kategori,
            tingkat_urgensi: urgensi,
            status_lahan: `KENDALA: ${kategori.replace(/_/g, ' ').toUpperCase()}`,
            aktivitas_terakhir: `Laporan Kendala (${urgensi.toUpperCase()}): ${judul}`,
            tanggal_aktivitas_terakhir: new Date().toISOString().slice(0, 10),
            status_risiko_manual: urgensi === 'darurat' ? 'kritis' : 'waspada',
            pelapor: auth.user.nama,
            keterangan: deskripsi || '',
            Luas: luasAreaHa || 0,
          };

          const featIns = await query<{ id: number }>(
            `INSERT INTO public.fitur_peta (layer_id, geom, atribut)
             VALUES (
               $1,
               ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))),
               $3::jsonb
             )
             RETURNING id;`,
            [targetLayerId, JSON.stringify(geojsonObj), JSON.stringify(atributKendala)]
          );
          if (featIns.rows.length > 0) {
            fiturId = Number(featIns.rows[0].id);
            await query(
              `UPDATE public.layer_peta
               SET jumlah_fitur = (SELECT COUNT(*)::int FROM public.fitur_peta WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE)
               WHERE id = $1;`,
              [targetLayerId]
            );
          }
        } catch (geomErr) {
          console.warn('Notice creating spatial feature for kendala:', geomErr);
        }
      }
    }

    const insRes = await query<LaporanKendalaLapangan>(
      `INSERT INTO public.laporan_kendala_lapangan (
         kebun_id, afdeling_id, blok_id, fitur_id, pelapor_id,
         judul_kendala, kategori_kendala, tingkat_urgensi, deskripsi,
         koordinat_geojson, luas_area_ha, status_verifikasi
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, 'menunggu_asisten')
       RETURNING *;`,
      [
        kebunId,
        afdelingId,
        blokId,
        fiturId,
        auth.user.id,
        judul,
        kategori,
        urgensi,
        deskripsi,
        koordinatGeojson ? JSON.stringify(koordinatGeojson) : null,
        luasAreaHa,
      ]
    );

    // Jika laporan terkait blok tertentu, update status risiko blok menjadi waspada/kritis
    if (blokId) {
      const riskLevel = urgensi === 'darurat' ? 'kritis' : 'waspada';
      await query(
        `UPDATE public.fitur_peta
         SET atribut = atribut || jsonb_build_object(
           'status_risiko_manual', $1::text,
           'kendala_aktif', $2::text
         )
         WHERE (atribut->>'blok_id')::int = $3;`,
        [riskLevel, `${judul} (${urgensi.toUpperCase()})`, blokId]
      );
    }

    await catatAktivitas(
      auth.user.id,
      'lapor_kendala_lapangan',
      `Melaporkan kendala lapangan "${judul}" [Kategori: ${kategori}, Urgensi: ${urgensi.toUpperCase()}].`
    );

    return NextResponse.json(
      {
        status: 'success',
        message: `Laporan kendala "${judul}" berhasil dikirim ke Asisten Kebun & Kepala Kebun.`,
        data: insRes.rows[0],
        fitur_id: fiturId,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal mengirim laporan kendala lapangan.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// PATCH /api/laporan-kendala - Konfirmasi Asisten Kebun -> Persetujuan Kepala Kebun
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
    const catatanTindakLanjut =
      typeof body.catatan_tindak_lanjut === 'string' ? body.catatan_tindak_lanjut.trim() : null;

    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ status: 'error', message: 'ID laporan tidak valid.' }, { status: 400 });
    }
    if (!VALID_STATUSES.includes(nextStatus)) {
      return NextResponse.json({ status: 'error', message: 'Status verifikasi tidak valid.' }, { status: 400 });
    }

    const isVerifAsisten = nextStatus === 'diverifikasi_asisten';
    const isApproveKepala = nextStatus === 'disetujui_kepala_kebun' || nextStatus === 'selesai';

    const updRes = await query<LaporanKendalaLapangan>(
      `UPDATE public.laporan_kendala_lapangan
       SET status_verifikasi = $1,
           diverifikasi_oleh = CASE WHEN $2 THEN $4 ELSE COALESCE(diverifikasi_oleh, $4) END,
           disetujui_oleh = CASE WHEN $3 THEN $4 ELSE disetujui_oleh END,
           catatan_tindak_lanjut = COALESCE($5, catatan_tindak_lanjut)
       WHERE id = $6
       RETURNING *;`,
      [nextStatus, isVerifAsisten, isApproveKepala, auth.user.id, catatanTindakLanjut, id]
    );

    if (updRes.rows.length === 0) {
      return NextResponse.json({ status: 'error', message: 'Laporan kendala tidak ditemukan.' }, { status: 404 });
    }

    await catatAktivitas(
      auth.user.id,
      'verifikasi_laporan_kendala',
      `Memperbarui status laporan kendala #${id} ("${updRes.rows[0].judul_kendala}") menjadi ${nextStatus}.`
    );

    return NextResponse.json({
      status: 'success',
      message: `Status laporan kendala diperbarui menjadi "${nextStatus.replace(/_/g, ' ').toUpperCase()}".`,
      data: updRes.rows[0],
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memperbarui status laporan kendala.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
