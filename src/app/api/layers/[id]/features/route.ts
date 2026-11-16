import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

interface FeatureGeoJsonRow {
  id: number;
  layer_id: number;
  atribut: Record<string, unknown>;
  geojson: string;
  luas_geodesik_ha: number;
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

    const { searchParams } = new URL(req.url);
    const search = (searchParams.get('search') || '').trim();
    const format = (searchParams.get('format') || 'geojson').toLowerCase();

    const params: unknown[] = [layerId];
    let whereClause = `WHERE fp.layer_id = $1`;

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND fp.atribut::text ILIKE $2`;
    }

    const res = await query<FeatureGeoJsonRow>(
      `SELECT
         fp.id,
         fp.layer_id,
         fp.atribut,
         ST_AsGeoJSON(ST_Transform(fp.geom, 4326)) AS geojson,
         ROUND((ST_Area(fp.geom::geography) / 10000.0)::numeric, 2)::float AS luas_geodesik_ha,
         ST_XMin(ST_Envelope(fp.geom))::float AS west,
         ST_YMin(ST_Envelope(fp.geom))::float AS south,
         ST_XMax(ST_Envelope(fp.geom))::float AS east,
         ST_YMax(ST_Envelope(fp.geom))::float AS north
       FROM public.fitur_peta fp
       ${whereClause}
       ORDER BY fp.id ASC;`,
      params
    );

    const features = res.rows.map((r) => {
      const attrs = r.atribut || {};
      const extent =
        r.west !== null && r.south !== null && r.east !== null && r.north !== null
          ? {
              west: Number(r.west),
              south: Number(r.south),
              east: Number(r.east),
              north: Number(r.north),
            }
          : null;

      return {
        type: 'Feature' as const,
        id: Number(r.id),
        bbox: extent ? [extent.west, extent.south, extent.east, extent.north] : undefined,
        geometry: JSON.parse(r.geojson),
        properties: {
          ...attrs,
          _feature_id: Number(r.id),
          _layer_id: Number(r.layer_id),
          _luas_geodesik_ha: Number(r.luas_geodesik_ha || 0),
          _extent: extent,
        },
      };
    });

    if (format === 'table') {
      return NextResponse.json({
        status: 'success',
        crs: 'EPSG:4326',
        layer_id: layerId,
        total: features.length,
        data: features.map((f) => ({
          id: f.id,
          layer_id: layerId,
          extent: f.properties._extent,
          bbox: f.bbox || null,
          ...f.properties,
        })),
      });
    }

    return NextResponse.json({
      type: 'FeatureCollection',
      crs: {
        type: 'name',
        properties: { name: 'urn:ogc:def:crs:EPSG::4326' },
      },
      layer_id: layerId,
      total: features.length,
      features,
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memuat fitur spasial layer dalam EPSG:4326.',
        detail: error.message,
      },
      { status: 500 }
    );
  }
}

