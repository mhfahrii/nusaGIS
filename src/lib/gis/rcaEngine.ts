/**
 * Mesin Analisis Risiko 4 Tingkat (Hijau, Kuning, Oranye, Merah Pekat),
 * Diagnosis Masalah Blok, Rumus Pembobotan 5 Faktor Root Cause Analysis (RCA - Normalisasi 100%),
 * dan Mesin Rekomendasi Tindakan Otomatis (Prescriptive Agronomy Engine).
 */

import { extractFeatureIntel, parseNumericHa } from './attributeExtractor';

export type RiskTier = 'normal' | 'moderate' | 'high' | 'critical';

export interface RcaFactor {
  key: 'air' | 'hara' | 'vegetasi' | 'rotasi' | 'umur';
  label: string;
  percentage: number;
  color: string;
  detail: string;
}

export interface BlockRiskDiagnosis {
  featId: number;
  blokName: string;
  afdelingName: string;
  komoditas: string;
  luasHa: number;
  umurTanamanTahun: number;
  tier: RiskTier;
  tierLabel: string;
  tierBadge: string;
  color: string;
  produksiAktualTon: number;
  targetProduksiTon: number;
  yieldTonPerHa: number;
  targetYieldTonPerHa: number;
  capaianPct: number;
  perubahanProduksiPct: number;
  ndvi: number;
  evi: number;
  curahHujanMm: number;
  curahHujanDiffPct: number;
  soilMoisture: number;
  statusHara: 'optimal' | 'normal' | 'rendah' | 'kritis';
  hariSejakRawat: number;
  aktivitasTerakhir: string;
  tanggalAktivitasTerakhir: string;
  problemSummary: string;
  problemBullets: string[];
  rcaFactors: RcaFactor[];
  recommendations: string[];
}

export const RISK_TIER_META: Record<
  RiskTier,
  {
    label: string;
    shortLabel: string;
    badge: string;
    color: string;
    bgHex: string;
    rangeText: string;
  }
> = {
  normal: {
    label: 'Normal (Optimal)',
    shortLabel: 'Normal',
    badge: 'Normal',
    color: '#10B981',
    bgHex: '#064E3B',
    rangeText: 'Normal (≥ 0.75 / ≥ 85%)',
  },
  moderate: {
    label: 'Moderate (Waspada)',
    shortLabel: 'Moderate',
    badge: 'Moderate',
    color: '#EAB308',
    bgHex: '#713F12',
    rangeText: 'Moderate (0.65 – 0.74 / 70–84%)',
  },
  high: {
    label: 'High Risk (Perhatian)',
    shortLabel: 'High',
    badge: 'High Risk',
    color: '#F97316',
    bgHex: '#7C2D12',
    rangeText: 'High (0.55 – 0.64 / 55–69%)',
  },
  critical: {
    label: 'Critical (Kritis)',
    shortLabel: 'Critical',
    badge: 'Critical',
    color: '#EF4444',
    bgHex: '#7F1D1D',
    rangeText: 'Critical (< 0.55 / < 55%)',
  },
};

/**
 * Menganalisis 1 fitur poligon blok secara menyeluruh untuk menentukan:
 * - Tingkat Risiko 4 Warna (Normal, Moderate, High, Critical)
 * - Indikasi Masalah & Diagnosis Lengkap (untuk Pop-up Peta Oranye/Merah & Tabel Top Blok)
 * - Rumus Pembobotan 5 Faktor Root Cause Analysis (Dinormalisasi menjadi 100%)
 * - Checklist Rekomendasi Tindakan Otomatis
 */
export function analyzeBlockRiskAndRca(
  featId: number,
  props: Record<string, unknown>,
  ctx: {
    layerName?: string | null;
    perusahaan?: string | null;
    namaKebun?: string | null;
    wilayah?: string | null;
    komoditas?: string | null;
    macroCurahHujanMm?: number | null;
    macroStatusHara?: string | null;
    macroNdvi?: number | null;
    macroSoilMoisture?: number | null;
  } = {}
): BlockRiskDiagnosis {
  const intel = extractFeatureIntel(props, {
    featId,
    layerName: ctx.layerName,
    perusahaan: ctx.perusahaan,
    namaKebun: ctx.namaKebun,
    wilayah: ctx.wilayah,
    komoditas: ctx.komoditas,
  });

  const luasHa = Math.max(0.1, intel.luasUkurHa || 1.5);
  const targetYieldTonPerHa = intel.commodity.yieldPerHa > 0 ? intel.commodity.yieldPerHa : 25.4;
  const targetProduksiTon =
    intel.estimasiPanenTon > 0
      ? intel.estimasiPanenTon
      : Number((luasHa * targetYieldTonPerHa).toFixed(2));

  // Tahun Tanam & Umur Tanaman
  const rawTt = parseNumericHa(props.tahun_tanam ?? props.TT ?? props.tt);
  const tahunTanam = rawTt && rawTt >= 1970 && rawTt <= 2026 ? Math.round(rawTt) : 2017;
  const umurTanamanTahun = Math.max(1, 2026 - tahunTanam);

  // Interval Hari Sejak Aktivitas / Petik Terakhir
  let hariSejakRawat = parseNumericHa(props.hari_sejak_rawat) ?? null;
  const tglAktStr = String(props.tanggal_aktivitas_terakhir || '').trim();
  if (hariSejakRawat === null && tglAktStr) {
    const parsedDate = Date.parse(tglAktStr);
    if (!Number.isNaN(parsedDate)) {
      hariSejakRawat = Math.max(0, Math.round((Date.now() - parsedDate) / 86400000));
    }
  }
  if (hariSejakRawat === null) {
    hariSejakRawat = 6;
  }

  // Status Manual Mandor & Kondisi Tanaman
  const risikoManual = String(props.status_risiko_manual || '').toLowerCase();
  const kondisiTanaman = String(props.kondisi_tanaman || 'sehat').toLowerCase();
  const kendalaAktif = String(props.kendala_aktif || '').trim();

  // Parameter Makro & Iklim (dari atribut blok atau fallback ke input Kepala Kebun)
  const curahHujanMm =
    parseNumericHa(props.curah_hujan_mm) ??
    (typeof ctx.macroCurahHujanMm === 'number' ? ctx.macroCurahHujanMm : 145);
  const curahHujanNormal = 150;
  const curahHujanDiffPct = Math.round(((curahHujanMm - curahHujanNormal) / curahHujanNormal) * 100);

  const rawHara = String(props.status_hara || ctx.macroStatusHara || 'normal').toLowerCase();
  const statusHara: 'optimal' | 'normal' | 'rendah' | 'kritis' =
    rawHara === 'kritis'
      ? 'kritis'
      : rawHara === 'rendah'
      ? 'rendah'
      : rawHara === 'optimal'
      ? 'optimal'
      : 'normal';

  const ndvi =
    parseNumericHa(props.ndvi) ??
    (typeof ctx.macroNdvi === 'number'
      ? ctx.macroNdvi
      : risikoManual === 'kritis' || kondisiTanaman === 'hama_berat'
      ? 0.51
      : risikoManual === 'tinggi' || kondisiTanaman === 'kekeringan'
      ? 0.59
      : risikoManual === 'waspada' || kondisiTanaman === 'hama_ringan'
      ? 0.68
      : 0.76);
  const evi = Number(Math.max(0.35, ndvi - 0.04).toFixed(2));

  const soilMoisture =
    parseNumericHa(props.soil_moisture) ??
    (typeof ctx.macroSoilMoisture === 'number'
      ? ctx.macroSoilMoisture
      : curahHujanMm < 100
      ? 0.22
      : 0.29);

  // Capaian Produksi (%)
  const explicitCapaian = parseNumericHa(props.capaian_produksi_pct);
  const capaianPct =
    explicitCapaian !== null
      ? explicitCapaian
      : risikoManual === 'kritis'
      ? 52
      : risikoManual === 'tinggi'
      ? 64
      : risikoManual === 'waspada'
      ? 78
      : 96;

  const produksiAktualTon = Number(((targetProduksiTon * capaianPct) / 100).toFixed(2));
  const yieldTonPerHa = Number((produksiAktualTon / luasHa).toFixed(1));
  const perubahanProduksiPct = Number((capaianPct - 100).toFixed(1));

  // Penentuan Tingkat Risiko 4 Warna (Normal / Moderate / High / Critical)
  let tier: RiskTier = 'normal';
  if (
    risikoManual === 'kritis' ||
    kondisiTanaman === 'hama_berat' ||
    capaianPct < 55 ||
    ndvi < 0.55 ||
    hariSejakRawat >= 18 ||
    Boolean(kendalaAktif && /darurat|kritis/i.test(kendalaAktif))
  ) {
    tier = 'critical';
  } else if (
    risikoManual === 'tinggi' ||
    kondisiTanaman === 'kekeringan' ||
    kondisiTanaman === 'tergenang' ||
    capaianPct < 70 ||
    ndvi < 0.65 ||
    hariSejakRawat > 14 ||
    statusHara === 'kritis'
  ) {
    tier = 'high';
  } else if (
    risikoManual === 'waspada' ||
    kondisiTanaman === 'hama_ringan' ||
    capaianPct < 85 ||
    ndvi < 0.75 ||
    hariSejakRawat >= 10 ||
    statusHara === 'rendah'
  ) {
    tier = 'moderate';
  } else {
    tier = 'normal';
  }

  // =========================================================================
  // RUMUS PEMBOBOTAN 5 FAKTOR ROOT CAUSE ANALYSIS (DINORMALISASI MENJADI 100%)
  // =========================================================================
  // 1. Faktor Defisit Air & Curah Hujan
  let scoreAir = 10;
  if (curahHujanMm < 90 || soilMoisture < 0.22 || kondisiTanaman === 'kekeringan') scoreAir = 46;
  else if (curahHujanMm < 120 || soilMoisture < 0.26 || kondisiTanaman === 'tergenang') scoreAir = 32;
  else if (curahHujanMm < 140) scoreAir = 18;

  // 2. Faktor Status Hara (N, P, K) & Pemupukan
  let scoreHara = 10;
  if (statusHara === 'kritis') scoreHara = 38;
  else if (statusHara === 'rendah') scoreHara = 30;
  else if (statusHara === 'normal') scoreHara = 16;

  // 3. Faktor Status Vegetasi (NDVI) & Serangan Hama/Penyakit
  let scoreVegetasi = 10;
  if (kondisiTanaman === 'hama_berat' || ndvi < 0.55) scoreVegetasi = 42;
  else if (kondisiTanaman === 'hama_ringan' || ndvi < 0.65) scoreVegetasi = 26;
  else if (ndvi < 0.74) scoreVegetasi = 16;

  // 4. Faktor Rotasi Panen / Keterlambatan Pusingan Petik & Perawatan
  let scoreRotasi = 8;
  if (hariSejakRawat > 14) scoreRotasi = 28;
  else if (hariSejakRawat >= 10) scoreRotasi = 18;

  // 5. Faktor Umur Tanaman (Vigor Alami)
  let scoreUmur = 8;
  if (umurTanamanTahun >= 20) scoreUmur = 22;
  else if (umurTanamanTahun >= 12) scoreUmur = 14;
  else scoreUmur = 10;

  const rawTotal = scoreAir + scoreHara + scoreVegetasi + scoreRotasi + scoreUmur;
  const pctAir = Math.round((scoreAir / rawTotal) * 100);
  const pctHara = Math.round((scoreHara / rawTotal) * 100);
  const pctVegetasi = Math.round((scoreVegetasi / rawTotal) * 100);
  const pctRotasi = Math.round((scoreRotasi / rawTotal) * 100);
  const pctUmur = Math.max(1, 100 - (pctAir + pctHara + pctVegetasi + pctRotasi));

  const rcaFactors: RcaFactor[] = [
    {
      key: 'air' as const,
      label: 'Defisit air (curah hujan & kelembaban rendah)',
      percentage: pctAir,
      color: '#EF4444',
      detail: `Curah hujan ${curahHujanMm} mm (${curahHujanDiffPct}% vs normal), Soil Moisture ${soilMoisture.toFixed(2)} m³/m³`,
    },
    {
      key: 'hara' as const,
      label: 'Status hara (N, K) rendah / jadwal pupuk',
      percentage: pctHara,
      color: '#F59E0B',
      detail: `Status hara laboratorium: ${statusHara.toUpperCase()}`,
    },
    {
      key: 'vegetasi' as const,
      label: 'Status vegetasi (NDVI menurun & gangguan hama)',
      percentage: pctVegetasi,
      color: '#EAB308',
      detail: `Indeks NDVI ${ndvi.toFixed(2)} (EVI ${evi.toFixed(2)}), Kondisi: ${kondisiTanaman.replace('_', ' ')}`,
    },
    {
      key: 'rotasi' as const,
      label: 'Interval rotasi panen / pusingan petik',
      percentage: pctRotasi,
      color: '#10B981',
      detail: `Interval ${hariSejakRawat} hari sejak aktivitas perawatan/panen terakhir`,
    },
    {
      key: 'umur' as const,
      label: `Faktor tren vigor & umur tanaman (${umurTanamanTahun} thn)`,
      percentage: pctUmur,
      color: '#34D399',
      detail: `Tahun tanam ${tahunTanam} (${umurTanamanTahun} tahun)`,
    },
  ].sort((a, b) => b.percentage - a.percentage);

  // =========================================================================
  // DIAGNOSIS MASALAH SPESIFIK BERDASARKAN WARNA BLOK (UNTUK POP-UP & TABEL)
  // =========================================================================
  const problemBullets: string[] = [];
  if (perubahanProduksiPct < -10) {
    problemBullets.push(
      `Penurunan produktivitas ${perubahanProduksiPct}% di bawah target (${yieldTonPerHa} vs ${targetYieldTonPerHa} ton/ha).`
    );
  }
  if (hariSejakRawat > 14) {
    problemBullets.push(
      `Keterlambatan rotasi petik/perawatan: sudah ${hariSejakRawat} hari belum dilakukan tindakan (batas normal ≤ 14 hari).`
    );
  } else if (hariSejakRawat >= 10) {
    problemBullets.push(`Rotasi petik memasuki hari ke-${hariSejakRawat} (mendekati batas maksimum 14 hari).`);
  }
  if (curahHujanMm < 110 || kondisiTanaman === 'kekeringan') {
    problemBullets.push(
      `Defisit pasokan air: curah hujan ${curahHujanMm} mm (${curahHujanDiffPct}%) dan kelembaban tanah rendah (${soilMoisture.toFixed(2)} m³/m³).`
    );
  }
  if (statusHara === 'kritis' || statusHara === 'rendah') {
    problemBullets.push(`Defisit unsur hara makro (N, K) berstatus ${statusHara.toUpperCase()} berdasarkan evaluasi kebun.`);
  }
  if (kondisiTanaman === 'hama_berat') {
    problemBullets.push('Serangan hama/penyakit intensitas berat (Helopeltis / Cacar Daun) menurunkan kerapatan tajuk.');
  } else if (kondisiTanaman === 'hama_ringan') {
    problemBullets.push('Indikasi awal gangguan hama ringan dan pertumbuhan gulma pada piringan tanaman.');
  }
  if (kendalaAktif) {
    problemBullets.push(`Laporan Kendala Aktif: ${kendalaAktif}.`);
  }
  if (problemBullets.length === 0) {
    problemBullets.push('Kondisi agronomi blok stabil, vigor tanaman sehat, dan capaian panen sesuai rencana kerja.');
  }

  const problemSummary =
    String(props.indikasi_masalah || '').trim() ||
    (tier === 'critical'
      ? 'Stres vegetasi, defisit air, indikasi hara rendah & keterlambatan rotasi.'
      : tier === 'high'
      ? 'Penurunan vigor tanaman, kelembaban tanah rendah, efisiensi hara menurun.'
      : tier === 'moderate'
      ? 'Vegetasi sedang, rotasi perawatan mendekati batas pusingan.'
      : 'Pertumbuhan vegetasi dan capaian produksi optimal.');

  // =========================================================================
  // MESIN REKOMENDASI TINDAKAN OTOMATIS (RULE-BASED AGRONOMY ENGINE)
  // =========================================================================
  const recommendations: string[] = [];
  if (tier === 'critical' || tier === 'high') {
    recommendations.push('Lakukan inspeksi lapangan prioritas dan verifikasi fisik kondisi tanaman bersama Asisten Kebun.');
  }
  if (scoreAir >= 25) {
    recommendations.push('Evaluasi dan perbaiki manajemen air (pembersihan rorak, saluran drainase, atau suplai irigasi).');
  }
  if (scoreHara >= 20) {
    recommendations.push('Lakukan pemupukan korektif (utama N dan K / NPK) sesuai dosis rekomendasi hasil analisis tanah & daun.');
  }
  if (kondisiTanaman === 'hama_berat' || kondisiTanaman === 'hama_ringan') {
    recommendations.push('Jadwalkan penyemprotan pengendalian hama/penyakit terfokus (Helopeltis / Cacar Daun) dan sanitasi gulma.');
  }
  if (hariSejakRawat > 12) {
    recommendations.push(`Tambahkan alokasi tenaga kerja (HK) untuk segera menuntaskan rotasi petik/panen (tercatat H-${hariSejakRawat}).`);
  }
  recommendations.push('Monitoring ulang indeks vegetasi (NDVI) dan evaluasi realisasi produksi dalam 1 bulan.');

  const tierMeta = RISK_TIER_META[tier];

  return {
    featId,
    blokName: intel.blokName,
    afdelingName: intel.afdelingGroup || 'Afdeling Utama',
    komoditas: intel.commodity.label,
    luasHa,
    umurTanamanTahun,
    tier,
    tierLabel: tierMeta.label,
    tierBadge: tierMeta.badge,
    color: tierMeta.color,
    produksiAktualTon,
    targetProduksiTon,
    yieldTonPerHa,
    targetYieldTonPerHa,
    capaianPct,
    perubahanProduksiPct,
    ndvi: Number(ndvi.toFixed(2)),
    evi,
    curahHujanMm,
    curahHujanDiffPct,
    soilMoisture: Number(soilMoisture.toFixed(2)),
    statusHara,
    hariSejakRawat,
    aktivitasTerakhir: String(props.aktivitas_terakhir || 'Pemeliharaan Rutin'),
    tanggalAktivitasTerakhir: tglAktStr || '2026-11-20',
    problemSummary,
    problemBullets,
    rcaFactors,
    recommendations: recommendations.slice(0, 4),
  };
}
