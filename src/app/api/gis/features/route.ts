import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, safeErrorDetail } from '@/lib/auth/guard';

interface FeatureDbRow {
  id: number;
  layer_id: number;
  atribut: Record<string, unknown>;
  dibuat_pada: string;
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const layerIdParam = searchParams.get('layer_id');
    const search = searchParams.get('search')?.trim();
    const sortBy = searchParams.get('sortBy')?.trim() || 'id';
    const sortDirParam = (searchParams.get('sortDir') || 'asc').toUpperCase();
    const sortDir = sortDirParam === 'DESC' ? 'DESC' : 'ASC';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    if (!layerIdParam) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "layer_id" wajib disertakan.' },
        { status: 400 }
      );
    }

    const layerId = parseInt(layerIdParam, 10);

    // Ambil kunci atribut (kolom dinamis dari DBF/JSONB)
    const keysRes = await query<{ col_key: string }>(
      `SELECT DISTINCT jsonb_object_keys(atribut) as col_key
       FROM fitur_peta
       WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
       LIMIT 40;`,
      [layerId]
    );
    const columns = keysRes.rows.map((r) => r.col_key);

    let whereClause = 'WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE';
    const params: unknown[] = [layerId];

    if (search) {
      whereClause += ` AND atribut::text ILIKE $2`;
      params.push(`%${search}%`);
    }

    // Hitung total record
    const countRes = await query<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM fitur_peta ${whereClause};`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    // Tentukan ekspresi pengurutan yang aman (parameterized / whitelist dari columns)
    let orderClause = `ORDER BY id ${sortDir}`;
    if (sortBy !== 'id' && columns.includes(sortBy)) {
      params.push(sortBy);
      const sortParamIdx = params.length;
      orderClause = `ORDER BY atribut->>$${sortParamIdx} ${sortDir} NULLS LAST, id ASC`;
    }

    // Ambil baris beserta bounding box spasial (EPSG:4326) per fitur
    params.push(limit);
    params.push(offset);
    const dataRes = await query<FeatureDbRow>(
      `SELECT
         id,
         layer_id,
         atribut,
         dibuat_pada,
         ST_XMin(ST_Envelope(geom))::float AS west,
         ST_YMin(ST_Envelope(geom))::float AS south,
         ST_XMax(ST_Envelope(geom))::float AS east,
         ST_YMax(ST_Envelope(geom))::float AS north
       FROM fitur_peta
       ${whereClause}
       ${orderClause}
       LIMIT $${params.length - 1} OFFSET $${params.length};`,
      params
    );

    return NextResponse.json({
      status: 'success',
      total,
      columns,
      limit,
      offset,
      sortBy,
      sortDir: sortDir.toLowerCase(),
      data: dataRes.rows.map((r) => {
        let bbox: [number, number, number, number] | null = null;
        if (
          r.west !== null &&
          r.south !== null &&
          r.east !== null &&
          r.north !== null &&
          Number.isFinite(Number(r.west))
        ) {
          let west = Number(r.west);
          let south = Number(r.south);
          let east = Number(r.east);
          let north = Number(r.north);
          if (Math.abs(east - west) < 0.0001 && Math.abs(north - south) < 0.0001) {
            west -= 0.001;
            east += 0.001;
            south -= 0.001;
            north += 0.001;
          }
          bbox = [west, south, east, north];
        }
        return {
          id: Number(r.id),
          layer_id: Number(r.layer_id),
          _bbox: bbox,
          ...r.atribut,
        };
      }),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data atribut fitur.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req, { requireJson: false, permission: 'hapus_data' });
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const id = idParam ? parseInt(idParam, 10) : null;

    if (!id || isNaN(id)) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "id" fitur wajib disertakan.' },
        { status: 400 }
      );
    }

    // 1. Ambil info fitur & layer sebelum dihapus
    const featRes = await query<{
      id: number;
      layer_id: number;
      atribut: Record<string, unknown>;
    }>('SELECT id, layer_id, atribut FROM public.fitur_peta WHERE id = $1', [id]);

    if (featRes.rows.length === 0) {
      return NextResponse.json({
        status: 'success',
        message: 'Lahan sudah terhapus dari database.',
        data: { id, layer_id: null, alreadyDeleted: true },
      });
    }

    const feature = featRes.rows[0];
    const layerId = feature.layer_id;
    const featName = String(
      feature.atribut?.Name ||
      feature.atribut?.nama_blok ||
      feature.atribut?.KODE_BLOK ||
      `Fitur #${id}`
    );

    // 2. Soft Delete: Tandai fitur sebagai terhapus tanpa menghapus data spasial fisik (Audit Trail)
    await query(
      'UPDATE public.fitur_peta SET is_deleted = TRUE, dihapus_pada = NOW(), dihapus_oleh_user_id = $2 WHERE id = $1',
      [id, auth.user.id]
    );

    // 3. Update jumlah fitur aktif di layer_peta
    await query(
      `UPDATE public.layer_peta
       SET jumlah_fitur = (SELECT COUNT(*)::int FROM public.fitur_peta WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE)
       WHERE id = $1`,
      [layerId]
    );

    // 4. Catat riwayat aktivitas audit trail
    try {
      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'soft_delete_fitur',
          `Menghapus lahan ${featName} (Layer ID: ${layerId}, Fitur ID: ${id}).`,
        ]
      );
    } catch (logErr) {
      console.warn('Logging error:', logErr);
    }

    return NextResponse.json({
      status: 'success',
      message: `Lahan "${featName}" berhasil dihapus.`,
      data: { id, layer_id: layerId },
    });
  } catch (err: unknown) {
    console.error('Delete feature error:', err);
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghapus lahan.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}

// PATCH /api/gis/features - Inline Edit Nilai Atribut dari Pop-up Peta GIS & Sinkronisasi ke Tabel Blok
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ status: 'error', message: 'Format JSON tidak valid.' }, { status: 400 });
    }

    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ status: 'error', message: 'ID fitur poligon tidak valid.' }, { status: 400 });
    }

    const featRes = await query<{
      id: number;
      layer_id: number;
      atribut: Record<string, unknown>;
      kebun_id: number | null;
    }>(
      `SELECT f.id, f.layer_id, f.atribut, l.kebun_id
       FROM public.fitur_peta f
       JOIN public.layer_peta l ON f.layer_id = l.id
       WHERE f.id = $1 AND COALESCE(f.is_deleted, FALSE) = FALSE;`,
      [id]
    );

    if (featRes.rows.length === 0) {
      return NextResponse.json({ status: 'error', message: 'Fitur poligon tidak ditemukan.' }, { status: 404 });
    }

    const feat = featRes.rows[0];
    const currentAttr = { ...(feat.atribut || {}) };

    // Kolom yang diizinkan untuk diedit nilainya (Value Editable):
    // 1. Nama Blok / Petak
    if (typeof body.nama_blok === 'string' && body.nama_blok.trim()) {
      const val = body.nama_blok.trim();
      currentAttr.Name = val;
      currentAttr.nama_blok = val;
      currentAttr.nama_unit = val;
    }

    // 2. Luas Baku Dokumen (Ha) — Luas Ukur GIS tetap TERKUNCI otomatis dari PostGIS
    if (body.luas_baku !== undefined && body.luas_baku !== '') {
      const num = parseFloat(String(body.luas_baku));
      if (Number.isFinite(num) && num >= 0) {
        currentAttr.luas_baku = num;
        currentAttr.Luas_Baku = num;
      }
    }

    // 3. Komoditas
    if (typeof body.komoditas === 'string' && body.komoditas.trim()) {
      currentAttr.komoditas = body.komoditas.trim();
      currentAttr.Komoditas = body.komoditas.trim();
    }

    // 4. Afdeling / Klaster
    if (typeof body.afdeling === 'string') {
      currentAttr.afdeling = body.afdeling.trim();
      currentAttr.Afdeling = body.afdeling.trim();
    }

    // 5. Status Lahan
    if (typeof body.status_lahan === 'string') {
      currentAttr.status_lahan = body.status_lahan.trim();
      currentAttr.status = body.status_lahan.trim();
    }

    // 6. Target Produksi / Estimasi Tonase (Opsional Override)
    if (body.target_produksi_ton !== undefined && body.target_produksi_ton !== '') {
      const tNum = parseFloat(String(body.target_produksi_ton));
      if (Number.isFinite(tNum) && tNum >= 0) {
        currentAttr.target_produksi_ton = tNum;
        currentAttr.estimasi_panen_ton = tNum;
      }
    }

    const updRes = await query<{ id: number; layer_id: number; atribut: Record<string, unknown> }>(
      `UPDATE public.fitur_peta
       SET atribut = $1::jsonb
       WHERE id = $2
       RETURNING id, layer_id, atribut;`,
      [JSON.stringify(currentAttr), id]
    );

    // Sinkronkan juga ke tabel master public.blok
    const blokId = Number(currentAttr.blok_id) || null;
    const nextNamaBlok = String(currentAttr.nama_blok || currentAttr.Name || '').trim();
    const nextKomoditas = String(currentAttr.komoditas || currentAttr.Komoditas || '').trim() || null;

    if (blokId) {
      await query(
        `UPDATE public.blok
         SET nama_blok = COALESCE(NULLIF($1, ''), nama_blok),
             komoditas = COALESCE($2, komoditas)
         WHERE id = $3;`,
        [nextNamaBlok, nextKomoditas, blokId]
      );
    } else if (feat.kebun_id && nextNamaBlok) {
      await query(
        `UPDATE public.blok
         SET komoditas = COALESCE($1, komoditas)
         WHERE kebun_id = $2 AND LOWER(nama_blok) = LOWER($3);`,
        [nextKomoditas, feat.kebun_id, nextNamaBlok]
      );
    }

    await query(
      `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
       VALUES ($1, $2, $3);`,
      [
        auth.user.id,
        'inline_edit_popup_peta',
        `Mengedit informasi pop-up poligon "${nextNamaBlok || `#${id}`}" (Komoditas: ${nextKomoditas || '-'}, Status: ${currentAttr.status_lahan || '-'}).`,
      ]
    ).catch(() => {});

    return NextResponse.json({
      status: 'success',
      message: `Informasi poligon "${nextNamaBlok || `#${id}`}" berhasil diperbarui.`,
      data: updRes.rows[0],
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal menyimpan perubahan atribut poligon.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
