import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

interface LayerDetailRow {
  id: number;
  unggahan_id: number | null;
  kebun_id: number | null;
  nama_kebun: string | null;
  kode_kebun: string | null;
  nama_data: string | null;
  nama_layer: string;
  nama_file_shp: string | null;
  tipe_geometri: string;
  warna: string;
  transparansi: string | number;
  terlihat: boolean;
  urutan: number;
  crs_asal: string | null;
  srid_asal: number | null;
  dibuat_pada: string;
  jumlah_fitur: number;
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const layerId = parseInt(id, 10);

    if (Number.isNaN(layerId) || layerId <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'ID layer tidak valid.' },
        { status: 400 }
      );
    }

    const res = await query<LayerDetailRow>(
      `SELECT
         lp.id,
         lp.unggahan_id,
         lp.kebun_id,
         k.nama_kebun,
         k.kode_kebun,
         du.nama_data,
         lp.nama_layer,
         lp.nama_file_shp,
         lp.tipe_geometri,
         lp.warna,
         lp.transparansi,
         lp.terlihat,
         lp.urutan,
         lp.crs_asal,
         lp.srid_asal,
         lp.dibuat_pada,
         COUNT(fp.id)::int AS jumlah_fitur,
         ST_XMin(ST_Extent(fp.geom))::float AS west,
         ST_YMin(ST_Extent(fp.geom))::float AS south,
         ST_XMax(ST_Extent(fp.geom))::float AS east,
         ST_YMax(ST_Extent(fp.geom))::float AS north
       FROM public.layer_peta lp
       LEFT JOIN public.kebun k ON k.id = lp.kebun_id
       LEFT JOIN public.data_unggahan du ON du.id = lp.unggahan_id
       LEFT JOIN public.fitur_peta fp ON fp.layer_id = lp.id
       WHERE lp.id = $1
       GROUP BY lp.id, k.nama_kebun, k.kode_kebun, du.nama_data;`,
      [layerId]
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer dengan ID ${layerId} tidak ditemukan.` },
        { status: 404 }
      );
    }

    const r = res.rows[0];
    const hasExtent =
      r.west !== null &&
      r.south !== null &&
      r.east !== null &&
      r.north !== null &&
      Number.isFinite(Number(r.west));

    const extent = hasExtent
      ? {
          west: Number(r.west),
          south: Number(r.south),
          east: Number(r.east),
          north: Number(r.north),
        }
      : null;

    // Ambil daftar kolom atribut DBF/JSONB dari fitur layer ini
    const colRes = await query<{ col_key: string }>(
      `SELECT DISTINCT jsonb_object_keys(atribut) AS col_key
       FROM public.fitur_peta
       WHERE layer_id = $1
       LIMIT 50;`,
      [layerId]
    );

    return NextResponse.json({
      status: 'success',
      crs: 'EPSG:4326',
      data: {
        id: Number(r.id),
        unggahan_id: r.unggahan_id ? Number(r.unggahan_id) : null,
        kebun_id: r.kebun_id ? Number(r.kebun_id) : null,
        nama_kebun: r.nama_kebun || null,
        kode_kebun: r.kode_kebun || null,
        nama_data: r.nama_data || null,
        nama_layer: r.nama_layer,
        nama_file_shp: r.nama_file_shp,
        tipe_geometri: r.tipe_geometri,
        warna: r.warna,
        transparansi: Number(r.transparansi),
        terlihat: Boolean(r.terlihat),
        urutan: Number(r.urutan),
        crs_asal: r.crs_asal || 'EPSG:4326',
        srid_asal: r.srid_asal ? Number(r.srid_asal) : 4326,
        srid_simpan: 4326,
        jumlah_fitur: Number(r.jumlah_fitur),
        columns: colRes.rows.map((c) => c.col_key),
        extent,
        bbox: extent ? [extent.west, extent.south, extent.east, extent.north] : null,
        dibuat_pada: r.dibuat_pada,
      },
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal memuat detail layer.', detail: error.message },
      { status: 500 }
    );
  }
}
