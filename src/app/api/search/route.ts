import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import type { SearchResultItem, ExtentBox } from '@/types/gis';

interface KebunSearchRow {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  wilayah: string | null;
  komoditas: string | null;
  keterangan: string | null;
  first_layer_id: number | null;
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
}

interface LayerSearchRow {
  id: number;
  kebun_id: number | null;
  nama_kebun: string | null;
  nama_layer: string;
  nama_file_shp: string | null;
  nama_data: string | null;
  tipe_geometri: string;
  jumlah_fitur: number;
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
}

interface FeatureSearchRow {
  id: number;
  layer_id: number;
  kebun_id: number | null;
  nama_layer: string;
  nama_kebun: string | null;
  atribut: Record<string, unknown>;
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
}

function buildExtent(row: {
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
}): { extent: ExtentBox | null; bbox: [number, number, number, number] | null } {
  if (
    row.west !== null &&
    row.south !== null &&
    row.east !== null &&
    row.north !== null &&
    Number.isFinite(Number(row.west)) &&
    Number.isFinite(Number(row.south)) &&
    Number.isFinite(Number(row.east)) &&
    Number.isFinite(Number(row.north))
  ) {
    let west = Number(row.west);
    let south = Number(row.south);
    let east = Number(row.east);
    let north = Number(row.north);
    if (Math.abs(east - west) < 0.0001 && Math.abs(north - south) < 0.0001) {
      west -= 0.001;
      east += 0.001;
      south -= 0.001;
      north += 0.001;
    }
    return {
      extent: { west, south, east, north },
      bbox: [west, south, east, north],
    };
  }
  return { extent: null, bbox: null };
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const limitParam = parseInt(searchParams.get('limit') || '25', 10);
    const limit = Math.min(Math.max(limitParam || 25, 1), 100);

    if (!q) {
      return NextResponse.json({
        status: 'success',
        query: '',
        total: 0,
        data: [],
      });
    }

    const searchPattern = `%${q}%`;
    const results: SearchResultItem[] = [];

    // 1. Cari pada tabel public.kebun (kode_kebun, nama_kebun, wilayah, komoditas, keterangan)
    const kebunRes = await query<KebunSearchRow>(
      `SELECT
         k.id,
         k.kode_kebun,
         k.nama_kebun,
         k.wilayah,
         k.komoditas,
         k.keterangan,
         (SELECT lp2.id FROM public.layer_peta lp2 WHERE lp2.kebun_id = k.id ORDER BY lp2.id ASC LIMIT 1) AS first_layer_id,
         ST_XMin(ST_Extent(fp.geom))::float AS west,
         ST_YMin(ST_Extent(fp.geom))::float AS south,
         ST_XMax(ST_Extent(fp.geom))::float AS east,
         ST_YMax(ST_Extent(fp.geom))::float AS north
       FROM public.kebun k
       LEFT JOIN public.layer_peta lp ON lp.kebun_id = k.id
       LEFT JOIN public.fitur_peta fp ON fp.layer_id = lp.id
       WHERE k.kode_kebun ILIKE $1
          OR k.nama_kebun ILIKE $1
          OR COALESCE(k.wilayah, '') ILIKE $1
          OR COALESCE(k.komoditas, '') ILIKE $1
          OR COALESCE(k.keterangan, '') ILIKE $1
       GROUP BY k.id
       ORDER BY k.nama_kebun ASC
       LIMIT 10;`,
      [searchPattern]
    );

    for (const row of kebunRes.rows) {
      const { extent, bbox } = buildExtent(row);
      results.push({
        type: 'kebun',
        id: Number(row.id),
        title: `${row.kode_kebun} — ${row.nama_kebun}`,
        subtitle: `Kebun · ${row.wilayah || 'Wilayah belum diisi'} · ${row.komoditas || 'Kelapa Sawit'}${
          row.keterangan ? ` · ${row.keterangan}` : ''
        }`,
        kebun_id: Number(row.id),
        layer_id: row.first_layer_id ? Number(row.first_layer_id) : null,
        feature_id: null,
        extent,
        bbox,
      });
    }

    // 2. Cari pada tabel public.layer_peta & public.data_unggahan (nama_layer, nama_file_shp, nama_data)
    const layerRes = await query<LayerSearchRow>(
      `SELECT
         lp.id,
         lp.kebun_id,
         k.nama_kebun,
         lp.nama_layer,
         lp.nama_file_shp,
         du.nama_data,
         lp.tipe_geometri,
         COUNT(fp.id)::int AS jumlah_fitur,
         ST_XMin(ST_Extent(fp.geom))::float AS west,
         ST_YMin(ST_Extent(fp.geom))::float AS south,
         ST_XMax(ST_Extent(fp.geom))::float AS east,
         ST_YMax(ST_Extent(fp.geom))::float AS north
       FROM public.layer_peta lp
       LEFT JOIN public.data_unggahan du ON du.id = lp.unggahan_id
       LEFT JOIN public.kebun k ON k.id = lp.kebun_id
       LEFT JOIN public.fitur_peta fp ON fp.layer_id = lp.id
       WHERE lp.nama_layer ILIKE $1
          OR COALESCE(lp.nama_file_shp, '') ILIKE $1
          OR COALESCE(du.nama_data, '') ILIKE $1
       GROUP BY lp.id, k.nama_kebun, du.nama_data
       ORDER BY lp.id DESC
       LIMIT 15;`,
      [searchPattern]
    );

    for (const row of layerRes.rows) {
      const { extent, bbox } = buildExtent(row);
      results.push({
        type: 'layer',
        id: Number(row.id),
        title: row.nama_layer,
        subtitle: `Layer ${row.tipe_geometri} · ${row.jumlah_fitur} fitur${
          row.nama_kebun ? ` · ${row.nama_kebun}` : ''
        }${row.nama_data ? ` (${row.nama_data})` : ''}`,
        kebun_id: row.kebun_id ? Number(row.kebun_id) : null,
        layer_id: Number(row.id),
        feature_id: null,
        extent,
        bbox,
      });
    }

    // 3. Cari pada atribut JSONB fitur_peta (atribut::text ILIKE $1)
    const featureRes = await query<FeatureSearchRow>(
      `SELECT
         fp.id,
         fp.layer_id,
         lp.kebun_id,
         lp.nama_layer,
         k.nama_kebun,
         fp.atribut,
         ST_XMin(ST_Envelope(fp.geom))::float AS west,
         ST_YMin(ST_Envelope(fp.geom))::float AS south,
         ST_XMax(ST_Envelope(fp.geom))::float AS east,
         ST_YMax(ST_Envelope(fp.geom))::float AS north
       FROM public.fitur_peta fp
       INNER JOIN public.layer_peta lp ON lp.id = fp.layer_id
       LEFT JOIN public.kebun k ON k.id = lp.kebun_id
       WHERE fp.atribut::text ILIKE $1
       ORDER BY fp.id ASC
       LIMIT $2;`,
      [searchPattern, limit]
    );

    for (const row of featureRes.rows) {
      const { extent, bbox } = buildExtent(row);
      const attrs = row.atribut || {};
      const entries = Object.entries(attrs);

      const matchedPairs = entries
        .filter(
          ([k, v]) =>
            k.toLowerCase().includes(q.toLowerCase()) ||
            String(v ?? '')
              .toLowerCase()
              .includes(q.toLowerCase())
        )
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${String(v)}`);

      const labelValue =
        attrs['Kode Blok'] ||
        attrs['kode_blok'] ||
        attrs['KODE_BLOK'] ||
        attrs['Nama Kebun'] ||
        attrs['nama_kebun'] ||
        attrs['Afdeling'] ||
        attrs['afdeling'] ||
        attrs['Nama Ruas'] ||
        attrs['NAMA'] ||
        attrs['nama'] ||
        `Fitur #${row.id}`;

      results.push({
        type: 'feature',
        id: Number(row.id),
        title: `${String(labelValue)} (${row.nama_layer})`,
        subtitle:
          matchedPairs.length > 0
            ? `${matchedPairs.join(' · ')}${row.nama_kebun ? ` · ${row.nama_kebun}` : ''}`
            : `Layer: ${row.nama_layer}${row.nama_kebun ? ` · ${row.nama_kebun}` : ''}`,
        kebun_id: row.kebun_id ? Number(row.kebun_id) : null,
        layer_id: Number(row.layer_id),
        feature_id: Number(row.id),
        extent,
        bbox,
      });
    }

    return NextResponse.json({
      status: 'success',
      query: q,
      total: results.length,
      data: results,
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal melakukan pencarian data spasial dan kebun.',
        detail: error.message,
      },
      { status: 500 }
    );
  }
}
