import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { renderGeoTiffToPng } from '@/lib/gis/geotiff';
import path from 'node:path';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const rasterId = parseInt(id, 10);

    if (isNaN(rasterId) || rasterId <= 0) {
      return new NextResponse('ID raster tidak valid.', { status: 400 });
    }

    const res = await query<{ lokasi_file: string }>(
      'SELECT lokasi_file FROM public.layer_raster WHERE id = $1;',
      [rasterId]
    );

    if (res.rowCount === 0) {
      return new NextResponse('Layer raster tidak ditemukan.', { status: 404 });
    }

    const filePath = path.resolve(res.rows[0].lokasi_file);
    const pngBuffer = await renderGeoTiffToPng(filePath, 4096);

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
      },
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Render Raster Error:', error);
    return new NextResponse(`Gagal me-render raster: ${error.message}`, { status: 500 });
  }
}

