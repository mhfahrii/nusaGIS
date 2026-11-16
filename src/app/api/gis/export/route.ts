import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

interface ExportDbRow {
  id: number;
  layer_id: number;
  nama_layer: string;
  geom_json: {
    type: string;
    coordinates: unknown;
  };
  atribut: Record<string, unknown>;
  luas_geodesik_ha: number | null;
}

function coordinatesToKmlString(geom: { type: string; coordinates: unknown }): string {
  if (geom.type === 'Polygon') {
    const coords = (geom.coordinates as [number, number][][])[0] || [];
    const coordStr = coords.map((c) => `${c[0]},${c[1]},0`).join(' ');
    return `
      <Polygon>
        <extrude>1</extrude>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordStr}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>`;
  } else if (geom.type === 'MultiPolygon') {
    const polygons = geom.coordinates as [number, number][][][];
    const polyKmls = polygons.map((poly) => {
      const ring = poly[0] || [];
      const coordStr = ring.map((c) => `${c[0]},${c[1]},0`).join(' ');
      return `
        <Polygon>
          <extrude>1</extrude>
          <altitudeMode>clampToGround</altitudeMode>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordStr}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>`;
    });
    return `
      <MultiGeometry>
        ${polyKmls.join('')}
      </MultiGeometry>`;
  } else if (geom.type === 'LineString') {
    const coords = geom.coordinates as [number, number][];
    const coordStr = coords.map((c) => `${c[0]},${c[1]},0`).join(' ');
    return `
      <LineString>
        <extrude>1</extrude>
        <tessellate>1</tessellate>
        <coordinates>${coordStr}</coordinates>
      </LineString>`;
  } else if (geom.type === 'Point') {
    const c = geom.coordinates as [number, number];
    return `
      <Point>
        <coordinates>${c[0]},${c[1]},0</coordinates>
      </Point>`;
  }
  return '';
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const featureIdParam = searchParams.get('feature_id');
    const layerIdParam = searchParams.get('layer_id');
    const format = (searchParams.get('format') || 'geojson').toLowerCase();

    if (!featureIdParam && !layerIdParam) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "feature_id" atau "layer_id" wajib disertakan.' },
        { status: 400 }
      );
    }

    let whereClause = '';
    const params: unknown[] = [];

    if (featureIdParam) {
      whereClause = 'WHERE fp.id = $1';
      params.push(parseInt(featureIdParam, 10));
    } else if (layerIdParam) {
      whereClause = 'WHERE fp.layer_id = $1';
      params.push(parseInt(layerIdParam, 10));
    }

    const res = await query<ExportDbRow>(
      `
      SELECT 
        fp.id,
        fp.layer_id,
        lp.nama_layer,
        ST_AsGeoJSON(fp.geom)::jsonb as geom_json,
        fp.atribut,
        CASE
          WHEN GeometryType(fp.geom) IN ('POLYGON', 'MULTIPOLYGON')
          THEN ROUND((ST_Area(fp.geom::geography) / 10000.0)::numeric, 2)::float8
          ELSE NULL
        END AS luas_geodesik_ha
      FROM public.fitur_peta fp
      JOIN public.layer_peta lp ON fp.layer_id = lp.id
      ${whereClause}
      ORDER BY fp.id ASC;
      `,
      params
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: 'Data fitur/layer tidak ditemukan untuk diekspor.' },
        { status: 404 }
      );
    }

    const rows = res.rows;
    const baseName = featureIdParam
      ? String(rows[0].atribut.Name || rows[0].atribut.KODE_BLOK || `lahan_${rows[0].id}`).replace(/[^a-zA-Z0-9_-]/g, '_')
      : String(rows[0].nama_layer).replace(/[^a-zA-Z0-9_-]/g, '_');

    if (format === 'kml') {
      // Export KML (Google Earth)
      const placemarks = rows
        .map((r) => {
          const name = r.atribut.Name || r.atribut.KODE_BLOK || `Fitur #${r.id}`;
          const kmlGeom = coordinatesToKmlString(r.geom_json);
          const descRows = Object.entries(r.atribut)
            .filter(([k]) => !k.startsWith('_'))
            .map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`)
            .join('');

          const luasRow = r.luas_geodesik_ha
            ? `<tr><td><b>Luas Geodesik</b></td><td>${r.luas_geodesik_ha} Ha</td></tr>`
            : '';

          return `
      <Placemark>
        <name>${name}</name>
        <description><![CDATA[
          <table border="1" style="border-collapse:collapse; font-size:12px; font-family:sans-serif;">
            ${descRows}
            ${luasRow}
          </table>
        ]]></description>
        <styleUrl>#plantationStyle</styleUrl>
        ${kmlGeom}
      </Placemark>`;
        })
        .join('\n');

      const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${baseName}</name>
    <Style id="plantationStyle">
      <LineStyle>
        <color>ff1818be</color>
        <width>3</width>
      </LineStyle>
      <PolyStyle>
        <color>7f18be5d</color>
        <fill>1</fill>
        <outline>1</outline>
      </PolyStyle>
    </Style>
    ${placemarks}
  </Document>
</kml>`;

      return new NextResponse(kmlContent, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.google-earth.kml+xml',
          'Content-Disposition': `attachment; filename="${baseName}.kml"`,
        },
      });
    }

    // Default: Export GeoJSON FeatureCollection
    const features = rows.map((r) => ({
      type: 'Feature' as const,
      id: Number(r.id),
      geometry: r.geom_json,
      properties: {
        ...r.atribut,
        _feature_id: Number(r.id),
        _layer_id: Number(r.layer_id),
        ...(r.luas_geodesik_ha !== null ? { _luas_geodesik_ha: r.luas_geodesik_ha } : {}),
      },
    }));

    const geojson = {
      type: 'FeatureCollection',
      name: baseName,
      crs: {
        type: 'name',
        properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
      },
      features,
    };

    return new NextResponse(JSON.stringify(geojson, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/geo+json',
        'Content-Disposition': `attachment; filename="${baseName}.geojson"`,
      },
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Export GIS Error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengekspor data spasial.', detail: error.message },
      { status: 500 }
    );
  }
}

