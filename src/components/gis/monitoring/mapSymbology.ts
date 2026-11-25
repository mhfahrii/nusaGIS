import { extractFeatureIntel } from '@/lib/gis/attributeExtractor';

export type LeafletBasemapKey = 'google_sat' | 'google_hybrid' | 'satellite' | 'bmkg_weather' | 'osm';

export interface BasemapConfig {
  name: string;
  url: string;
  attribution: string;
  description: string;
  maxNativeZoom: number;
  maxZoom: number;
  subdomains?: string[] | string;
}

export const BASEMAP_STYLES: Record<LeafletBasemapKey, BasemapConfig> = {
  google_sat: {
    name: 'Citra Satelit HD (Google 2x)',
    url: 'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&scale=2',
    attribution: 'Tiles &copy; Google Maps High-Res Satellite',
    description: 'Citra satelit Retina 512px tajam hingga level pohon',
    maxNativeZoom: 20,
    maxZoom: 21,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
  },
  google_hybrid: {
    name: 'Satelit Hybrid HD + Label',
    url: 'https://{s}.google.com/vt/lyrs=y&hl=id&x={x}&y={y}&z={z}&scale=2',
    attribution: 'Tiles &copy; Google Maps Hybrid HD',
    description: 'Satelit HD dilengkapi nama desa, jalan & batas',
    maxNativeZoom: 20,
    maxZoom: 21,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
  },
  satellite: {
    name: 'Citra Satelit (Esri + Auto-HD)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Maxar, Earthstar Geographics, and GIS Community',
    description: 'Citra Esri + otomatis beralih ke HD saat zoom dekat',
    maxNativeZoom: 18,
    maxZoom: 21,
  },
  bmkg_weather: {
    name: 'Peta Cuaca & Suhu BMKG',
    url: 'https://{s}.google.com/vt/lyrs=y&hl=id&x={x}&y={y}&z={z}&scale=2',
    attribution: 'Meteorologi BMKG / Open-Meteo &amp; RainViewer Radar · Google Hybrid HD',
    description: 'Suhu (°C), cuaca kebun, prakiraan 3 hari & radar hujan',
    maxNativeZoom: 20,
    maxZoom: 21,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    description: 'Peta jalan dan batas administratif standar',
    maxNativeZoom: 19,
    maxZoom: 21,
  },
};

export interface RkapClassification {
  luasHa: number;
  category: 'optimal' | 'warning' | 'critical';
  color: string;
  label: string;
  statusText: string;
  badgeText: string;
}

/**
 * Filter cerdas keterkaitan fitur blok terhadap Afdeling (Standar Hierarki Perkebunan + Klaster Otomatis A/B/C/Kebun Rakyat)
 */
export function isFeatureMatchingAfdeling(
  feature: GeoJSON.Feature | Record<string, unknown>,
  afdelingId: number | null | undefined,
  afdelingList: { id: number; kebun_id?: number; nama_afdeling: string; kode_afdeling: string }[] = [],
  layerKebunId?: number | null
): boolean {
  if (!afdelingId) return true;
  const props = ((feature as GeoJSON.Feature).properties || feature || {}) as Record<string, unknown>;

  const afd = afdelingList.find((a) => Number(a.id) === Number(afdelingId));

  // 0. Guard Kebun Induk: jika Afdeling punya kebun_id dan layer berasal dari kebun lain, langsung tolak
  if (afd?.kebun_id && layerKebunId && Number(afd.kebun_id) !== Number(layerKebunId)) {
    return false;
  }

  // 1. Cek langsung jika id afdeling tersimpan di atribut fitur
  if (props.afdeling_id && Number(props.afdeling_id) === Number(afdelingId)) {
    return true;
  }

  if (!afd) return true;

  const afdNameLower = (afd.nama_afdeling || '').trim().toLowerCase();
  const afdCodeLower = (afd.kode_afdeling || '').trim().toLowerCase();

  // 2. Cek menggunakan Mesin Ekstraksi Multi-Kolom (A1-A4 -> Afdeling A, B1-B4 -> Afdeling B, C1-C4 -> Afdeling C, Kebun Rakyat, Bakalan Rayon A/B/C)
  const intel = extractFeatureIntel(props);
  if (intel.afdelingGroup) {
    const groupLower = intel.afdelingGroup.toLowerCase();
    if (
      groupLower === afdNameLower ||
      groupLower.includes(afdNameLower) ||
      afdNameLower.includes(groupLower)
    ) {
      return true;
    }
  }

  // 3. Cek jika nama atau kode afdeling terdapat langsung di atribut DBF
  const featAfd = String(
    props.afdeling || props.nama_afdeling || props.NAMA_AFDELING || props.kode_afdeling || ''
  )
    .trim()
    .toLowerCase();
  if (featAfd) {
    if (featAfd === afdNameLower || featAfd.includes(afdNameLower) || afdNameLower.includes(featAfd)) {
      return true;
    }
    if (afdCodeLower && (featAfd === afdCodeLower || featAfd.includes(afdCodeLower))) {
      return true;
    }
  }

  // 4. Heuristik Partisi Blok Kebun Bakalan (cek Afdeling II / 2 terlebih dahulu agar 'ii' tidak terdeteksi sebagai 'i')
  const featName = intel.blokName.toLowerCase();
  const isAfd2 =
    /\b(ii|2)\b/i.test(afdNameLower) ||
    /(?:^|[-_\s])(?:ii|2)$|afd[^0-9]*2\b/i.test(afdCodeLower);
  const isAfd1 =
    !isAfd2 &&
    (/\b(i|1)\b/i.test(afdNameLower) ||
      /(?:^|[-_\s])(?:i|1)$|afd[^0-9]*1\b/i.test(afdCodeLower));

  if (isAfd1) {
    return /gpa\s*[1-3]\b|bakalan\s*a\b/i.test(featName);
  }
  if (isAfd2) {
    return /gpa\s*[4-8]\b|bakalan\s*[bc]\b/i.test(featName);
  }

  // 5. Jika filter adalah klaster eksplisit (Afdeling A/B/C/D) namun fitur tidak cocok di langkah 2, tolak
  if (/afdeling\s+[a-d]\b/i.test(afdNameLower)) {
    return false;
  }

  return false;
}

/**
 * Klasifikasi Simbologi Tematik ArcGIS Pro Murni dari Atribut Shapefile (.dbf / PopupInfo)
 */
export function getFeatureRkapClassification(
  featId: number,
  props: Record<string, unknown>
): RkapClassification {
  const intel = extractFeatureIntel(props, { featId });
  const luasHa = intel.luasUkurHa;
  const statusLahan = intel.statusLahan;
  const varietas = intel.varietas;

  // Kelas 1: Kebun Tebu Giling (KTG) / Blok Sudah Tanam Varietas
  if (/ktg|tebu giling/i.test(statusLahan) || varietas !== '') {
    return {
      luasHa,
      category: 'optimal',
      color: '#10b981',
      label: 'KTG · Tebu Giling',
      statusText: statusLahan || 'Kebun Tebu Giling (KTG)',
      badgeText: varietas ? `${statusLahan || 'KTG'} · ${varietas}` : statusLahan || 'KTG',
    };
  }

  // Kelas Khusus Klaster Afdeling (misal Kebun Sarongge A/B/C/Kebun Rakyat tanpa status KS GPA)
  if (!statusLahan && intel.afdelingGroup) {
    const isB = /afdeling b/i.test(intel.afdelingGroup);
    const isC = /afdeling c|kebun rakyat/i.test(intel.afdelingGroup);
    return {
      luasHa,
      category: isB ? 'optimal' : isC ? 'critical' : 'warning',
      color: intel.afdelingColor,
      label: intel.afdelingGroup,
      statusText: intel.afdelingGroup,
      badgeText: `${luasHa} Ha`,
    };
  }

  // Kelas 2: KS GPA 2023 - Blok Luas Besar (>= 1.50 Ha)
  if (luasHa >= 1.5) {
    return {
      luasHa,
      category: 'warning',
      color: '#00d2ff',
      label: 'KS GPA (≥ 1,50 Ha)',
      statusText: `${statusLahan || 'KS GPA 2023'} · Blok Besar`,
      badgeText: `${luasHa} Ha`,
    };
  }

  // Kelas 3: KS GPA 2023 - Blok Luas Kecil (< 1.50 Ha)
  return {
    luasHa,
    category: 'critical',
    color: '#f59e0b',
    label: 'KS GPA (< 1,50 Ha)',
    statusText: `${statusLahan || 'KS GPA 2023'} · Blok Kecil`,
    badgeText: `${luasHa} Ha`,
  };
}

/**
 * Menghitung luas poligon geodesik bola bumi dalam satuan Hektar (Ha)
 */
export function calculatePolygonAreaHa(latlngs: [number, number][]): number {
  if (latlngs.length < 3) return 0;
  const radius = 6378137;
  let total = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const j = (i + 1) % latlngs.length;
    const lat1 = (latlngs[i][0] * Math.PI) / 180;
    const lat2 = (latlngs[j][0] * Math.PI) / 180;
    const lng1 = (latlngs[i][1] * Math.PI) / 180;
    const lng2 = (latlngs[j][1] * Math.PI) / 180;
    total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  const areaM2 = Math.abs(total * radius * radius) / 2.0;
  return Number((areaM2 / 10000.0).toFixed(2));
}
