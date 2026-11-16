import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, catatAktivitas } from '@/lib/auth/guard';
import type { LayerRaster } from '@/types/gis';
import fs from 'node:fs/promises';
import path from 'node:path';

interface RasterDbRow {
  id: number;
  unggahan_id: number;
  kebun_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
  nama_layer: string;
  nama_file: string;
  lokasi_file: string;
  tipe_raster: 'NDVI' | 'RGB' | 'ELEVATION' | 'THEMATIC';
  min_val: number | null;
  max_val: number | null;
  nodata: number | null;
  bands_count: number;
  width: number;
  height: number;
  crs_asal: string | null;
  srid_asal: number | null;
  transparansi: number;
  terlihat: boolean;
  urutan: number;
  dibuat_pada: string;
  nama_kebun: string | null;
  kode_kebun: string | null;
  nama_dataset: string | null;
  min_x: number | null;
  min_y: number | null;
  max_x: number | null;
  max_y: number | null;
}

// GET /api/gis/rasters - Mengambil daftar seluruh layer raster aktif
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const kebunIdParam = searchParams.get('kebun_id');

    const params: unknown[] = [];
    const whereClauses: string[] = [];

    if (kebunIdParam && !isNaN(Number(kebunIdParam)) && Number(kebunIdParam) > 0) {
      params.push(Number(kebunIdParam));
      whereClauses.push(`r.kebun_id = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const res = await query<RasterDbRow>(
      `
      SELECT 
        r.id,
        r.unggahan_id,
        r.kebun_id,
        r.afdeling_id,
        r.blok_id,
        r.nama_layer,
        r.nama_file,
        r.lokasi_file,
        r.tipe_raster,
        r.min_val::float8 as min_val,
        r.max_val::float8 as max_val,
        r.nodata::float8 as nodata,
        r.bands_count,
        r.width,
        r.height,
        r.crs_asal,
        r.srid_asal,
        r.transparansi::float8 as transparansi,
        r.terlihat,
        r.urutan,
        r.dibuat_pada,
        k.nama_kebun,
        k.kode_kebun,
        du.nama_data as nama_dataset,
        ST_XMin(r.bbox_wgs84)::float8 as min_x,
        ST_YMin(r.bbox_wgs84)::float8 as min_y,
        ST_XMax(r.bbox_wgs84)::float8 as max_x,
        ST_YMax(r.bbox_wgs84)::float8 as max_y
      FROM public.layer_raster r
      LEFT JOIN public.kebun k ON r.kebun_id = k.id
      LEFT JOIN public.data_unggahan du ON r.unggahan_id = du.id
      ${whereSql}
      ORDER BY r.urutan ASC, r.id DESC;
    `,
      params
    );

    const rasters: LayerRaster[] = res.rows.map((row) => {
      const hasExtent =
        row.min_x !== null && row.min_y !== null && row.max_x !== null && row.max_y !== null;
      return {
        id: Number(row.id),
        unggahan_id: Number(row.unggahan_id),
        kebun_id: row.kebun_id ? Number(row.kebun_id) : null,
        afdeling_id: row.afdeling_id ? Number(row.afdeling_id) : null,
        blok_id: row.blok_id ? Number(row.blok_id) : null,
        nama_layer: row.nama_layer,
        nama_file: row.nama_file,
        lokasi_file: row.lokasi_file,
        tipe_raster: row.tipe_raster,
        min_val: row.min_val,
        max_val: row.max_val,
        nodata: row.nodata,
        bands_count: Number(row.bands_count),
        width: Number(row.width),
        height: Number(row.height),
        crs_asal: row.crs_asal,
        srid_asal: row.srid_asal,
        transparansi: Number(row.transparansi),
        terlihat: Boolean(row.terlihat),
        urutan: Number(row.urutan),
        dibuat_pada: row.dibuat_pada,
        nama_kebun: row.nama_kebun,
        kode_kebun: row.kode_kebun,
        nama_dataset: row.nama_dataset,
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
        preview_url: `/api/gis/rasters/${row.id}/preview`,
      };
    });

    return NextResponse.json({
      status: 'success',
      total: rasters.length,
      data: rasters,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Get Rasters Error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data layer raster.', detail: error.message },
      { status: 500 }
    );
  }
}

// PATCH /api/gis/rasters - Mengubah visibilitas & transparansi raster
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.id) {
      return NextResponse.json(
        { status: 'error', message: 'Field "id" raster wajib diisi.' },
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
    const res = await query(
      `UPDATE public.layer_raster SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *;`,
      values
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer raster dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: 'success',
      message: 'Layer raster berhasil diperbarui.',
      data: res.rows[0],
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal memperbarui layer raster.', detail: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/gis/rasters?id={id} - Menghapus layer raster dan file fisiknya
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
    const res = await query<{ lokasi_file: string }>(
      'DELETE FROM public.layer_raster WHERE id = $1 RETURNING *;',
      [id]
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer raster dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    // Hapus file fisik jika ada
    const filePath = res.rows[0].lokasi_file;
    if (filePath) {
      try {
        await fs.unlink(path.resolve(filePath));
      } catch {
        // Abaikan jika file sudah tidak ada
      }
    }

    await catatAktivitas(auth.user.id, 'hapus_raster', `Menghapus layer raster ID ${id}.`);

    return NextResponse.json({
      status: 'success',
      message: 'Layer raster berhasil dihapus.',
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghapus layer raster.', detail: error.message },
      { status: 500 }
    );
  }
}

