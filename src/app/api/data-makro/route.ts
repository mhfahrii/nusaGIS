import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';
import type { DataMakroKebun, StatusHaraTanah } from '@/types/perkebunan';

const VALID_STATUS_HARA: StatusHaraTanah[] = ['optimal', 'normal', 'rendah', 'kritis'];

// GET /api/data-makro - Mengambil data makro iklim, curah hujan, status hara & NDVI (Kepala Kebun)
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const kebunIdParam = searchParams.get('kebun_id');
    const afdelingIdParam = searchParams.get('afdeling_id');
    const blokIdParam = searchParams.get('blok_id');

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (kebunIdParam) {
      params.push(Number(kebunIdParam));
      conditions.push(`m.kebun_id = $${params.length}`);
    }
    if (afdelingIdParam) {
      params.push(Number(afdelingIdParam));
      conditions.push(`m.afdeling_id = $${params.length}`);
    }
    if (blokIdParam) {
      params.push(Number(blokIdParam));
      conditions.push(`m.blok_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        m.id,
        m.kebun_id,
        m.afdeling_id,
        m.blok_id,
        m.pengguna_id,
        m.periode_bulan,
        m.curah_hujan_mm::float AS curah_hujan_mm,
        m.status_hara,
        m.ndvi_rata_rata::float AS ndvi_rata_rata,
        m.kelembaban_tanah::float AS kelembaban_tanah,
        m.catatan_lab,
        m.dibuat_pada,
        k.nama_kebun,
        a.nama_afdeling,
        b.nama_blok,
        u.nama AS nama_penginput
      FROM public.data_makro_kebun m
      JOIN public.kebun k ON m.kebun_id = k.id
      LEFT JOIN public.afdeling a ON m.afdeling_id = a.id
      LEFT JOIN public.blok b ON m.blok_id = b.id
      LEFT JOIN public.pengguna u ON m.pengguna_id = u.id
      ${whereClause}
      ORDER BY m.dibuat_pada DESC, m.id DESC
      LIMIT 100;
    `;

    const res = await query<DataMakroKebun>(sql, params);

    return NextResponse.json({
      status: 'success',
      total: res.rows.length,
      data: res.rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memuat data makro iklim & agronomi kebun.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// POST /api/data-makro - Kepala Kebun / Admin menginput data makro iklim (Curah Hujan, Status Hara, NDVI, Soil Moisture)
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ status: 'error', message: 'Payload JSON tidak valid.' }, { status: 400 });
    }

    const kebunId = Number(body.kebun_id);
    const afdelingId = body.afdeling_id ? Number(body.afdeling_id) : null;
    const blokId = body.blok_id ? Number(body.blok_id) : null;
    const periodeBulan =
      typeof body.periode_bulan === 'string' && body.periode_bulan.trim()
        ? body.periode_bulan.trim()
        : new Date().toISOString().slice(0, 7);
    const curahHujanMm =
      body.curah_hujan_mm !== undefined && body.curah_hujan_mm !== ''
        ? Math.max(0, Number(body.curah_hujan_mm))
        : 145;
    const rawHara = typeof body.status_hara === 'string' ? body.status_hara.toLowerCase() : 'normal';
    const statusHara: StatusHaraTanah = VALID_STATUS_HARA.includes(rawHara as StatusHaraTanah)
      ? (rawHara as StatusHaraTanah)
      : 'normal';
    const ndviRataRata =
      body.ndvi_rata_rata !== undefined && body.ndvi_rata_rata !== ''
        ? Math.min(1, Math.max(0.1, Number(body.ndvi_rata_rata)))
        : 0.71;
    const kelembabanTanah =
      body.kelembaban_tanah !== undefined && body.kelembaban_tanah !== ''
        ? Math.min(1, Math.max(0.05, Number(body.kelembaban_tanah)))
        : 0.28;
    const catatanLab =
      typeof body.catatan_lab === 'string' && body.catatan_lab.trim() ? body.catatan_lab.trim() : null;

    if (!Number.isSafeInteger(kebunId) || kebunId <= 0) {
      return NextResponse.json({ status: 'error', message: 'Pilih Unit Kebun terlebih dahulu.' }, { status: 400 });
    }

    const insRes = await query<DataMakroKebun>(
      `INSERT INTO public.data_makro_kebun (
         kebun_id, afdeling_id, blok_id, pengguna_id, periode_bulan,
         curah_hujan_mm, status_hara, ndvi_rata_rata, kelembaban_tanah, catatan_lab
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *;`,
      [
        kebunId,
        afdelingId,
        blokId,
        auth.user.id,
        periodeBulan,
        curahHujanMm,
        statusHara,
        ndviRataRata,
        kelembabanTanah,
        catatanLab,
      ]
    );

    // Sinkronkan data makro ke atribut poligon di fitur_peta (untuk blok spesifik atau seluruh blok di kebun tersebut)
    if (blokId) {
      await query(
        `UPDATE public.fitur_peta
         SET atribut = atribut || jsonb_build_object(
           'curah_hujan_mm', $1::numeric,
           'status_hara', $2::text,
           'ndvi', $3::numeric,
           'soil_moisture', $4::numeric,
           'catatan_lab_kepala_kebun', $5::text
         )
         WHERE (atribut->>'blok_id')::int = $6;`,
        [curahHujanMm, statusHara, ndviRataRata, kelembabanTanah, catatanLab || '', blokId]
      );
    } else {
      await query(
        `UPDATE public.fitur_peta f
         SET atribut = f.atribut || jsonb_build_object(
           'curah_hujan_mm', $1::numeric,
           'status_hara', $2::text,
           'ndvi', COALESCE((f.atribut->>'ndvi')::numeric, $3::numeric),
           'soil_moisture', COALESCE((f.atribut->>'soil_moisture')::numeric, $4::numeric)
         )
         FROM public.layer_peta l
         WHERE f.layer_id = l.id AND l.kebun_id = $5;`,
        [curahHujanMm, statusHara, ndviRataRata, kelembabanTanah, kebunId]
      );
    }

    await catatAktivitas(
      auth.user.id,
      'input_data_makro_kebun',
      `Menginput data makro iklim & hara (CH: ${curahHujanMm} mm, Hara: ${statusHara.toUpperCase()}, NDVI: ${ndviRataRata}) untuk Kebun ID #${kebunId}${blokId ? ` Blok #${blokId}` : ''}.`
    );

    return NextResponse.json(
      {
        status: 'success',
        message: 'Data Makro Iklim, Hara, & NDVI berhasil disimpan dan langsung memperbarui kalkulasi Root Cause Analysis (RCA).',
        data: insRes.rows[0],
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal menyimpan data makro kebun.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
