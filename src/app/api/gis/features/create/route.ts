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
  new_kebun_nama?: string | null;
  new_kebun_wilayah?: string | null;
  new_kebun_perusahaan?: string | null;
  new_afdeling_nama?: string | null;
  komoditas?: string;
  tahun_tanam?: number | string | null;
  status_lahan?: string;
  luas_ha?: number | string | null;
  luas_baku?: number | string | null;
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

    // Siapkan atribut JSONB sesuai struktur master RPN & ArcGIS Shapefile
    const finalLuasBaku = body.luas_baku ? Number(body.luas_baku) : (luas_ha ? Number(luas_ha) : null);
    const attributesPayload: Record<string, unknown> = {
      Name: nama.trim(),
      KODE_BLOK: kode?.trim() || `BLK-${Date.now().toString().slice(-4)}`,
      Label: nama.trim(),
      komoditas: komoditas?.trim() || 'Tebu',
      tahun_tanam: tahun_tanam ? Number(tahun_tanam) : new Date().getFullYear(),
      status_lahan: status_lahan?.trim() || 'KS GPA 2023',
      luas_input_ha: luas_ha ? Number(luas_ha) : null,
      luas_baku: finalLuasBaku,
      PopupInfo: `Luas Baku : ${finalLuasBaku !== null ? finalLuasBaku.toFixed(2) : '-'} Ha\nStatus Lahan : ${status_lahan?.trim() || 'KS GPA 2023'}\nTanaman : ${komoditas?.trim() || 'Tebu'}`,
      keterangan: keterangan?.trim() || 'Dibuat via Tool Digitasi Web GIS',
      metode_input: 'Digitasi Langsung Peta',
      dibuat_oleh: auth.user.nama || auth.user.email,
      dibuat_pada: new Date().toISOString(),
    };

    // 1. Tangani pembuatan Kebun baru dinamis jika diisi oleh pengguna
    let finalKebunId = kebun_id ? Number(kebun_id) : null;
    if ((!finalKebunId || body.new_kebun_nama) && body.new_kebun_nama?.trim()) {
      const kNama = body.new_kebun_nama.trim();
      const kWil = body.new_kebun_wilayah?.trim() || 'Wilayah Belum Ditentukan';
      const kPer = body.new_kebun_perusahaan?.trim() || 'PT Perkebunan Nusantara I (Regional 4)';
      const kKode = `KBN-${kNama.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'NEW'}-${Date.now().toString().slice(-4)}`;

      const existingK = await query<{ id: number; nama_kebun: string; kode_kebun: string }>(
        'SELECT id, nama_kebun, kode_kebun FROM public.kebun WHERE LOWER(nama_kebun) = LOWER($1);',
        [kNama]
      );
      if (existingK.rowCount && existingK.rowCount > 0) {
        finalKebunId = Number(existingK.rows[0].id);
      } else {
        const insK = await query<{ id: number }>(
          `INSERT INTO public.kebun (kode_kebun, nama_kebun, wilayah, perusahaan)
           VALUES ($1, $2, $3, $4)
           RETURNING id;`,
          [kKode, kNama, kWil, kPer]
        );
        if (insK.rowCount && insK.rowCount > 0) {
          finalKebunId = Number(insK.rows[0].id);
        }
      }
    }

    // 2. Tangani pembuatan Afdeling baru dinamis jika diisi
    let finalAfdelingId = afdeling_id ? Number(afdeling_id) : null;
    if (
      (!finalAfdelingId || body.new_afdeling_nama) &&
      body.new_afdeling_nama?.trim() &&
      finalKebunId
    ) {
      const aNama = body.new_afdeling_nama.trim();
      const aKode = `AFD-${aNama.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'NEW'}-${Date.now().toString().slice(-4)}`;

      const existingA = await query<{ id: number }>(
        'SELECT id FROM public.afdeling WHERE kebun_id = $1 AND LOWER(nama_afdeling) = LOWER($2);',
        [finalKebunId, aNama]
      );
      if (existingA.rowCount && existingA.rowCount > 0) {
        finalAfdelingId = Number(existingA.rows[0].id);
      } else {
        const insA = await query<{ id: number }>(
          `INSERT INTO public.afdeling (kebun_id, kode_afdeling, nama_afdeling)
           VALUES ($1, $2, $3)
           RETURNING id;`,
          [finalKebunId, aKode, aNama]
        );
        if (insA.rowCount && insA.rowCount > 0) {
          finalAfdelingId = Number(insA.rows[0].id);
        }
      }
    }

    // 3. Ambil informasi kebun dan afdeling jika terhubung
    if (finalKebunId) {
      const kRes = await query<{ nama_kebun: string; kode_kebun: string; wilayah: string; perusahaan: string }>(
        'SELECT nama_kebun, kode_kebun, wilayah, perusahaan FROM public.kebun WHERE id = $1;',
        [finalKebunId]
      );
      if (kRes.rowCount && kRes.rowCount > 0) {
        attributesPayload['nama_kebun'] = kRes.rows[0].nama_kebun;
        attributesPayload['kode_kebun'] = kRes.rows[0].kode_kebun;
        attributesPayload['wilayah'] = kRes.rows[0].wilayah;
        attributesPayload['perusahaan'] = kRes.rows[0].perusahaan;
      }

      // Pastikan layer_peta memiliki relasi kebun ini
      await query(
        'UPDATE public.layer_peta SET kebun_id = $1 WHERE id = $2 AND (kebun_id IS NULL OR kebun_id = 0);',
        [finalKebunId, layer_id]
      );
    }

    if (finalAfdelingId) {
      const aRes = await query<{ nama_afdeling: string; kode_afdeling: string }>(
        'SELECT nama_afdeling, kode_afdeling FROM public.afdeling WHERE id = $1;',
        [finalAfdelingId]
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
      INSERT INTO public.fitur_peta (layer_id, geom, atribut, dibuat_oleh_user_id)
      VALUES (
        $1,
        ST_Multi(ST_Force2D(ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326))),
        $3,
        $4
      )
      RETURNING 
        id, 
        layer_id, 
        ST_AsGeoJSON(geom)::jsonb as geom_json, 
        atribut,
        ROUND((ST_Area(geom::geography) / 10000.0)::numeric, 2)::float8 as luas_geodesik_ha;
      `,
      [layer_id, JSON.stringify(geoJsonPolygon), JSON.stringify(attributesPayload), auth.user.id]
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

