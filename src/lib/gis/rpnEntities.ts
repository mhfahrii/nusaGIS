export type RpnEntityCode = 'P3GI' | 'PPTK' | 'PPKS' | 'PPKKI' | 'PPK';

export type SpecificCommodityKey =
  | 'tebu'
  | 'teh'
  | 'kina'
  | 'sawit'
  | 'kopi'
  | 'kakao'
  | 'karet'
  | 'belum_ditentukan';

export interface RpnEntityConfig {
  code: RpnEntityCode;
  label: string;
  fullName: string;
  commodityLabel: string;
  commodityKey: 'tebu' | 'teh' | 'sawit' | 'kopi_kakao' | 'karet';
  isMultiCommodity: boolean;
  commodities: string[];
  defaultCommodity: string | null;
  color: string;
  keywords: string[];
}

export const HOLDING_NAME = 'Holding Perkebunan Nusantara (PTPN III Persero)';
export const PARENT_COMPANY_NAME = 'PT Riset Perkebunan Nusantara (PT RPN)';
export const DEFAULT_PERUSAHAAN = PARENT_COMPANY_NAME;

export const RPN_ENTITIES: RpnEntityConfig[] = [
  {
    code: 'P3GI',
    label: 'P3GI (Gula / Tebu)',
    fullName: 'Pusat Penelitian Perkebunan Gula Indonesia',
    commodityLabel: 'Tebu',
    commodityKey: 'tebu',
    isMultiCommodity: false,
    commodities: ['Tebu'],
    defaultCommodity: 'Tebu',
    color: '#10B981',
    keywords: ['p3gi', 'gula', 'tebu', 'bakalan', 'sragi', 'pasuruan', 'pekalongan', 'pska', 'ktg', 'ks gpa', 'gpa'],
  },
  {
    code: 'PPTK',
    label: 'PPTK (Teh & Kina)',
    fullName: 'Pusat Penelitian Teh dan Kina',
    commodityLabel: 'Teh & Kina',
    commodityKey: 'teh',
    isMultiCommodity: true,
    commodities: ['Teh', 'Kina'],
    defaultCommodity: null,
    color: '#00D2FF',
    keywords: ['pptk', 'teh', 'kina', 'gambung', 'cibeureum', 'sarongge', 'pasir sarongge', 'bandung', 'cianjur'],
  },
  {
    code: 'PPKS',
    label: 'PPKS (Kelapa Sawit)',
    fullName: 'Pusat Penelitian Kelapa Sawit',
    commodityLabel: 'Kelapa Sawit',
    commodityKey: 'sawit',
    isMultiCommodity: false,
    commodities: ['Kelapa Sawit'],
    defaultCommodity: 'Kelapa Sawit',
    color: '#F59E0B',
    keywords: ['ppks', 'sawit', 'kelapa sawit', 'marihat', 'aek pancur', 'sei aek pancur', 'medan', 'deli serdang', 'tbs', 'cpo', 'palm'],
  },
  {
    code: 'PPKKI',
    label: 'PPKKI (Kopi & Kakao)',
    fullName: 'Pusat Penelitian Kopi dan Kakao Indonesia',
    commodityLabel: 'Kopi & Kakao',
    commodityKey: 'kopi_kakao',
    isMultiCommodity: true,
    commodities: ['Kopi', 'Kakao'],
    defaultCommodity: null,
    color: '#A78BFA',
    keywords: ['ppkki', 'iccri', 'kopi', 'kakao', 'jember', 'kaliwining', 'andungsari', 'coffee', 'cocoa'],
  },
  {
    code: 'PPK',
    label: 'PPK (Karet)',
    fullName: 'Pusat Penelitian Karet',
    commodityLabel: 'Karet',
    commodityKey: 'karet',
    isMultiCommodity: false,
    commodities: ['Karet'],
    defaultCommodity: 'Karet',
    color: '#F472B6',
    keywords: ['ppk', 'karet', 'sembawa', 'sungai putih', 'sungei putih', 'getas', 'lateks', 'rubber'],
  },
];

export const RPN_ENTITY_OPTIONS: string[] = RPN_ENTITIES.map((e) => e.label);

export function findRpnEntity(raw?: string | null): RpnEntityConfig | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim().toLowerCase();

  // Check exact label or exact code first (check longer codes PPKKI, PPKS, PPTK, P3GI before PPK)
  const sortedByCodeLen = [...RPN_ENTITIES].sort((a, b) => b.code.length - a.code.length);
  for (const entity of sortedByCodeLen) {
    const codeLower = entity.code.toLowerCase();
    if (
      s === entity.label.toLowerCase() ||
      s === codeLower ||
      s.startsWith(`${codeLower} `) ||
      s.startsWith(`${codeLower}(`) ||
      s.startsWith(`${codeLower}-`) ||
      s.includes(entity.fullName.toLowerCase())
    ) {
      return entity;
    }
  }
  return null;
}

export function normalizePerusahaanName(raw?: string | null): string {
  if (!raw || !raw.trim()) return DEFAULT_PERUSAHAAN;
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // Replace obsolete default with PT RPN
  if (lower.includes('perkebunan nusantara i') && lower.includes('regional 4')) {
    return DEFAULT_PERUSAHAAN;
  }

  const matched = findRpnEntity(trimmed);
  if (matched) return matched.label;

  return trimmed;
}

export function isParentRpnName(raw?: string | null): boolean {
  if (!raw || !raw.trim()) return true;
  const lower = raw.trim().toLowerCase();
  return (
    lower === PARENT_COMPANY_NAME.toLowerCase() ||
    lower === 'pt rpn' ||
    lower === 'rpn' ||
    lower.includes('riset perkebunan nusantara') ||
    (lower.includes('perkebunan nusantara i') && lower.includes('regional 4'))
  );
}

export function inferRpnEntityFromContext(opts: {
  perusahaan?: string | null;
  namaKebun?: string | null;
  wilayah?: string | null;
  layerName?: string | null;
  komoditas?: string | null;
}): string {
  // 1. Respect explicit non-parent perusahaan first
  if (opts.perusahaan && opts.perusahaan.trim()) {
    const matched = findRpnEntity(opts.perusahaan);
    if (matched) return matched.label;
    if (!isParentRpnName(opts.perusahaan)) {
      return opts.perusahaan.trim();
    }
  }

  // 2. Infer from folder/file/kebun/wilayah/komoditas context
  const haystack = [opts.layerName, opts.namaKebun, opts.wilayah, opts.komoditas]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (haystack) {
    const order: RpnEntityCode[] = ['P3GI', 'PPTK', 'PPKS', 'PPKKI', 'PPK'];
    for (const code of order) {
      const entity = RPN_ENTITIES.find((e) => e.code === code)!;
      for (const kw of entity.keywords) {
        if (kw === 'ppk') {
          if (/\bppk\b/.test(haystack)) return entity.label;
        } else if (haystack.includes(kw)) {
          return entity.label;
        }
      }
    }
  }

  return DEFAULT_PERUSAHAAN;
}

/**
 * Format nama perusahaan khusus untuk Popup Poligon Peta.
 * Tidak pernah menampilkan "PT Riset Perkebunan Nusantara (PT RPN)" di dalam popup karena RPN adalah induk pusat.
 */
export function formatPerusahaanForPopup(
  rawPerusahaan?: string | null,
  ctx?: {
    namaKebun?: string | null;
    wilayah?: string | null;
    layerName?: string | null;
    komoditas?: string | null;
  }
): string {
  const inferred = inferRpnEntityFromContext({
    perusahaan: rawPerusahaan,
    namaKebun: ctx?.namaKebun,
    wilayah: ctx?.wilayah,
    layerName: ctx?.layerName,
    komoditas: ctx?.komoditas,
  });

  if (isParentRpnName(inferred)) {
    return '';
  }

  return inferred;
}

export function matchPerusahaanFilter(
  recordPerusahaan: string | null | undefined,
  selectedFilter: string
): boolean {
  const filterClean = selectedFilter.trim();
  if (!filterClean) return true;

  const filterNorm = normalizePerusahaanName(filterClean).toLowerCase();
  const recordNorm = normalizePerusahaanName(recordPerusahaan).toLowerCase();

  if (recordNorm === filterNorm) return true;

  const filterEntity = findRpnEntity(filterClean);
  const recordEntity = findRpnEntity(recordPerusahaan);
  if (filterEntity && recordEntity) {
    return filterEntity.code === recordEntity.code;
  }

  return false;
}
