import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, safeErrorDetail } from '@/lib/auth/guard';
import {
  extractFeatureIntel,
  detectCommodityProfile,
} from '@/lib/gis/attributeExtractor';
import { findRpnEntity, normalizePerusahaanName } from '@/lib/gis/rpnEntities';

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const kebunIdParam = searchParams.get('kebun_id');
    const kebunId = kebunIdParam ? parseInt(kebunIdParam, 10) : null;
    const layerIdParam = searchParams.get('layer_id');
    const layerId = layerIdParam ? parseInt(layerIdParam, 10) : null;
    const wilayahParam = searchParams.get('wilayah')?.trim() || null;
    const perusahaanParam = searchParams.get('perusahaan')?.trim() || null;

    const validKebunId = kebunId && !isNaN(kebunId) && kebunId > 0 ? kebunId : null;
    const validLayerId = layerId && !isNaN(layerId) && layerId > 0 ? layerId : null;
    const normalizedPerusahaan = perusahaanParam ? normalizePerusahaanName(perusahaanParam) : null;
    const matchedEntity = perusahaanParam ? findRpnEntity(perusahaanParam) : null;

    // Helper SQL filter perusahaan (cocokkan nama kanonik maupun kode singkat Puslit)
    const perusahaanSqlCond = matchedEntity
      ? `(LOWER(TRIM(k.perusahaan)) = LOWER(TRIM($1)) OR LOWER(TRIM(k.perusahaan)) = LOWER($2) OR LOWER(TRIM(k.perusahaan)) LIKE LOWER($3))`
      : `LOWER(TRIM(k.perusahaan)) = LOWER(TRIM($1))`;

    // 1. Query agregasi dasar (total kebun, afdeling, blok, layer, fitur, unggahan)
    let statsQuery = '';
    const params: unknown[] = [];
    if (validKebunId) {
      params.push(validKebunId);
      statsQuery = `
        SELECT
          (SELECT COUNT(*)::int FROM public.kebun WHERE id = $1) AS total_kebun,
          (SELECT COUNT(*)::int FROM public.afdeling WHERE kebun_id = $1) AS total_afdeling,
          (SELECT COUNT(*)::int FROM public.blok b JOIN public.afdeling a ON a.id = b.afdeling_id WHERE a.kebun_id = $1) AS total_blok,
          (SELECT COUNT(*)::int FROM public.layer_peta WHERE kebun_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE) AS total_layer,
          (SELECT COUNT(*)::int FROM public.fitur_peta fp JOIN public.layer_peta lp ON lp.id = fp.layer_id WHERE lp.kebun_id = $1 AND COALESCE(lp.is_deleted, FALSE) = FALSE AND COALESCE(fp.is_deleted, FALSE) = FALSE) AS total_fitur,
          (SELECT COUNT(*)::int FROM public.data_unggahan WHERE kebun_id = $1) AS total_unggahan;
      `;
    } else if (wilayahParam && normalizedPerusahaan) {
      params.push(normalizedPerusahaan);
      let wilParamIdx = 2;
      if (matchedEntity) {
        params.push(matchedEntity.code, `${matchedEntity.code} %`);
        wilParamIdx = 4;
      }
      params.push(wilayahParam);
      statsQuery = `
        SELECT
          (SELECT COUNT(*)::int FROM public.kebun k WHERE ${perusahaanSqlCond} AND (LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($${wilParamIdx})) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($${wilParamIdx})) || '%')) AS total_kebun,
          (SELECT COUNT(*)::int FROM public.afdeling a JOIN public.kebun k ON k.id = a.kebun_id WHERE ${perusahaanSqlCond} AND (LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($${wilParamIdx})) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($${wilParamIdx})) || '%')) AS total_afdeling,
          (SELECT COUNT(*)::int FROM public.blok b JOIN public.afdeling a ON a.id = b.afdeling_id JOIN public.kebun k ON k.id = a.kebun_id WHERE ${perusahaanSqlCond} AND (LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($${wilParamIdx})) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($${wilParamIdx})) || '%')) AS total_blok,
          (SELECT COUNT(*)::int FROM public.layer_peta lp JOIN public.kebun k ON k.id = lp.kebun_id WHERE ${perusahaanSqlCond} AND (LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($${wilParamIdx})) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($${wilParamIdx})) || '%') AND COALESCE(lp.is_deleted, FALSE) = FALSE) AS total_layer,
          (SELECT COUNT(*)::int FROM public.fitur_peta fp JOIN public.layer_peta lp ON lp.id = fp.layer_id JOIN public.kebun k ON k.id = lp.kebun_id WHERE ${perusahaanSqlCond} AND (LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($${wilParamIdx})) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($${wilParamIdx})) || '%') AND COALESCE(lp.is_deleted, FALSE) = FALSE AND COALESCE(fp.is_deleted, FALSE) = FALSE) AS total_fitur,
          (SELECT COUNT(*)::int FROM public.data_unggahan du JOIN public.kebun k ON k.id = du.kebun_id WHERE ${perusahaanSqlCond} AND (LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($${wilParamIdx})) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($${wilParamIdx})) || '%')) AS total_unggahan;
      `;
    } else if (wilayahParam) {
      params.push(wilayahParam);
      statsQuery = `
        SELECT
          (SELECT COUNT(*)::int FROM public.kebun WHERE LOWER(TRIM(COALESCE(provinsi, ''))) = LOWER(TRIM($1)) OR LOWER(TRIM(COALESCE(wilayah, ''))) LIKE '%' || LOWER(TRIM($1)) || '%') AS total_kebun,
          (SELECT COUNT(*)::int FROM public.afdeling a JOIN public.kebun k ON k.id = a.kebun_id WHERE LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($1)) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($1)) || '%') AS total_afdeling,
          (SELECT COUNT(*)::int FROM public.blok b JOIN public.afdeling a ON a.id = b.afdeling_id JOIN public.kebun k ON k.id = a.kebun_id WHERE LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($1)) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($1)) || '%') AS total_blok,
          (SELECT COUNT(*)::int FROM public.layer_peta lp JOIN public.kebun k ON k.id = lp.kebun_id WHERE (LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($1)) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($1)) || '%') AND COALESCE(lp.is_deleted, FALSE) = FALSE) AS total_layer,
          (SELECT COUNT(*)::int FROM public.fitur_peta fp JOIN public.layer_peta lp ON lp.id = fp.layer_id JOIN public.kebun k ON k.id = lp.kebun_id WHERE (LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($1)) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($1)) || '%') AND COALESCE(lp.is_deleted, FALSE) = FALSE AND COALESCE(fp.is_deleted, FALSE) = FALSE) AS total_fitur,
          (SELECT COUNT(*)::int FROM public.data_unggahan du JOIN public.kebun k ON k.id = du.kebun_id WHERE LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($1)) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($1)) || '%') AS total_unggahan;
      `;
    } else if (normalizedPerusahaan) {
      params.push(normalizedPerusahaan);
      if (matchedEntity) {
        params.push(matchedEntity.code, `${matchedEntity.code} %`);
      }
      statsQuery = `
        SELECT
          (SELECT COUNT(*)::int FROM public.kebun k WHERE ${perusahaanSqlCond}) AS total_kebun,
          (SELECT COUNT(*)::int FROM public.afdeling a JOIN public.kebun k ON k.id = a.kebun_id WHERE ${perusahaanSqlCond}) AS total_afdeling,
          (SELECT COUNT(*)::int FROM public.blok b JOIN public.afdeling a ON a.id = b.afdeling_id JOIN public.kebun k ON k.id = a.kebun_id WHERE ${perusahaanSqlCond}) AS total_blok,
          (SELECT COUNT(*)::int FROM public.layer_peta lp JOIN public.kebun k ON k.id = lp.kebun_id WHERE ${perusahaanSqlCond} AND COALESCE(lp.is_deleted, FALSE) = FALSE) AS total_layer,
          (SELECT COUNT(*)::int FROM public.fitur_peta fp JOIN public.layer_peta lp ON lp.id = fp.layer_id JOIN public.kebun k ON k.id = lp.kebun_id WHERE ${perusahaanSqlCond} AND COALESCE(lp.is_deleted, FALSE) = FALSE AND COALESCE(fp.is_deleted, FALSE) = FALSE) AS total_fitur,
          (SELECT COUNT(*)::int FROM public.data_unggahan du JOIN public.kebun k ON k.id = du.kebun_id WHERE ${perusahaanSqlCond}) AS total_unggahan;
      `;
    } else {
      statsQuery = `
        SELECT
          (SELECT COUNT(*)::int FROM public.kebun) AS total_kebun,
          (SELECT COUNT(*)::int FROM public.afdeling) AS total_afdeling,
          (SELECT COUNT(*)::int FROM public.blok) AS total_blok,
          (SELECT COUNT(*)::int FROM public.layer_peta WHERE COALESCE(is_deleted, FALSE) = FALSE) AS total_layer,
          (SELECT COUNT(*)::int FROM public.fitur_peta fp JOIN public.layer_peta lp ON lp.id = fp.layer_id WHERE COALESCE(lp.is_deleted, FALSE) = FALSE AND COALESCE(fp.is_deleted, FALSE) = FALSE) AS total_fitur,
          (SELECT COUNT(*)::int FROM public.data_unggahan) AS total_unggahan;
      `;
    }

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

    // 2. Ambil seluruh fitur poligon lengkap dengan konteks layer & kebun dari PostGIS
    const featWhereClauses: string[] = [
      "ST_GeometryType(fp.geom) IN ('ST_Polygon', 'ST_MultiPolygon')",
      'COALESCE(fp.is_deleted, FALSE) = FALSE',
      'COALESCE(lp.is_deleted, FALSE) = FALSE',
    ];
    const featParams: unknown[] = [];

    if (validLayerId) {
      featParams.push(validLayerId);
      featWhereClauses.push(`fp.layer_id = $${featParams.length}`);
    } else if (validKebunId) {
      featParams.push(validKebunId);
      featWhereClauses.push(`lp.kebun_id = $${featParams.length}`);
    } else {
      if (wilayahParam) {
        featParams.push(wilayahParam);
        featWhereClauses.push(
          `(LOWER(TRIM(COALESCE(k.provinsi, ''))) = LOWER(TRIM($${featParams.length})) OR LOWER(TRIM(COALESCE(k.wilayah, ''))) LIKE '%' || LOWER(TRIM($${featParams.length})) || '%')`
        );
      }
      if (normalizedPerusahaan) {
        if (matchedEntity) {
          const p1 = featParams.push(normalizedPerusahaan);
          const p2 = featParams.push(matchedEntity.code);
          const p3 = featParams.push(`${matchedEntity.code} %`);
          featWhereClauses.push(
            `(LOWER(TRIM(k.perusahaan)) = LOWER(TRIM($${p1})) OR LOWER(TRIM(k.perusahaan)) = LOWER($${p2}) OR LOWER(TRIM(k.perusahaan)) LIKE LOWER($${p3}))`
          );
        } else {
          const p1 = featParams.push(normalizedPerusahaan);
          featWhereClauses.push(`LOWER(TRIM(k.perusahaan)) = LOWER(TRIM($${p1}))`);
        }
      }
    }

    const featQuery = `
      SELECT 
        fp.id,
        fp.atribut,
        lp.nama_layer,
        lp.crs_asal,
        k.perusahaan,
        k.nama_kebun,
        k.wilayah,
        k.komoditas,
        ROUND((ST_Area(fp.geom::geography) / 10000.0)::numeric, 4)::float AS geom_luas_ha,
        ROUND((ST_Perimeter(fp.geom::geography) / 1000.0)::numeric, 3)::float AS geom_keliling_km
      FROM public.fitur_peta fp
      LEFT JOIN public.layer_peta lp ON lp.id = fp.layer_id
      LEFT JOIN public.kebun k ON k.id = lp.kebun_id
      WHERE ${featWhereClauses.join(' AND ')}
      ORDER BY fp.id ASC;
    `;

    const featRes = await query<{
      id: number;
      atribut: Record<string, unknown>;
      nama_layer: string | null;
      crs_asal: string | null;
      perusahaan: string | null;
      nama_kebun: string | null;
      wilayah: string | null;
      komoditas: string | null;
      geom_luas_ha: number | null;
      geom_keliling_km: number | null;
    }>(featQuery, featParams);

    const polygonCount = featRes.rows.length;
    const isSingleBoundary = polygonCount === 1;

    // CRS aktif (prioritaskan CRS dari layer yang sedang difilter)
    let crsAsal = featRes.rows.find((r) => r.crs_asal)?.crs_asal || null;
    if (!crsAsal) {
      const crsRes = await query<{ crs_asal: string | null }>(
        `SELECT crs_asal FROM public.layer_peta WHERE crs_asal IS NOT NULL ORDER BY id DESC LIMIT 1;`
      );
      crsAsal = crsRes.rows[0]?.crs_asal || 'GCS_WGS_1984 (EPSG:4326)';
    }

    // 3. Mesin Ekstraksi Multi-Kolom Universal untuk setiap poligon
    let sumLuasUkur = 0;
    let sumLuasBaku = 0;
    let sumLuasTanam = 0;
    let sumKelilingKm = 0;
    let sumPohon = 0;
    let sumEstimasiPanen = 0;
    let sumEstimasiOlahan = 0;
    let hasOlahan = false;

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
    const afdelingMap = new Map<
      string,
      {
        name: string;
        count: number;
        luas_ukur_ha: number;
        luas_baku_ha: number;
        estimasi_panen_ton: number;
        color: string;
      }
    >();

    let primaryCommodity = detectCommodityProfile({
      perusahaan: normalizedPerusahaan || featRes.rows[0]?.perusahaan,
      wilayah: wilayahParam,
      namaKebun: featRes.rows[0]?.nama_kebun,
      layerName: featRes.rows[0]?.nama_layer,
      komoditas: featRes.rows[0]?.komoditas,
    });

    const commodityAreaByKey = new Map<string, { profile: typeof primaryCommodity; area: number; count: number }>();

    for (const row of featRes.rows) {
      const intel = extractFeatureIntel(row.atribut || {}, {
        featId: row.id,
        geomLuasHa: row.geom_luas_ha,
        geomKelilingKm: row.geom_keliling_km,
        layerName: row.nama_layer,
        perusahaan: row.perusahaan || normalizedPerusahaan,
        namaKebun: row.nama_kebun,
        wilayah: row.wilayah || wilayahParam,
        komoditas: row.komoditas,
        isSingleBoundaryLayer: isSingleBoundary,
      });

      const curComm = commodityAreaByKey.get(intel.commodity.key) || {
        profile: intel.commodity,
        area: 0,
        count: 0,
      };
      curComm.area += intel.luasUkurHa > 0 ? intel.luasUkurHa : 1;
      curComm.count += 1;
      commodityAreaByKey.set(intel.commodity.key, curComm);

      sumLuasUkur += intel.luasUkurHa;
      if (intel.luasBakuHa !== null && intel.luasBakuHa > 0) {
        sumLuasBaku += intel.luasBakuHa;
      }
      if (intel.luasTanamHa !== null && intel.luasTanamHa > 0) {
        sumLuasTanam += intel.luasTanamHa;
      }
      sumKelilingKm += intel.kelilingKm;
      if (intel.jumlahPohon) sumPohon += intel.jumlahPohon;

      sumEstimasiPanen += intel.estimasiPanenTon;
      if (intel.estimasiOlahanTon !== null) {
        sumEstimasiOlahan += intel.estimasiOlahanTon;
        hasOlahan = true;
      }

      if (intel.luasUkurHa > maxBlokLuas) {
        maxBlokLuas = intel.luasUkurHa;
        maxBlokName = intel.blokName;
      }
      if (intel.luasUkurHa > 0 && intel.luasUkurHa < minBlokLuas) {
        minBlokLuas = intel.luasUkurHa;
        minBlokName = intel.blokName;
      }

      if (intel.statusLahan) {
        statusSet.add(intel.statusLahan);
        if (/ktg|tebu giling/i.test(intel.statusLahan)) {
          ktgCount++;
          ktgLuasHa += intel.luasUkurHa;
        } else if (/gpa|kerjasama/i.test(intel.statusLahan)) {
          ksGpaCount++;
          ksGpaLuasHa += intel.luasUkurHa;
        }
      }

      if (intel.varietas) varietasSet.add(intel.varietas);
      if (intel.mt) mtSet.add(intel.mt);

      if (intel.afdelingGroup) {
        const cur = afdelingMap.get(intel.afdelingGroup) || {
          name: intel.afdelingGroup,
          count: 0,
          luas_ukur_ha: 0,
          luas_baku_ha: 0,
          estimasi_panen_ton: 0,
          color: intel.afdelingColor,
        };
        cur.count += 1;
        cur.luas_ukur_ha += intel.luasUkurHa;
        cur.luas_baku_ha += intel.luasBakuHa || 0;
        cur.estimasi_panen_ton += intel.estimasiPanenTon;
        afdelingMap.set(intel.afdelingGroup, cur);
      }
    }

    const parsedVarietas = [...varietasSet].join(', ');
    const parsedStatusLahan = [...statusSet].join(' · ');
    const parsedMT = [...mtSet].join(', ');

    // Pilih komoditas dominan berdasarkan luas areal terbesar pada scope yang dipilih
    if (commodityAreaByKey.size > 0) {
      let bestArea = -1;
      for (const entry of commodityAreaByKey.values()) {
        if (entry.profile.key !== 'belum_ditentukan' && entry.area > bestArea) {
          bestArea = entry.area;
          primaryCommodity = entry.profile;
        }
      }
    }

    const finalLuasHa = Number(sumLuasUkur.toFixed(2));
    const finalBakuHa = sumLuasBaku > 0 ? Number(sumLuasBaku.toFixed(2)) : undefined;

    let selisihLuasHa: number | undefined;
    let selisihLuasPct: number | undefined;
    let auditStatus: 'sesuai' | 'lebih' | 'kurang' | null = null;
    if (finalBakuHa && finalBakuHa > 0 && finalLuasHa > 0) {
      selisihLuasHa = Number((finalLuasHa - finalBakuHa).toFixed(2));
      selisihLuasPct = Number(((selisihLuasHa / finalBakuHa) * 100).toFixed(1));
      auditStatus =
        Math.abs(selisihLuasPct) <= 3.0
          ? 'sesuai'
          : selisihLuasPct > 3.0
          ? 'lebih'
          : 'kurang';
    }

    const afdelingBreakdown = Array.from(afdelingMap.values())
      .map((a) => ({
        ...a,
        luas_ukur_ha: Number(a.luas_ukur_ha.toFixed(2)),
        luas_baku_ha: Number(a.luas_baku_ha.toFixed(2)),
        estimasi_panen_ton: Number(a.estimasi_panen_ton.toFixed(1)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));

    const totalKelilingKm = sumKelilingKm > 0 ? Number(sumKelilingKm.toFixed(2)) : undefined;
    const potensiTanamEfektifHa = isSingleBoundary
      ? Number((finalLuasHa * primaryCommodity.effectivePlantableRatio).toFixed(2))
      : undefined;

    return NextResponse.json({
      status: 'success',
      data: {
        ...baseStats,
        total_fitur: polygonCount > 0 ? polygonCount : baseStats.total_fitur,
        total_blok: polygonCount > 0 ? polygonCount : baseStats.total_blok,
        total_luas_ha: finalLuasHa,
        total_luas_baku_ha: finalBakuHa,
        luas_tanam_ha: sumLuasTanam > 0 ? Number(sumLuasTanam.toFixed(2)) : undefined,
        komoditas: primaryCommodity.label,
        crs_asal: crsAsal,
        jumlah_pohon: sumPohon > 0 ? Math.round(sumPohon) : undefined,
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
        total_keliling_km: totalKelilingKm,
        selisih_luas_ha: selisihLuasHa,
        selisih_luas_pct: selisihLuasPct,
        audit_status: auditStatus,
        is_single_boundary: isSingleBoundary,
        luas_m2: Math.round(finalLuasHa * 10000),
        keliling_meter: totalKelilingKm ? Math.round(totalKelilingKm * 1000) : undefined,
        potensi_tanam_efektif_ha: potensiTanamEfektifHa,
        estimasi_panen_ton: Number(sumEstimasiPanen.toFixed(1)),
        estimasi_olahan_ton: hasOlahan ? Number(sumEstimasiOlahan.toFixed(2)) : null,
        commodity_profile: {
          key: primaryCommodity.key,
          label: primaryCommodity.label,
          shortLabel: primaryCommodity.shortLabel,
          yieldPerHa: primaryCommodity.yieldPerHa,
          yieldUnit: primaryCommodity.yieldUnit,
          rendemenPct: primaryCommodity.rendemenPct,
          processedLabel: primaryCommodity.processedLabel,
          processedUnit: primaryCommodity.processedUnit,
          standardSource: primaryCommodity.standardSource,
        },
        afdeling_breakdown: afdelingBreakdown.length > 0 ? afdelingBreakdown : undefined,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data statistik.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}
