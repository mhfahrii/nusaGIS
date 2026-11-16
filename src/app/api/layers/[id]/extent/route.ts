import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

interface ExtentRow {
  id: number;
  nama_layer: string;
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

    const res = await query<ExtentRow>(
      `SELECT
         lp.id,
         lp.nama_layer,
         COUNT(fp.id)::int AS jumlah_fitur,
         ST_XMin(ST_Extent(fp.geom))::float AS west,
         ST_YMin(ST_Extent(fp.geom))::float AS south,
         ST_XMax(ST_Extent(fp.geom))::float AS east,
         ST_YMax(ST_Extent(fp.geom))::float AS north
       FROM public.layer_peta lp
       LEFT JOIN public.fitur_peta fp ON fp.layer_id = lp.id
       WHERE lp.id = $1
       GROUP BY lp.id;`,
      [layerId]
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer dengan ID ${layerId} tidak ditemukan.` },
        { status: 404 }
      );
    }

    const row = res.rows[0];
    const hasValidExtent =
      row.west !== null &&
      row.south !== null &&
      row.east !== null &&
      row.north !== null &&
      Number.isFinite(Number(row.west)) &&
      Number.isFinite(Number(row.south)) &&
      Number.isFinite(Number(row.east)) &&
      Number.isFinite(Number(row.north));

    if (!hasValidExtent) {
      return NextResponse.json({
        status: 'success',
        layer_id: Number(row.id),
        nama_layer: row.nama_layer,
        crs: 'EPSG:4326',
        jumlah_fitur: Number(row.jumlah_fitur),
        west: null,
        south: null,
        east: null,
        north: null,
        extent: null,
        bbox: null,
      });
    }

    let west = Number(row.west);
    let south = Number(row.south);
    let east = Number(row.east);
    let north = Number(row.north);

    // Jika layer hanya berisi 1 titik yang identik, beri margin kecil agar fitBounds nyaman
    if (Math.abs(east - west) < 0.0001 && Math.abs(north - south) < 0.0001) {
      west -= 0.001;
      east += 0.001;
      south -= 0.001;
      north += 0.001;
    }

    return NextResponse.json({
      status: 'success',
      layer_id: Number(row.id),
      nama_layer: row.nama_layer,
      crs: 'EPSG:4326',
      jumlah_fitur: Number(row.jumlah_fitur),
      west,
      south,
      east,
      north,
      extent: { west, south, east, north },
      bbox: [west, south, east, north],
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghitung extent layer.', detail: error.message },
      { status: 500 }
    );
  }
}

