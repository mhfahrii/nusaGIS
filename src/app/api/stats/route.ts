import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const kebunIdParam = searchParams.get('kebun_id');
    const kebunId = kebunIdParam ? parseInt(kebunIdParam, 10) : null;
    const layerIdParam = searchParams.get('layer_id');
    const layerId = layerIdParam ? parseInt(layerIdParam, 10) : null;

    let whereKebun = '';
    const params: unknown[] = [];
    if (kebunId && !isNaN(kebunId) && kebunId > 0) {
      whereKebun = 'WHERE kebun_id = $1';
      params.push(kebunId);
    }

    // Ambil komoditas aktif
    let komoditas = 'Kelapa Sawit';
    if (kebunId) {
      const kRes = await query<{ komoditas: string }>(
        'SELECT komoditas FROM public.kebun WHERE id = $1',
        [kebunId]
      );
      if (kRes.rows.length > 0 && kRes.rows[0].komoditas) {
        komoditas = kRes.rows[0].komoditas;
      }
    } else if (layerId) {
      const lRes = await query<{ komoditas: string }>(
        `SELECT COALESCE(k.komoditas, 'Kelapa Sawit') AS komoditas
         FROM public.layer_peta lp
         LEFT JOIN public.kebun k ON k.id = lp.kebun_id
         WHERE lp.id = $1`,
        [layerId]
      );
      if (lRes.rows.length > 0 && lRes.rows[0].komoditas) {
        komoditas = lRes.rows[0].komoditas;
      }
    } else {
      const allK = await query<{ komoditas_agg: string }>(
        `SELECT string_agg(DISTINCT komoditas, ', ') AS komoditas_agg FROM public.kebun WHERE komoditas IS NOT NULL`
      );
      if (allK.rows.length > 0 && allK.rows[0].komoditas_agg) {
        komoditas = allK.rows[0].komoditas_agg;
      }
    }

    // Hitung statistik aktual dari PostgreSQL & PostGIS
    let luasWhere = "WHERE ST_GeometryType(fp.geom) IN ('ST_Polygon', 'ST_MultiPolygon') AND COALESCE(fp.is_deleted, FALSE) = FALSE";
    const luasParams: unknown[] = [];
    if (layerId && !isNaN(layerId) && layerId > 0) {
      luasWhere += ' AND fp.layer_id = $1';
      luasParams.push(layerId);
    } else if (kebunId && !isNaN(kebunId) && kebunId > 0) {
      luasWhere = `JOIN public.layer_peta lp ON lp.id = fp.layer_id WHERE lp.kebun_id = $1 AND ST_GeometryType(fp.geom) IN ('ST_Polygon', 'ST_MultiPolygon') AND COALESCE(fp.is_deleted, FALSE) = FALSE`;
      luasParams.push(kebunId);
    }

    const luasQuery = `
      SELECT COALESCE(ROUND((SUM(ST_Area(fp.geom::geography)) / 10000.0)::numeric, 2), 0)::float AS total_luas_ha
      FROM public.fitur_peta fp
      ${luasWhere}
    `;
    const luasRes = await query<{ total_luas_ha: number }>(luasQuery, luasParams);
    const totalLuasHa = luasRes.rows[0]?.total_luas_ha ?? 0;

    const statsQuery = `
      SELECT 
        (SELECT COUNT(*)::int FROM public.kebun) AS total_kebun,
        (SELECT COUNT(*)::int FROM public.afdeling ${kebunId ? 'WHERE kebun_id = $1' : ''}) AS total_afdeling,
        (SELECT COUNT(*)::int FROM public.blok b ${
          kebunId ? 'JOIN public.afdeling a ON a.id = b.afdeling_id WHERE a.kebun_id = $1' : ''
        }) AS total_blok,
        (SELECT COUNT(*)::int FROM public.layer_peta ${whereKebun}) AS total_layer,
        (SELECT COUNT(*)::int FROM public.fitur_peta fp ${
          kebunId ? 'JOIN public.layer_peta lp ON lp.id = fp.layer_id WHERE lp.kebun_id = $1 AND COALESCE(fp.is_deleted, FALSE) = FALSE' : 'WHERE COALESCE(fp.is_deleted, FALSE) = FALSE'
        }) AS total_fitur,
        (SELECT COUNT(*)::int FROM public.data_unggahan ${whereKebun}) AS total_unggahan;
    `;

    const statsRes = await query<{
      total_kebun: number;
      total_afdeling: number;
      total_blok: number;
      total_layer: number;
      total_fitur: number;
      total_unggahan: number;
    }>(statsQuery, params);

    const baseStats = statsRes.rows[0] || {
      total_kebun: 0,
      total_afdeling: 0,
      total_blok: 0,
      total_layer: 0,
      total_fitur: 0,
      total_unggahan: 0,
    };

    // 1. Ambil seluruh baris fitur poligon beserta atribut DBF & metrik geometri PostGIS
    const featQuery = `
      SELECT 
        fp.id,
        fp.atribut,
        ROUND((ST_Area(fp.geom::geography) / 10000.0)::numeric, 4)::float AS geom_luas_ha,
        ROUND((ST_Perimeter(fp.geom::geography) / 1000.0)::numeric, 3)::float AS geom_keliling_km
      FROM public.fitur_peta fp
      ${luasWhere}
      ORDER BY fp.id ASC;
    `;
    const featRes = await query<{
      id: number;
      atribut: Record<string, unknown>;
      geom_luas_ha: number | null;
      geom_keliling_km: number | null;
    }>(featQuery, luasParams);

    const crsRes = await query<{ crs_asal: string | null }>(
      `SELECT crs_asal FROM public.layer_peta WHERE crs_asal IS NOT NULL ORDER BY id DESC LIMIT 1;`
    );
    const crsAsal = crsRes.rows[0]?.crs_asal || 'GCS_WGS_1984 (EPSG:4326)';

    let sumLuasKolom = 0;
    let sumLuasGeom = 0;
    let sumLuasBaku = 0;
    let sumLuasTanam = 0;
    let sumKelilingKm = 0;
    let sumPohonKolom = 0;

    let ksGpaCount = 0;
    let ksGpaLuasHa = 0;
    let ktgCount = 0;
    let ktgLuasHa = 0;

    let maxBlokLuas = -Infinity;
    let maxBlokName = '-';
    let minBlokLuas = Infinity;
    let minBlokName = '-';

    const varietasSet = new Set<string>();
    const statusSet = new Set<string>();
    const mtSet = new Set<string>();

    for (const row of featRes.rows) {
      const a = row.atribut || {};
      const popupRaw = String(a.PopupInfo ?? a.popupinfo ?? '');

      // Nama blok
      const rawName = String(
        a.Name ?? a.NAME ?? a.nama_blok ?? a.KODE_BLOK ?? a.kode_blok ?? `Blok #${row.id}`
      )
        .replace(/;\s*[0-9.,]+\s*Ha\s*$/i, '')
        .trim();

      // Luas Ukur dari kolom DBF (luas) atau fallback ST_Area PostGIS
      const rawLuasAttr = parseFloat(
        String(a.luas ?? a.Luas ?? a.LUAS ?? a.luas_ha ?? a.LUAS_HA ?? '').replace(',', '.')
      );
      const geomLuas = row.geom_luas_ha || 0;
      const blokLuas = Number.isFinite(rawLuasAttr) && rawLuasAttr > 0 ? rawLuasAttr : geomLuas;

      if (Number.isFinite(rawLuasAttr) && rawLuasAttr > 0) sumLuasKolom += rawLuasAttr;
      sumLuasGeom += geomLuas;
      sumKelilingKm += row.geom_keliling_km || 0;

      if (blokLuas > maxBlokLuas) {
        maxBlokLuas = blokLuas;
        maxBlokName = rawName;
      }
      if (blokLuas > 0 && blokLuas < minBlokLuas) {
        minBlokLuas = blokLuas;
        minBlokName = rawName;
      }

      // Parse PopupInfo multiline ("Luas Baku : 2,31 Ha\nStatus Lahan : ...")
      const popupMap: Record<string, string> = {};
      for (const line of popupRaw.split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          popupMap[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        }
      }

      const bakuStr = String(a.Luas_Baku ?? a.luas_baku ?? popupMap['luas baku'] ?? '');
      const bakuMatch = bakuStr.match(/([0-9]+(?:[.,][0-9]+)?)/);
      if (bakuMatch) {
        const v = parseFloat(bakuMatch[1].replace(',', '.'));
        if (Number.isFinite(v) && v > 0) sumLuasBaku += v;
      }

      const tanamStr = String(a.Luas_Tanam ?? a.luas_tanam ?? popupMap['luas tanam'] ?? '');
      const tanamMatch = tanamStr.match(/([0-9]+(?:[.,][0-9]+)?)/);
      if (tanamMatch) {
        const v = parseFloat(tanamMatch[1].replace(',', '.'));
        if (Number.isFinite(v) && v > 0) sumLuasTanam += v;
      }

      const statusVal = String(a['Status Lahan'] ?? a.status_lahan ?? popupMap['status lahan'] ?? '').trim();
      if (statusVal) {
        statusSet.add(statusVal);
        if (/ktg|tebu giling/i.test(statusVal)) {
          ktgCount++;
          ktgLuasHa += blokLuas;
        } else if (/gpa|kerjasama/i.test(statusVal)) {
          ksGpaCount++;
          ksGpaLuasHa += blokLuas;
        }
      }

      const varVal = String(a.Varietas ?? a.varietas ?? popupMap['varietas'] ?? '').trim();
      if (varVal) varietasSet.add(varVal);

      const mtVal = String(a.MT ?? a.mt ?? a.masa_tanam ?? popupMap['mt'] ?? '').trim();
      if (mtVal) mtSet.add(mtVal);

      const pohonRaw = parseFloat(
        String(a.jml_pohon ?? a.jumlah_pohon ?? a.pokok ?? a.POKOK ?? '').replace(/[^0-9.]/g, '')
      );
      if (Number.isFinite(pohonRaw) && pohonRaw > 0) sumPohonKolom += pohonRaw;
    }

    const parsedVarietas = [...varietasSet].join(', ');
    const parsedStatusLahan = [...statusSet].join(' · ');
    const parsedMT = [...mtSet].join(', ');

    const isTebu =
      komoditas.toLowerCase().includes('tebu') ||
      parsedStatusLahan.toLowerCase().includes('tebu') ||
      parsedStatusLahan.toLowerCase().includes('ktg') ||
      parsedStatusLahan.toLowerCase().includes('gpa') ||
      parsedVarietas.toLowerCase().includes('pska');

    if (isTebu) {
      komoditas = 'Tebu (KTG / KS GPA)';
    }

    const finalLuasHa =
      sumLuasKolom > 0 ? Number(sumLuasKolom.toFixed(2)) : Number(sumLuasGeom.toFixed(2)) || totalLuasHa;
    const polygonCount = featRes.rows.length;

    return NextResponse.json({
      status: 'success',
      data: {
        ...baseStats,
        total_blok: baseStats.total_blok > 0 ? baseStats.total_blok : polygonCount,
        total_luas_ha: finalLuasHa,
        total_luas_baku_ha: sumLuasBaku > 0 ? Number(sumLuasBaku.toFixed(2)) : undefined,
        luas_tanam_ha: sumLuasTanam > 0 ? Number(sumLuasTanam.toFixed(2)) : undefined,
        komoditas,
        crs_asal: crsAsal,
        jumlah_pohon: sumPohonKolom > 0 ? Math.round(sumPohonKolom) : undefined,
        varietas_dominan: parsedVarietas || undefined,
        status_lahan_dominan: parsedStatusLahan || undefined,
        masa_tanam: parsedMT || undefined,
        ks_gpa_count: ksGpaCount,
        ks_gpa_luas_ha: Number(ksGpaLuasHa.toFixed(2)),
        ktg_count: ktgCount,
        ktg_luas_ha: Number(ktgLuasHa.toFixed(2)),
        max_blok_luas_ha: Number.isFinite(maxBlokLuas) ? Number(maxBlokLuas.toFixed(2)) : undefined,
        max_blok_name: maxBlokName,
        min_blok_luas_ha: Number.isFinite(minBlokLuas) ? Number(minBlokLuas.toFixed(2)) : undefined,
        min_blok_name: minBlokName,
        avg_blok_luas_ha: polygonCount > 0 ? Number((finalLuasHa / polygonCount).toFixed(2)) : undefined,
        total_keliling_km: sumKelilingKm > 0 ? Number(sumKelilingKm.toFixed(2)) : undefined,
      },
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data statistik.', detail: error.message },
      { status: 500 }
    );
  }
}
