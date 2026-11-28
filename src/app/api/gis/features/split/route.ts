import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';

interface SplitBody {
  feature_id?: number;
  line_coordinates?: [number, number][];
  part_names?: string[];
}

interface SplitPartRow {
  wkt: string;
  luas_ha: number;
}

/**
 * POST /api/gis/features/split
 * Membelah 1 fitur poligon di PostGIS memakai ST_Split berdasarkan garis potong [lng, lat][].
 * Fitur asal di-soft-delete agar tetap bisa dipulihkan dari Tempat Sampah jika salah potong.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { permission: 'edit_data' });
  if (auth.response) return auth.response;

  const body = (await req.json().catch(() => null)) as SplitBody | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ status: 'error', message: 'Format JSON body tidak valid.' }, { status: 400 });
  }

  const featureId = Number(body.feature_id);
  if (!Number.isInteger(featureId) || featureId <= 0) {
    return NextResponse.json({ status: 'error', message: 'feature_id wajib berupa angka positif.' }, { status: 400 });
  }

  const coords = Array.isArray(body.line_coordinates) ? body.line_coordinates : [];
  if (
    coords.length < 2 ||
    coords.some(
      (pt) =>
        !Array.isArray(pt) ||
        pt.length !== 2 ||
        !Number.isFinite(pt[0]) ||
        !Number.isFinite(pt[1]) ||
        Math.abs(pt[0]) > 180 ||
        Math.abs(pt[1]) > 90
    )
  ) {
    return NextResponse.json(
      { status: 'error', message: 'Garis potong wajib memiliki minimal 2 titik koordinat [lng, lat] yang valid.' },
      { status: 400 }
    );
  }

  const partNames = Array.isArray(body.part_names)
    ? body.part_names.map((n) => (typeof n === 'string' ? n.trim() : ''))
    : [];

  const lineGeoJson = JSON.stringify({ type: 'LineString', coordinates: coords });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const origRes = await client.query<{
      id: number;
      layer_id: number;
      atribut: Record<string, unknown> | null;
      geom_type: string;
    }>(
      `SELECT id, layer_id, atribut, ST_GeometryType(geom) AS geom_type
       FROM public.fitur_peta
       WHERE id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
       FOR UPDATE;`,
      [featureId]
    );

    if (origRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ status: 'error', message: 'Fitur poligon tidak ditemukan.' }, { status: 404 });
    }

    const orig = origRes.rows[0];
    if (orig.geom_type !== 'ST_Polygon' && orig.geom_type !== 'ST_MultiPolygon') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { status: 'error', message: 'Hanya fitur bertipe Poligon yang dapat dipotong.' },
        { status: 400 }
      );
    }

    // Potong poligon memakai ST_Split dan ambil bagian poligon >= 1 m2 dengan urutan kiri-ke-kanan deterministik.
    const splitRes = await client.query<SplitPartRow>(
      `SELECT
         ST_AsText(part_geom) AS wkt,
         ROUND((ST_Area(part_geom::geography) / 10000.0)::numeric, 4)::float AS luas_ha
       FROM (
         SELECT (ST_Dump(ST_Split(ST_MakeValid(fp.geom), ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)))).geom AS part_geom
         FROM public.fitur_peta fp
         WHERE fp.id = $1
       ) parts
       WHERE ST_GeometryType(part_geom) IN ('ST_Polygon', 'ST_MultiPolygon')
         AND ST_Area(part_geom::geography) >= 1.0
       ORDER BY ST_X(ST_Centroid(part_geom)) ASC, ST_Y(ST_Centroid(part_geom)) DESC;`,
      [featureId, lineGeoJson]
    );

    if ((splitRes.rowCount ?? 0) < 2) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          status: 'error',
          message: 'Garis potong harus membelah poligon dari satu sisi ke sisi lain hingga menghasilkan minimal 2 bagian.',
        },
        { status: 400 }
      );
    }

    const baseAttr = orig.atribut && typeof orig.atribut === 'object' ? { ...orig.atribut } : {};
    const origName = String(
      baseAttr.nama_blok || baseAttr.Name || baseAttr.BLOK || baseAttr.KODE_BLOK || `Blok #${featureId}`
    ).trim();

    await client.query(
      `UPDATE public.fitur_peta
       SET is_deleted = TRUE, dihapus_pada = NOW(), dihapus_oleh_user_id = $2
       WHERE id = $1;`,
      [featureId, auth.user.id]
    );

    const insertedParts: { id: number; nama_blok: string; luas_ha: number }[] = [];
    for (let i = 0; i < splitRes.rows.length; i++) {
      const part = splitRes.rows[i];
      const namaBaru = partNames[i] || `${origName} - Bagian ${i + 1}`;
      const partAttr: Record<string, unknown> = {
        ...baseAttr,
        nama_blok: namaBaru,
        _luas_geodesik_ha: part.luas_ha,
        _split_from_feature_id: featureId,
      };
      delete partAttr.blok_id;

      const ins = await client.query<{ id: number }>(
        `INSERT INTO public.fitur_peta (layer_id, geom, atribut, dibuat_oleh_user_id)
         VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3::jsonb, $4)
         RETURNING id;`,
        [orig.layer_id, part.wkt, JSON.stringify(partAttr), auth.user.id]
      );
      insertedParts.push({ id: Number(ins.rows[0].id), nama_blok: namaBaru, luas_ha: part.luas_ha });
    }

    await client.query(
      `UPDATE public.layer_peta
       SET jumlah_fitur = (
         SELECT COUNT(*)::int FROM public.fitur_peta
         WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
       )
       WHERE id = $1;`,
      [orig.layer_id]
    );

    await client.query('COMMIT');

    await catatAktivitas(
      auth.user.id,
      'potong_poligon',
      `Membelah poligon "${origName}" (ID #${featureId}) menjadi ${insertedParts.length} blok: ${insertedParts
        .map((p) => p.nama_blok)
        .join(', ')}.`
    );

    return NextResponse.json({
      status: 'success',
      message: `Poligon berhasil dipotong menjadi ${insertedParts.length} blok baru.`,
      data: {
        original_feature_id: featureId,
        layer_id: Number(orig.layer_id),
        parts: insertedParts,
      },
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return NextResponse.json(
      { status: 'error', message: 'Gagal memotong poligon.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
