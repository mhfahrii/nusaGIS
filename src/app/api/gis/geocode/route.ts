import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import type { LocalSearchResult } from '@/lib/geoSearch';

/**
 * Pencarian data internal (hasil upload file SHP/KML/GeoJSON/GeoTIFF & digitasi lahan)
 * untuk kotak search peta.
 */

const NAME_KEYS = [
  'Name',
  'NAME',
  'name',
  'Nama',
  'NAMA',
  'nama_blok',
  'NAMA_BLOK',
  'kode_blok',
  'KODE_BLOK',
  'Kode Blok',
  'nama_afdeling',
  'NAMA_AFDELING',
  'nama_kebun',
  'NAMA_KEBUN',
  'label',
  'Label',
];

function pickName(atribut: Record<string, unknown>, fallback: string): string {
  for (const k of NAME_KEYS) {
    const v = atribut[k];
    if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
  }
  return fallback;
}

/** Cari atribut yang memuat kata kunci untuk ditampilkan sebagai cuplikan */
function matchSnippet(atribut: Record<string, unknown>, tokens: string[]): string | null {
  for (const [k, v] of Object.entries(atribut)) {
    if (k.startsWith('_') || v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (tokens.some((t) => s.toLowerCase().includes(t) || k.toLowerCase().includes(t))) {
      return `${k}: ${s.length > 50 ? s.slice(0, 50) + '…' : s}`;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const rawQuery = new URL(req.url).searchParams.get('q')?.trim() || '';
  if (rawQuery.length < 2) {
    return NextResponse.json({ status: 'success', data: [] });
  }

  const results: LocalSearchResult[] = [];
  const tokens = rawQuery
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((t) => t.length >= 1)
    .slice(0, 6);
  if (tokens.length === 0) tokens.push(rawQuery.toLowerCase());

  // 1. Koordinat langsung: "-0.62, 117.19" atau "117.19, -0.62"
  const coord = rawQuery.match(/^\s*([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)\s*$/);
  if (coord) {
    let lat = parseFloat(coord[1]);
    let lng = parseFloat(coord[2]);
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      results.push({
        id: 'coord',
        kind: 'coordinate',
        name: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        description: 'Koordinat GPS (WGS84)',
        badge: 'Koordinat',
        lat,
        lng,
      });
    }
  }

  const tokenParams = tokens.map((t) => `%${t}%`);

  // 2. Fitur lahan (poligon/garis/titik) dari hasil upload & digitasi
  try {
    const conds = tokens.map(
      (_, i) =>
        `(fp.atribut::text ILIKE $${i + 1} OR lp.nama_layer ILIKE $${i + 1} OR COALESCE(du.nama_data,'') ILIKE $${i + 1} OR COALESCE(k.nama_kebun,'') ILIKE $${i + 1} OR COALESCE(k.kode_kebun,'') ILIKE $${i + 1} OR COALESCE(a.nama_afdeling,'') ILIKE $${i + 1} OR COALESCE(b.nama_blok,'') ILIKE $${i + 1} OR COALESCE(b.kode_blok,'') ILIKE $${i + 1})`
    );
    const featRes = await query<{
      id: number;
      layer_id: number;
      nama_layer: string;
      nama_kebun: string | null;
      terlihat: boolean;
      atribut: Record<string, unknown>;
      lat: number;
      lng: number;
      min_x: number;
      min_y: number;
      max_x: number;
      max_y: number;
      luas_ha: number | null;
      geom_json: GeoJSON.Geometry | null;
    }>(
      `SELECT fp.id, fp.layer_id, lp.nama_layer, k.nama_kebun, lp.terlihat, fp.atribut,
              ST_Y(ST_PointOnSurface(fp.geom))::float8 AS lat,
              ST_X(ST_PointOnSurface(fp.geom))::float8 AS lng,
              ST_XMin(fp.geom)::float8 AS min_x, ST_YMin(fp.geom)::float8 AS min_y,
              ST_XMax(fp.geom)::float8 AS max_x, ST_YMax(fp.geom)::float8 AS max_y,
              CASE
                WHEN ST_GeometryType(fp.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
                THEN ROUND((ST_Area(fp.geom::geography) / 10000.0)::numeric, 2)::float8
                ELSE NULL
              END AS luas_ha,
              ST_AsGeoJSON(fp.geom)::jsonb AS geom_json
       FROM public.fitur_peta fp
       JOIN public.layer_peta lp ON lp.id = fp.layer_id
       LEFT JOIN public.data_unggahan du ON du.id = lp.unggahan_id
       LEFT JOIN public.kebun k ON k.id = lp.kebun_id
       LEFT JOIN public.afdeling a ON a.id = lp.afdeling_id
       LEFT JOIN public.blok b ON b.id = lp.blok_id
       WHERE ${conds.join(' AND ')}
       ORDER BY fp.id DESC
       LIMIT 10`,
      tokenParams
    );

    const q = rawQuery.toLowerCase();
    const scored = featRes.rows.map((f) => {
      const name = pickName(f.atribut || {}, `Fitur #${f.id}`);
      const nl = name.toLowerCase();
      const score = nl === q ? 0 : nl.startsWith(q) ? 1 : nl.includes(q) ? 2 : 3;
      return { f, name, score };
    });
    scored.sort((a, b) => a.score - b.score);

    for (const { f, name } of scored) {
      const snippet = matchSnippet(f.atribut || {}, tokens);
      const metaParts = [
        f.nama_kebun ? f.nama_kebun : `Layer ${f.nama_layer}`,
        f.luas_ha !== null ? `${f.luas_ha} Ha` : null,
        snippet,
      ].filter(Boolean);

      results.push({
        id: `feat-${f.id}`,
        kind: 'feature',
        name,
        description: metaParts.join(' · '),
        badge: f.luas_ha !== null ? `Lahan (${f.luas_ha} Ha)` : 'Fitur Lahan',
        lat: f.lat,
        lng: f.lng,
        bbox: [f.min_x, f.min_y, f.max_x, f.max_y],
        featureId: Number(f.id),
        layerId: Number(f.layer_id),
        layerVisible: Boolean(f.terlihat),
        luasHa: f.luas_ha,
        geometry: f.geom_json,
      });
    }
  } catch (err) {
    console.warn('Local feature search error:', err);
  }

  // 3. Layer vektor berdasarkan nama layer / file / dataset / kebun
  try {
    const conds = tokens.map(
      (_, i) =>
        `(lp.nama_layer ILIKE $${i + 1} OR COALESCE(lp.nama_file_shp,'') ILIKE $${i + 1} OR COALESCE(du.nama_data,'') ILIKE $${i + 1} OR COALESCE(k.nama_kebun,'') ILIKE $${i + 1} OR COALESCE(k.kode_kebun,'') ILIKE $${i + 1})`
    );
    const layerRes = await query<{
      id: number;
      nama_layer: string;
      nama_kebun: string | null;
      terlihat: boolean;
      jumlah_fitur: number;
      min_x: number | null;
      min_y: number | null;
      max_x: number | null;
      max_y: number | null;
    }>(
      `SELECT lp.id, lp.nama_layer, k.nama_kebun, lp.terlihat, lp.jumlah_fitur,
              ST_XMin(ST_Extent(fp.geom))::float8 AS min_x, ST_YMin(ST_Extent(fp.geom))::float8 AS min_y,
              ST_XMax(ST_Extent(fp.geom))::float8 AS max_x, ST_YMax(ST_Extent(fp.geom))::float8 AS max_y
       FROM public.layer_peta lp
       LEFT JOIN public.data_unggahan du ON du.id = lp.unggahan_id
       LEFT JOIN public.kebun k ON k.id = lp.kebun_id
       LEFT JOIN public.fitur_peta fp ON fp.layer_id = lp.id
       WHERE ${conds.join(' AND ')}
       GROUP BY lp.id, k.nama_kebun
       LIMIT 4`,
      tokenParams
    );

    for (const l of layerRes.rows) {
      if (l.min_x === null || l.min_y === null || l.max_x === null || l.max_y === null) continue;
      results.push({
        id: `layer-${l.id}`,
        kind: 'layer',
        name: l.nama_layer,
        description: `${l.nama_kebun ? `${l.nama_kebun} · ` : ''}${l.jumlah_fitur} fitur spasial`,
        badge: 'Layer Peta',
        lat: (l.min_y + l.max_y) / 2,
        lng: (l.min_x + l.max_x) / 2,
        bbox: [l.min_x, l.min_y, l.max_x, l.max_y],
        layerId: Number(l.id),
        layerVisible: Boolean(l.terlihat),
      });
    }
  } catch (err) {
    console.warn('Local layer search error:', err);
  }

  // 4. Layer citra raster (GeoTIFF / NDVI / Orthomosaic) hasil upload
  try {
    const conds = tokens.map(
      (_, i) =>
        `(r.nama_layer ILIKE $${i + 1} OR COALESCE(r.nama_file,'') ILIKE $${i + 1} OR COALESCE(r.tipe_raster,'') ILIKE $${i + 1} OR COALESCE(k.nama_kebun,'') ILIKE $${i + 1})`
    );
    const rasterRes = await query<{
      id: number;
      nama_layer: string;
      tipe_raster: string;
      nama_kebun: string | null;
      terlihat: boolean;
      min_x: number | null;
      min_y: number | null;
      max_x: number | null;
      max_y: number | null;
    }>(
      `SELECT r.id, r.nama_layer, r.tipe_raster, k.nama_kebun, r.terlihat,
              ST_XMin(r.bbox_wgs84)::float8 AS min_x, ST_YMin(r.bbox_wgs84)::float8 AS min_y,
              ST_XMax(r.bbox_wgs84)::float8 AS max_x, ST_YMax(r.bbox_wgs84)::float8 AS max_y
       FROM public.layer_raster r
       LEFT JOIN public.kebun k ON k.id = r.kebun_id
       WHERE ${conds.join(' AND ')}
       LIMIT 3`,
      tokenParams
    );

    for (const r of rasterRes.rows) {
      if (r.min_x === null || r.min_y === null || r.max_x === null || r.max_y === null) continue;
      results.push({
        id: `raster-${r.id}`,
        kind: 'raster',
        name: r.nama_layer,
        description: `Citra Raster ${r.tipe_raster}${r.nama_kebun ? ` · ${r.nama_kebun}` : ''}`,
        badge: `Raster ${r.tipe_raster}`,
        lat: (r.min_y + r.max_y) / 2,
        lng: (r.min_x + r.max_x) / 2,
        bbox: [r.min_x, r.min_y, r.max_x, r.max_y],
        rasterId: Number(r.id),
        layerVisible: Boolean(r.terlihat),
      });
    }
  } catch (err) {
    console.warn('Local raster search error:', err);
  }

  return NextResponse.json({ status: 'success', query: rawQuery, data: results });
}
