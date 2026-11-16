import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

interface FeatureRowGeoJson {
  id: number;
  layer_id: number;
  geom_json: Record<string, unknown>;
  atribut: Record<string, unknown>;
  luas_geodesik_ha: number | null;
}

function buildFeatureLabel(
  id: number,
  layerName: string,
  atribut: Record<string, unknown>,
  luasGeodesikHa: number | null,
  geomType: string
): string {
  const preferredKeys = [
    'Name',
    'NAME',
    'name',
    'Nama',
    'NAMA',
    'Kode Blok',
    'KODE_BLOK',
    'kode_blok',
    'Nama_Blok',
    'NAMA_BLOK',
    'nama_blok',
    'Nama Afdeling',
    'NAMA_AFDELING',
    'Kode Afdeling',
    'KODE_AFDELING',
    'Nama_Kebun',
    'NAMA_KEBUN',
    'Kode_Kebun',
    'KODE_KEBUN',
    'Nama Jalan',
    'NAMA_JALAN',
    'KODE',
    'Kode',
    'Label',
    'LABEL',
    'label',
  ];

  const garbageKeyNames = new Set([
    'symbolid',
    'altmode',
    'base',
    'clamped',
    'extruded',
    'snippet',
    'folderpath',
    'shape_leng',
    'shape_area',
    'popupinfo',
    'objectid',
  ]);

  let primaryText = '';
  for (const key of preferredKeys) {
    const val = atribut[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      primaryText = String(val).trim();
      break;
    }
  }

  // Fallback: cari atribut pertama yang bukan kunci sampah teknis
  if (!primaryText) {
    for (const [k, v] of Object.entries(atribut)) {
      if (
        !k.startsWith('_') &&
        !garbageKeyNames.has(k.toLowerCase()) &&
        v !== null &&
        v !== undefined &&
        String(v).trim() !== ''
      ) {
        primaryText = String(v).trim();
        break;
      }
    }
  }

  if (!primaryText) {
    primaryText = `${layerName} #${id}`;
  }

  // Tambahkan informasi luas (Ha) untuk poligon
  if (geomType.toLowerCase().includes('polygon')) {
    const attrLuas =
      atribut['Luas (Ha)'] ?? atribut['LUAS_HA'] ?? atribut['luas_ha'] ?? luasGeodesikHa;
    if (attrLuas !== null && attrLuas !== undefined && !isNaN(Number(attrLuas))) {
      return `${primaryText}\n(${Number(attrLuas).toFixed(2)} Ha)`;
    }
  }

  return primaryText;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const layerIdParam = searchParams.get('layer_id');

    if (!layerIdParam) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "layer_id" wajib disertakan.' },
        { status: 400 }
      );
    }

    const layerId = parseInt(layerIdParam, 10);
    if (isNaN(layerId) || layerId <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "layer_id" harus angka positif.' },
        { status: 400 }
      );
    }

    // Ambil metadata layer
    const layerRes = await query<{
      id: number;
      nama_layer: string;
      tipe_geometri: string;
      warna: string;
      transparansi: number;
      terlihat: boolean;
      crs_asal: string | null;
      srid_asal: number | null;
    }>(
      `SELECT id, nama_layer, tipe_geometri, warna, transparansi, terlihat, crs_asal, srid_asal
       FROM layer_peta WHERE id = $1;`,
      [layerId]
    );

    if (layerRes.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer dengan ID ${layerId} tidak ditemukan.` },
        { status: 404 }
      );
    }

    const layerInfo = layerRes.rows[0];

    // Ambil seluruh fitur dengan geometri dalam EPSG:4326 (urutan longitude, latitude)
    const featuresRes = await query<FeatureRowGeoJson>(
      `SELECT
        fp.id,
        fp.layer_id,
        ST_AsGeoJSON(
          CASE
            WHEN ST_SRID(fp.geom) = 4326 THEN fp.geom
            WHEN ST_SRID(fp.geom) > 0 THEN ST_Transform(fp.geom, 4326)
            ELSE ST_SetSRID(fp.geom, 4326)
          END
        )::jsonb AS geom_json,
        fp.atribut,
        CASE
          WHEN GeometryType(fp.geom) IN ('POLYGON', 'MULTIPOLYGON')
          THEN ROUND((ST_Area(fp.geom::geography) / 10000.0)::numeric, 2)::float8
          ELSE NULL
        END AS luas_geodesik_ha
      FROM fitur_peta fp
      WHERE fp.layer_id = $1 AND COALESCE(fp.is_deleted, FALSE) = FALSE
      ORDER BY fp.id ASC;`,
      [layerId]
    );

    const features = featuresRes.rows.map((row) => {
      const attrs = row.atribut || {};
      const label = buildFeatureLabel(
        Number(row.id),
        layerInfo.nama_layer,
        attrs,
        row.luas_geodesik_ha,
        row.geom_json?.type ? String(row.geom_json.type) : layerInfo.tipe_geometri
      );

      return {
        type: 'Feature' as const,
        id: Number(row.id),
        geometry: row.geom_json,
        properties: {
          ...attrs,
          _feature_id: Number(row.id),
          _layer_id: Number(row.layer_id),
          _label: label,
          ...(row.luas_geodesik_ha !== null ? { _luas_geodesik_ha: row.luas_geodesik_ha } : {}),
        },
      };
    });

    const geojson = {
      type: 'FeatureCollection' as const,
      features,
    };

    return NextResponse.json({
      status: 'success',
      layer: layerInfo,
      data: geojson,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Get GeoJSON Error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data spasial GeoJSON.', detail: error.message },
      { status: 500 }
    );
  }
}
