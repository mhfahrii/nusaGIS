import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, catatAktivitas } from '@/lib/auth/guard';
import type { LayerPeta } from '@/types/gis';

interface LayerDbRow {
  id: number;
  unggahan_id: number;
  kebun_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
  nama_layer: string;
  nama_file_shp: string | null;
  tipe_geometri: string;
  warna: string;
  transparansi: number;
  terlihat: boolean;
  urutan: number;
  jumlah_fitur: number;
  crs_asal: string | null;
  srid_asal: number | null;
  nama_kebun: string | null;
  kode_kebun: string | null;
  nama_dataset: string | null;
  dibuat_pada: string;
  min_x: number | null;
  min_y: number | null;
  max_x: number | null;
  max_y: number | null;
}

// GET /api/gis/layers - Mengambil daftar seluruh layer aktif
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const kebunIdParam = searchParams.get('kebun_id');
    const afdelingIdParam = searchParams.get('afdeling_id');
    const blokIdParam = searchParams.get('blok_id');

    const params: unknown[] = [];
    const whereClauses: string[] = [];

    if (kebunIdParam && !isNaN(Number(kebunIdParam)) && Number(kebunIdParam) > 0) {
      params.push(Number(kebunIdParam));
      whereClauses.push(`l.kebun_id = $${params.length}`);
    }

    if (afdelingIdParam && !isNaN(Number(afdelingIdParam)) && Number(afdelingIdParam) > 0) {
      params.push(Number(afdelingIdParam));
      whereClauses.push(`l.afdeling_id = $${params.length}`);
    }

    if (blokIdParam && !isNaN(Number(blokIdParam)) && Number(blokIdParam) > 0) {
      params.push(Number(blokIdParam));
      whereClauses.push(`l.blok_id = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const res = await query<LayerDbRow>(
      `
      SELECT 
        l.id,
        l.unggahan_id,
        l.kebun_id,
        l.afdeling_id,
        l.blok_id,
        l.nama_layer,
        l.nama_file_shp,
        l.tipe_geometri,
        l.warna,
        l.transparansi,
        l.terlihat,
        l.urutan,
        l.jumlah_fitur,
        COALESCE(l.crs_asal, du.crs_asal, 'GCS_WGS_1984 (EPSG:4326)') as crs_asal,
        COALESCE(l.srid_asal, du.srid_asal, 4326) as srid_asal,
        k.nama_kebun,
        k.kode_kebun,
        du.nama_data as nama_dataset,
        l.dibuat_pada,
        ST_XMin(ST_Extent(f.geom))::float8 as min_x,
        ST_YMin(ST_Extent(f.geom))::float8 as min_y,
        ST_XMax(ST_Extent(f.geom))::float8 as max_x,
        ST_YMax(ST_Extent(f.geom))::float8 as max_y
      FROM public.layer_peta l
      LEFT JOIN public.kebun k ON l.kebun_id = k.id
      LEFT JOIN public.data_unggahan du ON l.unggahan_id = du.id
      LEFT JOIN public.fitur_peta f ON l.id = f.layer_id
      ${whereSql}
      GROUP BY l.id, k.nama_kebun, k.kode_kebun, du.nama_data, du.crs_asal, du.srid_asal
      ORDER BY l.urutan ASC, l.id ASC;
    `,
      params
    );

    const layers: LayerPeta[] = res.rows.map((row) => {
      const hasExtent =
        row.min_x !== null && row.min_y !== null && row.max_x !== null && row.max_y !== null;
      return {
        id: Number(row.id),
        unggahan_id: Number(row.unggahan_id),
        kebun_id: row.kebun_id ? Number(row.kebun_id) : null,
        afdeling_id: row.afdeling_id ? Number(row.afdeling_id) : null,
        blok_id: row.blok_id ? Number(row.blok_id) : null,
        nama_layer: row.nama_layer,
        nama_file_shp: row.nama_file_shp,
        tipe_geometri: row.tipe_geometri,
        warna: row.warna,
        transparansi: Number(row.transparansi),
        terlihat: Boolean(row.terlihat),
        urutan: Number(row.urutan),
        jumlah_fitur: Number(row.jumlah_fitur),
        crs_asal: row.crs_asal,
        srid_asal: row.srid_asal ? Number(row.srid_asal) : 4326,
        nama_kebun: row.nama_kebun,
        kode_kebun: row.kode_kebun,
        nama_dataset: row.nama_dataset,
        dibuat_pada: row.dibuat_pada,
        bbox: hasExtent
          ? [Number(row.min_x), Number(row.min_y), Number(row.max_x), Number(row.max_y)]
          : null,
        extent: hasExtent
          ? {
              west: Number(row.min_x),
              south: Number(row.min_y),
              east: Number(row.max_x),
              north: Number(row.max_y),
            }
          : null,
      };
    });

    return NextResponse.json({
      status: 'success',
      total: layers.length,
      data: layers,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Get Layers Error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data layer.', detail: error.message },
      { status: 500 }
    );
  }
}

// PATCH /api/gis/layers - Mengubah properti layer (visibility, warna, nama, transparansi)
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.id) {
      return NextResponse.json(
        { status: 'error', message: 'Field "id" layer wajib diisi.' },
        { status: 400 }
      );
    }

    const id = parseInt(body.id, 10);
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.terlihat !== undefined) {
      updates.push(`terlihat = $${idx++}`);
      values.push(Boolean(body.terlihat));
    }
    if (body.warna !== undefined && typeof body.warna === 'string') {
      updates.push(`warna = $${idx++}`);
      values.push(body.warna.trim());
    }
    if (body.transparansi !== undefined && typeof body.transparansi === 'number') {
      updates.push(`transparansi = $${idx++}`);
      values.push(Math.max(0, Math.min(1, body.transparansi)));
    }
    if (body.nama_layer !== undefined && typeof body.nama_layer === 'string') {
      updates.push(`nama_layer = $${idx++}`);
      values.push(body.nama_layer.trim());
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'Tidak ada field yang diperbarui.' },
        { status: 400 }
      );
    }

    values.push(id);
    const res = await query<LayerPeta>(
      `UPDATE layer_peta SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *;`,
      values
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: 'success',
      message: 'Layer berhasil diperbarui.',
      data: res.rows[0],
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal memperbarui layer.', detail: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/gis/layers?id={id} - Menghapus layer dan fiturnya
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req, { roles: ['admin'] });
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');

    if (!idParam) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "id" wajib disertakan.' },
        { status: 400 }
      );
    }

    const id = parseInt(idParam, 10);
    // Hapus fitur terkait terlebih dahulu
    await query('DELETE FROM fitur_peta WHERE layer_id = $1;', [id]);
    // Hapus layer
    const res = await query('DELETE FROM layer_peta WHERE id = $1 RETURNING *;', [id]);

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    await catatAktivitas(auth.user.id, 'hapus_layer', `Menghapus layer GIS ID ${id}.`);

    return NextResponse.json({
      status: 'success',
      message: 'Layer dan seluruh fiturnya berhasil dihapus.',
      data: res.rows[0],
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghapus layer.', detail: error.message },
      { status: 500 }
    );
  }
}

