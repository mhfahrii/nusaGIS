/**
 * Mesin Ekstraksi Multi-Kolom Universal & Analitik Agronomi Perkebunan
 *
 * Menyatukan pembacaan atribut dari berbagai standar Shapefile/DBF/KML/GeoJSON:
 * - Kebun Bakalan (Pasuruan): Name, luas, PopupInfo (Luas Baku, Status Lahan, Varietas PSKA 942, MT 08/24)
 * - Kebun Sarongge (Cianjur): nama_unit, Block, nama_kebun, Luas (baku), Luas1 (ukur GIS), klaster A/B/C/Kebun Rakyat
 * - Kebun Cibeureum (Bandung): Batas Konsesi tunggal (Shape_Leng, Shape_Area, Luas)
 * - Format umum ArcGIS / QGIS / PostGIS lainnya
 */

export interface CommodityProfile {
  key: 'tebu' | 'teh' | 'sawit' | 'agribisnis';
  label: string;
  shortLabel: string;
  yieldPerHa: number;
  yieldUnit: string;
  rendemenPct: number | null;
  processedLabel: string | null;
  processedUnit: string | null;
  effectivePlantableRatio: number;
  standardSource: string;
}

export interface ExtractedFeatureIntel {
  blokName: string;
  shortName: string;
  afdelingGroup: string | null;
  afdelingColor: string;
  luasUkurHa: number;
  luasUkurSource: string;
  luasBakuHa: number | null;
  luasBakuSource: string | null;
  selisihHa: number | null;
  selisihPct: number | null;
  auditStatus: 'sesuai' | 'lebih' | 'kurang' | null;
  kelilingKm: number;
  statusLahan: string;
  tanaman: string;
  varietas: string;
  mt: string;
  mtFormatted: string;
  luasTanamHa: number | null;
  jumlahPohon: number | null;
  commodity: CommodityProfile;
  estimasiPanenTon: number;
  estimasiOlahanTon: number | null;
  popupMap: Record<string, string>;
}

export interface ExtractContext {
  featId?: number;
  geomLuasHa?: number | null;
  geomKelilingKm?: number | null;
  layerName?: string | null;
  namaKebun?: string | null;
  wilayah?: string | null;
  komoditas?: string | null;
  isSingleBoundaryLayer?: boolean;
}

const BULAN_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export const AFDELING_COLOR_MAP: Record<string, string> = {
  'Afdeling A': '#00D2FF',
  'Afdeling A (Rayon A)': '#00D2FF',
  'Afdeling B': '#10B981',
  'Afdeling B (Rayon B)': '#10B981',
  'Afdeling C': '#F59E0B',
  'Afdeling C (Rayon C)': '#F59E0B',
  'Afdeling D': '#A78BFA',
  'Kebun Rakyat': '#EC4899',
};

export function isMeaningfulValue(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  const s = String(val).trim();
  if (
    s === '' ||
    s === '-' ||
    s === '--' ||
    s.toLowerCase() === 'null' ||
    s.toLowerCase() === 'none' ||
    s.toLowerCase() === 'undefined'
  ) {
    return false;
  }
  return true;
}

/** Parsing PopupInfo multiline format ArcGIS / KMZ ("Kunci : Nilai") */
export function parsePopupInfo(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'string' || !raw.trim()) return out;
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (k && isMeaningfulValue(v)) {
      out[k] = v;
    }
  }
  return out;
}

/** Parsing angka format Indonesia / internasional ("2,31 Ha" -> 2.31) */
export function parseNumericHa(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (!isMeaningfulValue(raw)) return null;
  const str = String(raw).replace(/\s/g, '');
  const m = str.match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Format kode Masa Tanam ("08/24" -> "Agustus 2024") */
export function formatMasaTanam(mt: string): string {
  const clean = mt.trim();
  if (!clean) return '';
  const m = clean.match(/^(\d{1,2})\s*\/\s*(\d{2,4})$/);
  if (!m) return clean;
  const bulan = BULAN_ID[parseInt(m[1], 10) - 1];
  const tahun = m[2].length === 2 ? `20${m[2]}` : m[2];
  return bulan ? `${bulan} ${tahun}` : clean;
}

/** Ambil nilai string pertama yang valid dari kombinasi props DBF & PopupInfo */
function pickAttr(
  props: Record<string, unknown>,
  popup: Record<string, string>,
  keys: string[]
): string {
  const lowerMap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    lowerMap[k.toLowerCase()] = v;
  }
  for (const k of keys) {
    const direct = props[k] ?? lowerMap[k.toLowerCase()] ?? popup[k.toLowerCase()];
    if (isMeaningfulValue(direct)) {
      return String(direct).trim();
    }
  }
  return '';
}

/**
 * Deteksi Profil Komoditas & Standar Produktivitas Agronomi
 */
export function detectCommodityProfile(ctx: {
  tanaman?: string;
  varietas?: string;
  statusLahan?: string;
  komoditas?: string | null;
  namaKebun?: string | null;
  wilayah?: string | null;
  layerName?: string | null;
}): CommodityProfile {
  const combined = [
    ctx.tanaman,
    ctx.varietas,
    ctx.statusLahan,
    ctx.komoditas,
    ctx.namaKebun,
    ctx.wilayah,
    ctx.layerName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // 1. Tebu (Pasuruan / Kebun Bakalan / Varietas PSKA / KTG / KS GPA)
  if (
    combined.includes('tebu') ||
    combined.includes('pska') ||
    combined.includes('ktg') ||
    combined.includes('gpa') ||
    combined.includes('bakalan') ||
    combined.includes('pasuruan')
  ) {
    return {
      key: 'tebu',
      label: ctx.varietas ? `Tebu (${ctx.varietas})` : 'Tebu (KTG / KS GPA)',
      shortLabel: 'Tebu',
      yieldPerHa: 85, // Standar PTPN / P3GI: 80-90 Ton Tebu / Ha
      yieldUnit: 'Ton Tebu',
      rendemenPct: 7.5, // Standar Rendemen Gula ~7.5%
      processedLabel: 'Proyeksi Gula (7,5%)',
      processedUnit: 'Ton Gula',
      effectivePlantableRatio: 0.85,
      standardSource: 'Standar PTPN / P3GI (85 Ton/Ha · Rendemen 7,5%)',
    };
  }

  // 2. Teh Dataran Tinggi / Agribisnis (Cianjur / Sarongge, Bandung / Cibeureum / Pangalengan)
  if (
    combined.includes('teh') ||
    combined.includes('sarongge') ||
    combined.includes('cibeureum') ||
    combined.includes('cibereum') ||
    combined.includes('pangalengan') ||
    combined.includes('cianjur') ||
    combined.includes('bandung') ||
    combined.includes('pacet') ||
    combined.includes('gedeh')
  ) {
    return {
      key: 'teh',
      label: 'Teh Dataran Tinggi / Agribisnis',
      shortLabel: 'Teh / Agribisnis',
      yieldPerHa: 10.0, // Standar PTPN Jabar: ~10 Ton Pucuk Teh Basah / Ha / Tahun
      yieldUnit: 'Ton Pucuk Basah',
      rendemenPct: 23.0, // Rasio olah daun basah -> teh kering ~23% (~2,3 Ton Teh Kering/Ha/Thn)
      processedLabel: 'Teh Kering (23%)',
      processedUnit: 'Ton Teh Kering',
      effectivePlantableRatio: 0.85,
      standardSource: 'Standar PTPN Jabar (10 Ton Pucuk/Ha/Thn · 23% Kering)',
    };
  }

  // 3. Kelapa Sawit
  if (combined.includes('sawit') || combined.includes('tbs') || combined.includes('cpo')) {
    return {
      key: 'sawit',
      label: 'Kelapa Sawit',
      shortLabel: 'Kelapa Sawit',
      yieldPerHa: 20.0,
      yieldUnit: 'Ton TBS',
      rendemenPct: 22.0,
      processedLabel: 'Proyeksi CPO (22%)',
      processedUnit: 'Ton CPO',
      effectivePlantableRatio: 0.85,
      standardSource: 'Standar PTPN (20 Ton TBS/Ha/Thn · OER 22%)',
    };
  }

  // 4. Agribisnis Umum
  return {
    key: 'agribisnis',
    label: ctx.komoditas?.trim() || 'Agribisnis Perkebunan',
    shortLabel: 'Agribisnis',
    yieldPerHa: 12.0,
    yieldUnit: 'Ton Hasil',
    rendemenPct: null,
    processedLabel: null,
    processedUnit: null,
    effectivePlantableRatio: 0.85,
    standardSource: 'Estimasi Standar Agribisnis (12 Ton/Ha/Thn)',
  };
}

/**
 * Deteksi Otomatis Afdeling / Klaster Blok dari atribut DBF maupun pola kode blok (A1-A4, B1-B4, C1-C4, GPA 1-8)
 */
export function detectAfdelingGroup(
  props: Record<string, unknown>,
  popup: Record<string, string>,
  blokName: string
): { group: string | null; color: string } {
  // 1. Cek atribut eksplisit
  const explicit = pickAttr(props, popup, ['afdeling', 'nama_afdeling', 'rayon', 'divisi']);
  if (explicit) {
    const color = AFDELING_COLOR_MAP[explicit] || '#00D2FF';
    return { group: explicit, color };
  }

  const clean = blokName.trim();
  const lower = clean.toLowerCase();

  // 2. Kebun Rakyat (Sarongge)
  if (lower.includes('kebun rakyat') || lower.includes('rakyat')) {
    return { group: 'Kebun Rakyat', color: AFDELING_COLOR_MAP['Kebun Rakyat'] };
  }

  // 3. Pola kode blok klaster Sarongge & standar perkebunan: A1..A9, B1..B9, C1..C9, D1..D9
  const letterMatch = clean.match(/^(?:blok\s*)?([ABCD])\s*[-_.]?\s*\d+\b/i);
  if (letterMatch) {
    const letter = letterMatch[1].toUpperCase();
    const label = `Afdeling ${letter}`;
    return { group: label, color: AFDELING_COLOR_MAP[label] || '#00D2FF' };
  }

  // 4. Pola Rayon Kebun Bakalan (Bakalan A / GPA 1-3 -> Afdeling A, Bakalan B / GPA 4-6 -> Afdeling B, Bakalan C / GPA 7-8 -> Afdeling C)
  if (/\bbakalan\s*a\b/i.test(lower) || /\bgpa\s*[1-3]\b/i.test(lower)) {
    return { group: 'Afdeling A (Rayon A)', color: AFDELING_COLOR_MAP['Afdeling A (Rayon A)'] };
  }
  if (/\bbakalan\s*b\b/i.test(lower) || /\bgpa\s*[4-6]\b/i.test(lower)) {
    return { group: 'Afdeling B (Rayon B)', color: AFDELING_COLOR_MAP['Afdeling B (Rayon B)'] };
  }
  if (/\bbakalan\s*c\b/i.test(lower) || /\bgpa\s*[7-9]\b/i.test(lower)) {
    return { group: 'Afdeling C (Rayon C)', color: AFDELING_COLOR_MAP['Afdeling C (Rayon C)'] };
  }

  return { group: null, color: '#64748B' };
}

/**
 * Mesin Ekstraksi Utama: Memeras 100% informasi dari satu fitur poligon/atribut DBF + PostGIS
 */
export function extractFeatureIntel(
  props: Record<string, unknown>,
  ctx: ExtractContext = {}
): ExtractedFeatureIntel {
  const popup = parsePopupInfo(props.PopupInfo ?? props.popupinfo);
  const featId = ctx.featId ?? Number(props._feature_id ?? props.id ?? 0);

  // 1. Nama Blok Universal (mendukung Name, nama_blok, nama_unit, Block, kode_blok, Label, nama_kebun)
  const rawBlokAttr = pickAttr(props, popup, [
    'Name',
    'nama_blok',
    'nama_unit',
    'Block',
    'kode_blok',
    'no_blok',
    'Blok',
    '_label',
  ]);

  let blokName = rawBlokAttr.replace(/;\s*[0-9.,]+\s*Ha\s*$/i, '').trim();
  if (!blokName) {
    if (ctx.isSingleBoundaryLayer) {
      blokName =
        ctx.namaKebun ||
        pickAttr(props, popup, ['nama_kebun', 'Label']) ||
        ctx.layerName ||
        `Batas Konsesi #${featId}`;
    } else {
      const fallbackKebun = pickAttr(props, popup, ['nama_kebun', 'Label']);
      blokName = fallbackKebun
        ? `Petak ${fallbackKebun} #${featId}`
        : `Blok #${featId || 1}`;
    }
  }

  const shortName = blokName.split(' (')[0].slice(0, 14);

  // 2. Luas Ukur GIS vs Luas Baku Dokumen (Cerdas: deteksi pola Sarongge Luas1 vs Luas, Bakalan luas vs PopupInfo, Cibeureum Shape_Area)
  const luas1Val = parseNumericHa(props.Luas1 ?? props.LUAS1 ?? props.luas1 ?? props.luas_ukur);
  const luasPrimaryVal = parseNumericHa(
    props.luas ?? props.Luas ?? props.LUAS ?? props.luas_ha ?? props.LUAS_HA
  );
  const geomLuas =
    typeof ctx.geomLuasHa === 'number' && Number.isFinite(ctx.geomLuasHa) && ctx.geomLuasHa > 0
      ? ctx.geomLuasHa
      : parseNumericHa(props._luas_geodesik_ha) || 0;

  // Shape_Area fallback (jika > 100 berarti satuan m² UTM -> konversi ke Ha)
  const rawShapeArea = parseNumericHa(props.Shape_Area ?? props.shape_area);
  const shapeAreaHa =
    rawShapeArea && rawShapeArea > 100 ? rawShapeArea / 10000 : null;

  let luasUkurHa = 0;
  let luasUkurSource = 'PostGIS Geodesik';

  if (luas1Val !== null && luas1Val > 0) {
    luasUkurHa = luas1Val;
    luasUkurSource = 'Kolom Luas1 (.dbf)';
  } else if (luasPrimaryVal !== null && luasPrimaryVal > 0) {
    luasUkurHa = luasPrimaryVal;
    luasUkurSource = 'Kolom Luas (.dbf)';
  } else if (geomLuas > 0) {
    luasUkurHa = geomLuas;
    luasUkurSource = 'PostGIS Geodesik';
  } else if (shapeAreaHa && shapeAreaHa > 0) {
    luasUkurHa = shapeAreaHa;
    luasUkurSource = 'Shape_Area (m² → Ha)';
  }

  // Luas Baku Dokumen
  const explicitBakuStr = pickAttr(props, popup, ['Luas Baku', 'luas_baku', 'luasbaku']);
  let luasBakuHa = parseNumericHa(explicitBakuStr);
  let luasBakuSource: string | null = luasBakuHa ? 'Dokumen / PopupInfo' : null;

  // Pola Kebun Sarongge: jika ada Luas1 (desimal GIS) DAN Luas (angka baku legal > 0), maka Luas = Luas Baku!
  if (
    luasBakuHa === null &&
    luas1Val !== null &&
    luas1Val > 0 &&
    luasPrimaryVal !== null &&
    luasPrimaryVal > 0
  ) {
    luasBakuHa = luasPrimaryVal;
    luasBakuSource = 'Kolom Luas Baku (.dbf)';
  }

  // 3. Audit Selisih Luas (Ukur GIS vs Baku Legal)
  let selisihHa: number | null = null;
  let selisihPct: number | null = null;
  let auditStatus: 'sesuai' | 'lebih' | 'kurang' | null = null;

  if (luasBakuHa !== null && luasBakuHa > 0 && luasUkurHa > 0) {
    selisihHa = Number((luasUkurHa - luasBakuHa).toFixed(2));
    selisihPct = Number(((selisihHa / luasBakuHa) * 100).toFixed(1));
    if (Math.abs(selisihPct) <= 3.0) {
      auditStatus = 'sesuai';
    } else if (selisihPct > 3.0) {
      auditStatus = 'lebih';
    } else {
      auditStatus = 'kurang';
    }
  }

  // 4. Keliling Batas (km) — PostGIS atau Shape_Leng (meter -> km)
  let kelilingKm =
    typeof ctx.geomKelilingKm === 'number' && Number.isFinite(ctx.geomKelilingKm) && ctx.geomKelilingKm > 0
      ? ctx.geomKelilingKm
      : 0;
  if (kelilingKm === 0) {
    const rawShapeLeng = parseNumericHa(props.Shape_Leng ?? props.shape_leng);
    if (rawShapeLeng && rawShapeLeng > 10) {
      kelilingKm = Number((rawShapeLeng / 1000).toFixed(3));
    }
  }

  // 5. Atribut Agronomi & Budidaya
  const statusLahan = pickAttr(props, popup, ['Status Lahan', 'status_lahan', 'status']);
  const tanaman = pickAttr(props, popup, ['Tanaman', 'tanaman', 'komoditas']);
  const varietas = pickAttr(props, popup, ['Varietas', 'varietas']);
  const mt = pickAttr(props, popup, ['MT', 'mt', 'masa_tanam']);
  const mtFormatted = formatMasaTanam(mt);
  const luasTanamHa = parseNumericHa(pickAttr(props, popup, ['Luas Tanam', 'luas_tanam']));
  const jumlahPohon = parseNumericHa(
    pickAttr(props, popup, ['jml_pohon', 'jumlah_pohon', 'pokok'])
  );

  // 6. Deteksi Afdeling / Klaster Blok
  const { group: afdelingGroup, color: afdelingColor } = detectAfdelingGroup(
    props,
    popup,
    blokName
  );

  // 7. Deteksi Komoditas & Estimasi Produksi Otomatis
  const commodity = detectCommodityProfile({
    tanaman,
    varietas,
    statusLahan,
    komoditas: ctx.komoditas,
    namaKebun: ctx.namaKebun || pickAttr(props, popup, ['nama_kebun']),
    wilayah: ctx.wilayah,
    layerName: ctx.layerName,
  });

  // Basis luas produksi: gunakan luas tanam jika tercatat, atau luas ukur efektif (85% jika batas konsesi luar, 100% jika petak blok)
  const effectiveAreaHa =
    luasTanamHa && luasTanamHa > 0
      ? luasTanamHa
      : ctx.isSingleBoundaryLayer
      ? luasUkurHa * commodity.effectivePlantableRatio
      : luasUkurHa;

  const estimasiPanenTon = Number((effectiveAreaHa * commodity.yieldPerHa).toFixed(2));
  const estimasiOlahanTon =
    commodity.rendemenPct !== null
      ? Number(((estimasiPanenTon * commodity.rendemenPct) / 100).toFixed(2))
      : null;

  return {
    blokName,
    shortName,
    afdelingGroup,
    afdelingColor,
    luasUkurHa: Number(luasUkurHa.toFixed(2)),
    luasUkurSource,
    luasBakuHa: luasBakuHa !== null ? Number(luasBakuHa.toFixed(2)) : null,
    luasBakuSource,
    selisihHa,
    selisihPct,
    auditStatus,
    kelilingKm: Number(kelilingKm.toFixed(3)),
    statusLahan,
    tanaman,
    varietas,
    mt,
    mtFormatted,
    luasTanamHa,
    jumlahPohon: jumlahPohon ? Math.round(jumlahPohon) : null,
    commodity,
    estimasiPanenTon,
    estimasiOlahanTon,
    popupMap: popup,
  };
}
