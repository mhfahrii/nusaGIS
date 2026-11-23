/**
 * Mesin Ekstraksi Multi-Kolom Universal & Analitik Agronomi Perkebunan
 *
 * Menyatukan pembacaan atribut dari berbagai standar Shapefile/DBF/KML/GeoJSON:
 * - Kebun Bakalan (Pasuruan): Name, luas, PopupInfo (Luas Baku, Status Lahan, Varietas PSKA 942, MT 08/24)
 * - Kebun Sarongge (Cianjur): nama_unit, Block, nama_kebun, Luas (baku), Luas1 (ukur GIS), klaster A/B/C
 * - Kebun Cibeureum (Bandung): Batas Konsesi tunggal (Shape_Leng, Shape_Area, Luas)
 * - Peta Kebun Sei Aek Pancur (Deli Serdang): TT (tahun tanam / komoditas petak), area, luas_ha
 * - Format umum ArcGIS / QGIS / PostGIS lainnya
 */

import { findRpnEntity } from './rpnEntities';

export type CommodityKey =
  | 'tebu'
  | 'teh'
  | 'kina'
  | 'sawit'
  | 'kopi'
  | 'kakao'
  | 'karet'
  | 'belum_ditentukan';

export interface CommodityProfile {
  key: CommodityKey;
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

export const COMMODITY_PROFILES: Record<CommodityKey, CommodityProfile> = {
  tebu: {
    key: 'tebu',
    label: 'Tebu',
    shortLabel: 'Tebu',
    yieldPerHa: 85,
    yieldUnit: 'Ton Tebu',
    rendemenPct: 7.5,
    processedLabel: 'Proyeksi Gula (7,5%)',
    processedUnit: 'Ton Gula',
    effectivePlantableRatio: 0.85,
    standardSource: 'Standar P3GI (85 Ton/Ha · Rendemen 7,5%)',
  },
  teh: {
    key: 'teh',
    label: 'Teh',
    shortLabel: 'Teh',
    yieldPerHa: 10.0,
    yieldUnit: 'Ton Pucuk Basah',
    rendemenPct: 23.0,
    processedLabel: 'Teh Kering (23%)',
    processedUnit: 'Ton Teh Kering',
    effectivePlantableRatio: 0.85,
    standardSource: 'Standar PPTK (10 Ton Pucuk/Ha/Thn · 23% Kering)',
  },
  kina: {
    key: 'kina',
    label: 'Kina',
    shortLabel: 'Kina',
    yieldPerHa: 2.5,
    yieldUnit: 'Ton Kulit Kering',
    rendemenPct: null,
    processedLabel: null,
    processedUnit: null,
    effectivePlantableRatio: 0.85,
    standardSource: 'Standar PPTK (2,5 Ton Kulit Kering/Ha/Thn)',
  },
  sawit: {
    key: 'sawit',
    label: 'Kelapa Sawit',
    shortLabel: 'Kelapa Sawit',
    yieldPerHa: 22.0,
    yieldUnit: 'Ton TBS',
    rendemenPct: 22.0,
    processedLabel: 'Proyeksi CPO (22%)',
    processedUnit: 'Ton CPO',
    effectivePlantableRatio: 0.85,
    standardSource: 'Standar PPKS (22 Ton TBS/Ha/Thn · OER 22%)',
  },
  kopi: {
    key: 'kopi',
    label: 'Kopi',
    shortLabel: 'Kopi',
    yieldPerHa: 1.8,
    yieldUnit: 'Ton Biji Kering',
    rendemenPct: null,
    processedLabel: null,
    processedUnit: null,
    effectivePlantableRatio: 0.85,
    standardSource: 'Standar PPKKI (1,8 Ton Biji Kering/Ha/Thn)',
  },
  kakao: {
    key: 'kakao',
    label: 'Kakao',
    shortLabel: 'Kakao',
    yieldPerHa: 1.5,
    yieldUnit: 'Ton Biji Kering',
    rendemenPct: null,
    processedLabel: null,
    processedUnit: null,
    effectivePlantableRatio: 0.85,
    standardSource: 'Standar PPKKI (1,5 Ton Biji Kering/Ha/Thn)',
  },
  karet: {
    key: 'karet',
    label: 'Karet',
    shortLabel: 'Karet',
    yieldPerHa: 1.6,
    yieldUnit: 'Ton Karet Kering',
    rendemenPct: null,
    processedLabel: null,
    processedUnit: null,
    effectivePlantableRatio: 0.85,
    standardSource: 'Standar PPK (1,6 Ton KKK/Ha/Thn)',
  },
  belum_ditentukan: {
    key: 'belum_ditentukan',
    label: 'Belum ditentukan',
    shortLabel: 'Belum ditentukan',
    yieldPerHa: 0,
    yieldUnit: 'Ton Hasil',
    rendemenPct: null,
    processedLabel: null,
    processedUnit: null,
    effectivePlantableRatio: 0.85,
    standardSource: 'Komoditas belum ditentukan',
  },
};

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
  perusahaan?: string | null;
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

const AFDELING_COLOR_MAP: Record<string, string> = {
  'Afdeling A': '#00D2FF',
  'Afdeling B': '#10B981',
  'Afdeling C': '#F59E0B',
  'Afdeling D': '#A78BFA',
  'Afdeling A (Rayon A)': '#00D2FF',
  'Afdeling B (Rayon B)': '#10B981',
  'Afdeling C (Rayon C)': '#F59E0B',
  'Kebun Rakyat': '#EC4899',
};

function isMeaningfulValue(val: unknown): boolean {
  if (val === null || val === undefined) return false;
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
 * Mencocokkan teks atribut/nama kebun secara spesifik ke 1 komoditas tunggal.
 * Mengabaikan string gabungan ambigu seperti "Teh & Kina" atau "Kopi & Kakao" agar bisa diulik lebih dalam.
 */
export function matchSingleCommodityFromText(rawText?: string | null): CommodityProfile | null {
  if (!rawText || !rawText.trim()) return null;
  const text = rawText.trim().toLowerCase();

  // Abaikan jika teks berisi nama perusahaan induk RPN atau label gabungan dua komoditas
  const isAmbiguousTehKina = text.includes('teh') && text.includes('kina');
  const isAmbiguousKopiKakao = text.includes('kopi') && text.includes('kakao');

  // 1. Tebu
  if (
    /\btebu\b/.test(text) ||
    /\bpska\b/.test(text) ||
    /\bpsjk\b/.test(text) ||
    /\bbl\b/.test(text) && text.includes('varietas') ||
    /\bktg\b/.test(text) ||
    /\bks\s*gpa\b/.test(text) ||
    /\bgpa\s*[0-9]\b/.test(text) ||
    /\bsugarcane\b/.test(text) ||
    /\bbakalan\b/.test(text) ||
    /\bsragi\b/.test(text)
  ) {
    return COMMODITY_PROFILES.tebu;
  }

  // 2. Kakao vs Kopi (hanya bila tidak ambigu "Kopi & Kakao")
  if (!isAmbiguousKopiKakao) {
    if (
      /\bkakao\b/.test(text) ||
      /\bcacao\b/.test(text) ||
      /\bcocoa\b/.test(text) ||
      /\bcoklat\b/.test(text) ||
      /\bkaliwining\b/.test(text) ||
      /\bkendenglembu\b/.test(text) ||
      /\bjatirono\b/.test(text)
    ) {
      return COMMODITY_PROFILES.kakao;
    }

    if (
      /\bkopi\b/.test(text) ||
      /\bcoffee\b/.test(text) ||
      /\barabika\b/.test(text) ||
      /\barabica\b/.test(text) ||
      /\brobusta\b/.test(text) ||
      /\bandungsari\b/.test(text) ||
      /\bbelawan\b/.test(text) ||
      /\bkalisat\b/.test(text) ||
      /\bjampit\b/.test(text)
    ) {
      return COMMODITY_PROFILES.kopi;
    }
  }

  // 3. Kina vs Teh (hanya bila tidak ambigu "Teh & Kina")
  if (!isAmbiguousTehKina) {
    if (
      /\bkina\b/.test(text) ||
      /\bcinchona\b/.test(text) ||
      /\bbukit\s*tunggul\b/.test(text)
    ) {
      return COMMODITY_PROFILES.kina;
    }

    if (
      /\bteh\b/.test(text) ||
      /\btea\b/.test(text) ||
      /\bpucuk\b/.test(text) ||
      /\bgmb\s*[0-9]?\b/.test(text) ||
      /\bsarongge\b/.test(text) ||
      /\bcibeureum\b/.test(text) ||
      /\bcibereum\b/.test(text) ||
      /\bgambung\b/.test(text) ||
      /\bmalabar\b/.test(text) ||
      /\brancabali\b/.test(text) ||
      /\bsedep\b/.test(text) ||
      /\bpangalengan\b/.test(text)
    ) {
      return COMMODITY_PROFILES.teh;
    }
  }

  // 4. Kelapa Sawit
  if (
    /\bsawit\b/.test(text) ||
    /\bkelapa\s*sawit\b/.test(text) ||
    /\btbs\b/.test(text) ||
    /\bcpo\b/.test(text) ||
    /\bpembibitan\s*ks\b/.test(text) ||
    /\beks\.?\s*pks\b/.test(text) ||
    /\baek\s*pancur\b/.test(text) ||
    /\bmarihat\b/.test(text) ||
    /\boil\s*palm\b/.test(text)
  ) {
    return COMMODITY_PROFILES.sawit;
  }

  // 5. Karet
  if (
    /\bkaret\b/.test(text) ||
    /\blateks\b/.test(text) ||
    /\bhevea\b/.test(text) ||
    /\brubber\b/.test(text) ||
    /\bsembawa\b/.test(text) ||
    /\bsungai\s*putih\b/.test(text) ||
    /\bsungei\s*putih\b/.test(text) ||
    /\bgetas\b/.test(text)
  ) {
    return COMMODITY_PROFILES.karet;
  }

  return null;
}

/**
 * Deteksi Profil Komoditas dengan 3 Tingkat Prioritas:
 * 1) Data langsung dari Folder / Atribut DBF Fitur (Tanaman, Komoditas, Varietas, Status Lahan, TT, Nama Blok)
 * 2) Isian Komoditas pada Data Kebun Induk atau Identitas Spesifik Kebun/Layer (misal Sarongge -> Teh, Bakalan -> Tebu)
 * 3) Komoditas Bawaan PT / Puslit:
 *    - Single-commodity PT (P3GI -> Tebu, PPKS -> Kelapa Sawit, PPK -> Karet) langsung terisi.
 *    - Multi-commodity PT (PPTK -> Teh atau Kina, PPKKI -> Kopi atau Kakao) diulik dari konteks kebun/wilayah/atribut.
 * 4) Fallback: "Belum ditentukan" (tidak pernah menggunakan nama PT atau "Riset Perkebunan (PT RPN)" sebagai komoditas).
 */
export function detectCommodityProfile(ctx: {
  tanaman?: string;
  varietas?: string;
  statusLahan?: string;
  tt?: string;
  blokName?: string;
  komoditas?: string | null;
  perusahaan?: string | null;
  namaKebun?: string | null;
  wilayah?: string | null;
  layerName?: string | null;
}): CommodityProfile {
  // PRIORITAS 1: Data Atribut Fitur dari Folder / DBF / PopupInfo
  const folderFeatureSignal = [
    ctx.tanaman,
    ctx.varietas,
    ctx.statusLahan,
    ctx.tt,
    ctx.blokName,
  ]
    .filter(Boolean)
    .join(' ');

  const fromFolderFeature = matchSingleCommodityFromText(folderFeatureSignal);
  if (fromFolderFeature) {
    return fromFolderFeature;
  }

  // PRIORITAS 2A: Isian Komoditas Spesifik pada Master Kebun
  const fromKebunField = matchSingleCommodityFromText(ctx.komoditas);
  if (fromKebunField) {
    return fromKebunField;
  }

  // PRIORITAS 2B: Identitas Spesifik Nama Kebun & Nama Layer / File SHP
  const kebunLayerSignal = [ctx.namaKebun, ctx.layerName].filter(Boolean).join(' ');
  const fromKebunLayer = matchSingleCommodityFromText(kebunLayerSignal);
  if (fromKebunLayer) {
    return fromKebunLayer;
  }

  // PRIORITAS 3: Berdasarkan PT / Puslit yang Menaungi
  const entity =
    findRpnEntity(ctx.perusahaan) ||
    findRpnEntity(ctx.namaKebun) ||
    findRpnEntity(ctx.layerName);

  if (entity) {
    // Jika PT hanya memiliki 1 komoditas tunggal (P3GI = Tebu, PPKS = Kelapa Sawit, PPK = Karet)
    if (entity.code === 'P3GI') return COMMODITY_PROFILES.tebu;
    if (entity.code === 'PPKS') return COMMODITY_PROFILES.sawit;
    if (entity.code === 'PPK') return COMMODITY_PROFILES.karet;

    // Jika PT menaungi >1 komoditas (PPTK: Teh/Kina, PPKKI: Kopi/Kakao), ulik dari konteks wilayah & metadata
    const deepContext = [
      ctx.namaKebun,
      ctx.layerName,
      ctx.wilayah,
      ctx.komoditas,
      folderFeatureSignal,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (entity.code === 'PPTK') {
      if (/\bkina\b|\bcinchona\b|\bbukit\s*tunggul\b/.test(deepContext)) {
        return COMMODITY_PROFILES.kina;
      }
      if (
        /\bteh\b|\bsarongge\b|\bcibeureum\b|\bcibereum\b|\bgambung\b|\bcianjur\b|\bbandung\b|\bpangalengan\b|\bmalabar\b/.test(
          deepContext
        )
      ) {
        return COMMODITY_PROFILES.teh;
      }
    }

    if (entity.code === 'PPKKI') {
      if (/\bkakao\b|\bcacao\b|\bcocoa\b|\bcoklat\b|\bkaliwining\b|\bkendenglembu\b|\bjatirono\b/.test(deepContext)) {
        return COMMODITY_PROFILES.kakao;
      }
      if (/\bkopi\b|\bcoffee\b|\barabika\b|\brobusta\b|\bandungsari\b|\bbelawan\b|\bkalisat\b|\bjampit\b/.test(deepContext)) {
        return COMMODITY_PROFILES.kopi;
      }
    }
  }

  // Cek satu kali lagi jika wilayah saja sudah sangat spesifik ke kebun yang dikenal
  const fromWilayah = matchSingleCommodityFromText(ctx.wilayah);
  if (fromWilayah) {
    return fromWilayah;
  }

  // PRIORITAS 4: Fallback jujur tanpa mengarang dan tanpa memakai nama PT RPN
  return COMMODITY_PROFILES.belum_ditentukan;
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

  // 2. Pola kode blok klaster Sarongge & standar perkebunan: A1..A9, B1..B9, C1..C9, D1..D9
  const letterMatch = clean.match(/^(?:blok\s*)?([ABCD])\s*[-_.]?\s*\d+\b/i);
  if (letterMatch) {
    const letter = letterMatch[1].toUpperCase();
    const label = `Afdeling ${letter}`;
    return { group: label, color: AFDELING_COLOR_MAP[label] || '#00D2FF' };
  }

  // 3. Pola Rayon Kebun Bakalan (Bakalan A / GPA 1-3 -> Afdeling A, Bakalan B / GPA 4-6 -> Afdeling B, Bakalan C / GPA 7-8 -> Afdeling C)
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
 * Fungsi Utama: Ekstraksi Penuh Atribut & Agronomi 1 Fitur Spasial
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
        : `Petak #${featId}`;
    }
  }

  const shortName = blokName.replace(/\s*\([^)]*\)\s*/g, '').trim() || blokName;

  // 2. Ekstraksi Luas Ukur GIS vs Luas Baku Dokumen Legal
  const luas1Val = parseNumericHa(props.Luas1 ?? props.luas1);
  const luasPrimaryVal = parseNumericHa(
    props.luas_ha ?? props.LUAS_HA ?? props.luas ?? props.Luas ?? props.LUAS
  );
  const geomLuas =
    typeof ctx.geomLuasHa === 'number' && Number.isFinite(ctx.geomLuasHa) && ctx.geomLuasHa > 0
      ? ctx.geomLuasHa
      : parseNumericHa(props._luas_geodesik_ha) ?? 0;

  const rawShapeArea = parseNumericHa(
    props.Shape_Area ?? props.shape_area ?? props.area ?? props.AREA
  );
  // Konversi Shape_Area: jika > 500 maka satuan meter persegi (UTM/WebMercator -> bagi 10.000), jika < 0.01 maka derajat kuadrat
  const shapeAreaHa =
    rawShapeArea !== null
      ? rawShapeArea > 500
        ? rawShapeArea / 10000
        : rawShapeArea < 0.01 && rawShapeArea > 0
        ? rawShapeArea * 1232100
        : null
      : null;

  let luasUkurHa = 0;
  let luasUkurSource = 'Geodesik PostGIS';

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

  // Pola Kebun Sarongge: jika ada Luas1 (desimal GIS) DAN Luas (angka baku legal > 0), maka Luas = Luas Baku
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

  // 4. Keliling Batas (km)
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
  const tanaman = pickAttr(props, popup, ['Tanaman', 'tanaman', 'komoditas', 'Komoditas']);
  const varietas = pickAttr(props, popup, ['Varietas', 'varietas']);
  const ttAttr = pickAttr(props, popup, ['TT', 'tt', 'tahun_tanam']);
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

  // 7. Deteksi Komoditas (3 Tingkat Prioritas) & Estimasi Produksi Otomatis
  const commodity = detectCommodityProfile({
    tanaman,
    varietas,
    statusLahan,
    tt: ttAttr,
    blokName,
    komoditas: ctx.komoditas,
    perusahaan: ctx.perusahaan || pickAttr(props, popup, ['perusahaan', 'Perusahaan', 'PERUSAHAAN']),
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
    tanaman: tanaman || commodity.label,
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
