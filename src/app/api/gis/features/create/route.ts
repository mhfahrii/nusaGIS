import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, catatAktivitas } from '@/lib/auth/guard';

interface CreateFeatureBody {
  layer_id: number;
  coordinates: [number, number][]; // [ [lng, lat], [lng, lat], ... ]
  nama: string;
  kode?: string;
  kebun_id?: number | null;
  afdeling_id?: number | null;
  blok_id?: number | null;
  komoditas?: string;
  tahun_tanam?: number | string | null;
  status_lahan?: string;
  luas_ha?: number | string | null;
  keterangan?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body: CreateFeatureBody = await req.json();
    const {
      layer_id,
      coordinates,
      nama,
      kode,
      kebun_id,
      afdeling_id,
      blok_id,
      komoditas,
      tahun_tanam,
      status_lahan,
      luas_ha,
      keterangan,
    } = body;

    if (!layer_id || isNaN(Number(layer_id))) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "layer_id" wajib disertakan.' },
        { status: 400 }
      );
    }

    if (!nama || !nama.trim()) {
      return NextResponse.json(
        { status: 'error', message: 'Nama lahan wajib diisi.' },
        { status: 400 }
      );
    }

    if (!Array.isArray(coordinates) || coordinates.length < 3) {
      return NextResponse.json(
        { status: 'error', message: 'Geometri lahan membutuhkan minimal 3 titik sudut koordinat.' },
        { status: 400 }
      );
    }

    // Pastikan cincin koordinat tertutup (titik awal = titik akhir)
    const ring = coordinates.map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }

    if (ring.length < 4) {
      return NextResponse.json(
        { status: 'error', message: 'Poligon tidak valid (kurang dari 4 titik tertutup).' },
        { status: 400 }
      );
    }

    // GeoJSON Polygon
    const geoJsonPolygon = {
      type: 'Polygon',
      coordinates: [ring],
    };

    // Siapkan atribut JSONB sesuai struktur master RPN
    const attributesPayload: Record<string, unknown> = {
      Name: nama.trim(),
      KODE_BLOK: kode?.trim() || `BLK-${Date.now().toString().slice(-4)}`,
      Label: nama.trim(),
      komoditas: komoditas?.trim() || 'Kelapa Sawit',
      tahun_tanam: tahun_tanam ? Number(tahun_tanam) : new Date().getFullYear(),
      status_lahan: status_lahan?.trim() || 'Lahan Baku',
      luas_input_ha: luas_ha ? Number(luas_ha) : null,
      keterangan: keterangan?.trim() || 'Dibuat via Tool Digitasi Web GIS',
      metode_input: 'Digitasi Langsung Peta',
      dibuat_oleh: auth.user.nama || auth.user.email,
      dibuat_pada: new Date().toISOString(),
    };

    // Ambil informasi kebun dan afdeling jika terhubung
    if (kebun_id) {
      const kRes = await query<{ nama_kebun: string; kode_kebun: string }>(
        'SELECT nama_kebun, kode_kebun FROM public.kebun WHERE id = $1;',
        [kebun_id]
      );
      if (kRes.rowCount && kRes.rowCount > 0) {
        attributesPayload['nama_kebun'] = kRes.rows[0].nama_kebun;
        attributesPayload['kode_kebun'] = kRes.rows[0].kode_kebun;
      }
    }

    if (afdeling_id) {
      const aRes = await query<{ nama_afdeling: string; kode_afdeling: string }>(
        'SELECT nama_afdeling, kode_afdeling FROM public.afdeling WHERE id = $1;',
        [afdeling_id]
      );
      if (aRes.rowCount && aRes.rowCount > 0) {
        attributesPayload['nama_afdeling'] = aRes.rows[0].nama_afdeling;
        attributesPayload['kode_afdeling'] = aRes.rows[0].kode_afdeling;
      }
    }

    // Insert ke public.fitur_peta
    const insertRes = await query<{
      id: number;
      layer_id: number;
      geom_json: Record<string, unknown>;
      atribut: Record<string, unknown>;
      luas_geodesik_ha: number;
    }>(
      `
      INSERT INTO public.fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_Multi(ST_Force2D(ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326))),
        $3
      )
      RETURNING 
        id, 
        layer_id, 
        ST_AsGeoJSON(geom)::jsonb as geom_json, 
        atribut,
        ROUND((ST_Area(geom::geography) / 10000.0)::numeric, 2)::float8 as luas_geodesik_ha;
      `,
      [layer_id, JSON.stringify(geoJsonPolygon), JSON.stringify(attributesPayload)]
    );

    const created = insertRes.rows[0];

    // Update jumlah_fitur di layer_peta
    await query(
      `
      UPDATE public.layer_peta
      SET jumlah_fitur = (SELECT COUNT(*)::int FROM public.fitur_peta WHERE layer_id = $1)
      WHERE id = $1;
      `,
      [layer_id]
    );

    // Update blok master jika blok_id belum ada tapi ingin dicatat
    if (blok_id) {
      await query(
        `UPDATE public.fitur_peta SET atribut = atribut || jsonb_build_object('blok_id', $1::int) WHERE id = $2;`,
        [blok_id, created.id]
      );
    }

    await catatAktivitas(
      auth.user.id,
      'create_lahan_digitasi',
      `Membuat poligon lahan baru "${nama}" (Luas: ${created.luas_geodesik_ha} Ha) pada layer ID ${layer_id}.`
    );

    return NextResponse.json(
      {
        status: 'success',
        message: `Lahan "${nama}" berhasil disimpan ke PostGIS.`,
        data: {
          id: Number(created.id),
          layer_id: Number(created.layer_id),
          geometry: created.geom_json,
          properties: {
            ...created.atribut,
            _feature_id: Number(created.id),
            _layer_id: Number(created.layer_id),
            _luas_geodesik_ha: created.luas_geodesik_ha,
          },
          luas_geodesik_ha: created.luas_geodesik_ha,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Create Parcel Error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Gagal menyimpan lahan ke database PostGIS.', detail: error.message },
      { status: 500 }
    );
  }
}

