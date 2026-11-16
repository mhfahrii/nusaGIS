import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

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
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data atribut fitur.', detail: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
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

    // 2. Soft Delete: Tandai fitur sebagai terhapus tanpa menghapus data spasial fisik
    await query(
      'UPDATE public.fitur_peta SET is_deleted = TRUE, dihapus_pada = NOW() WHERE id = $1',
      [id]
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
    const error = err as Error;
    console.error('Delete feature error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghapus lahan.', detail: error.message },
      { status: 500 }
    );
  }
}
