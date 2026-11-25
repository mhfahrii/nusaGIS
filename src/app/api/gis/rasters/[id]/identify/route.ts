import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, safeErrorDetail } from '@/lib/auth/guard';
import { inspectPixelAtCoordinate } from '@/lib/gis/geotiff';
import path from 'node:path';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const rasterId = parseInt(id, 10);
    const { searchParams } = new URL(req.url);

    const lngParam = searchParams.get('lng');
    const latParam = searchParams.get('lat');

    if (!lngParam || !latParam) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "lng" dan "lat" wajib disertakan.' },
        { status: 400 }
      );
    }

    const lng = parseFloat(lngParam);
    const lat = parseFloat(latParam);

    if (isNaN(lng) || isNaN(lat)) {
      return NextResponse.json(
        { status: 'error', message: 'Nilai koordinat "lng" atau "lat" tidak valid.' },
        { status: 400 }
      );
    }

    const res = await query<{
      id: number;
      nama_layer: string;
      lokasi_file: string;
      tipe_raster: string;
      nama_kebun: string | null;
    }>(
      `
      SELECT r.id, r.nama_layer, r.lokasi_file, r.tipe_raster, k.nama_kebun
      FROM public.layer_raster r
      LEFT JOIN public.kebun k ON r.kebun_id = k.id
      WHERE r.id = $1;
      `,
      [rasterId]
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer raster dengan ID ${rasterId} tidak ditemukan.` },
        { status: 404 }
      );
    }

    const rasterInfo = res.rows[0];
    const filePath = path.resolve(rasterInfo.lokasi_file);
    const pixelResult = await inspectPixelAtCoordinate(filePath, lng, lat);

    return NextResponse.json({
      status: 'success',
      layer: {
        id: rasterInfo.id,
        nama_layer: rasterInfo.nama_layer,
        tipe_raster: rasterInfo.tipe_raster,
        nama_kebun: rasterInfo.nama_kebun,
      },
      data: pixelResult,
    });
  } catch (err: unknown) {
    console.error('Inspect Pixel Error:', err);
    return NextResponse.json(
      { status: 'error', message: 'Gagal melakukan inspeksi pixel raster.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}

