/**
 * Sistem Pencarian Geospasial Multi-Sumber (NusaGIS)
 *
 * 1. Kegunaan Pertama — Pencarian Wilayah & Alamat (Basic/Umum -> Spesifik/Pelosok) + Outline Batas Zona:
 *    Menggabungkan 3 sumber geospasial secara paralel:
 *    - Photon Komoot (OpenStreetMap cepat)
 *    - Esri ArcGIS World Geocoder (Sangat lengkap untuk desa pelosok, kampung, jalan, dusun di seluruh Indonesia)
 *    - BIG (Badan Informasi Geospasial - BATAS_DESAKEL_AR, BATAS_KECAMATAN_AR, BATAS_KABKOTA_AR) Resmi Pemerintah RI
 *
 *    Untuk Outline Batas Wilayah (seperti Google Maps):
 *    - Mengambil poligon administrasi dari Nominatim OSM (untuk Pulau, Provinsi, Kota/Kab, Kecamatan, Desa yang terpetakan di OSM)
 *    - Fallback otomatis ke Geoservices Resmi BIG (Skala 1:10.000 Desa/Kelurahan, Kecamatan, Kab/Kota, Provinsi)
 *      baik berdasarkan OBJECTID maupun titik koordinat (Spatial Point Intersection), sehingga desa pelosok yang di OSM
 *      hanya berupa titik (Node) TETAP memiliki garis batas wilayah (outline) asli!
 *
 * 2. Kegunaan Kedua — Pencarian Data Kebun yang Sudah Di-upload / Dibuat:
 *    Mencari fitur lahan, blok, afdeling, kebun, layer SHP/KML/GeoJSON, dan raster GeoTIFF di PostGIS lokal.
 */

export interface LocalSearchResult {
  id: string;
  kind: 'feature' | 'layer' | 'raster' | 'coordinate';
  name: string;
  description: string;
  badge: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  featureId?: number;
  layerId?: number;
  rasterId?: number;
  layerVisible?: boolean;
  luasHa?: number | null;
  geometry?: GeoJSON.Geometry | null;
}

export type AdminLevel = 'island' | 'province' | 'kabkota' | 'kecamatan' | 'desa' | 'locality';

export interface PlaceSearchResult {
  id: string;
  kind: 'place';
  name: string;
  description: string;
  badge: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  osmType?: 'N' | 'W' | 'R';
  osmId?: number;
  adminLevel?: AdminLevel;
  bigService?: 'BATAS_DESAKEL_AR' | 'BATAS_KECAMATAN_AR' | 'BATAS_KABKOTA_AR';
  bigObjectId?: number;
  kecamatanName?: string;
  kabkotaName?: string;
  boundary?: GeoJSON.Geometry | GeoJSON.FeatureCollection | null;
}

export type MapSearchResult = LocalSearchResult | PlaceSearchResult;

const INDONESIA_BBOX = '94,-11.5,141.5,6.5';
const BIG_BASE = 'https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH';

const PLACE_BADGES: Record<string, string> = {
  country: 'Negara',
  state: 'Provinsi / Pulau',
  region: 'Wilayah',
  county: 'Kabupaten / Kota',
  city: 'Kota / Kab',
  district: 'Kecamatan / Desa',
  locality: 'Kelurahan / Desa',
  street: 'Jalan',
  house: 'Tempat / Bangunan',
  other: 'Lokasi',
};

const LEVEL_RANK: Record<AdminLevel, number> = {
  island: 0,
  province: 1,
  kabkota: 2,
  kecamatan: 3,
  desa: 4,
  locality: 5,
};

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: 'N' | 'W' | 'R';
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    extent?: [number, number, number, number]; // [minLng, maxLat, maxLng, minLat]
  };
}

/** Bersihkan kata administratif & variasi ejaan umum agar pencarian bertingkat akurat */
export function normalizeQuery(q: string): string {
  return q
    .replace(/\b(kec\.?|kecamatan|kel\.?|kelurahan|desa|ds\.?|prov\.?|provinsi|kp\.?|kampung|distrik)\s*/gi, '')
    .replace(/\bkab\.\s*/gi, 'Kabupaten ')
    .replace(/\bcibereum\b/gi, 'Cibeureum')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^,\s*|,\s*$/g, '')
    .trim();
}

function detectPhotonAdminLevel(p: PhotonFeature['properties']): { level: AdminLevel; badge: string } {
  const val = p.osm_value || '';
  const t = p.type || 'other';
  if (val === 'island') return { level: 'island', badge: 'Pulau' };
  if (t === 'state' || t === 'region' || val === 'state') {
    const isIslandName = /^(kalimantan|sumatera|sumatra|sulawesi|jawa|papua|maluku|nusa tenggara)$/i.test(
      (p.name || '').trim()
    );
    return { level: isIslandName ? 'island' : 'province', badge: isIslandName ? 'Pulau / Wilayah' : 'Provinsi' };
  }
  if (t === 'county' || t === 'city' || val === 'city' || val === 'town') {
    if (val === 'village') return { level: 'desa', badge: 'Desa / Kelurahan' };
    return { level: 'kabkota', badge: 'Kabupaten / Kota' };
  }
  if (val === 'village' || val === 'suburb') return { level: 'desa', badge: 'Desa / Kelurahan' };
  if (val === 'hamlet' || val === 'neighbourhood' || val === 'quarter') {
    return { level: 'desa', badge: 'Kampung / Dusun' };
  }
  if (t === 'district' || val === 'district' || val === 'municipality') {
    return { level: 'kecamatan', badge: 'Kecamatan' };
  }
  return { level: 'locality', badge: PLACE_BADGES[t] || 'Lokasi' };
}

function mapPhoton(f: PhotonFeature, idx: number): PlaceSearchResult {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const title =
    p.name ||
    (p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : '') ||
    p.district ||
    p.city ||
    p.state ||
    'Lokasi';
  const parts = [p.district, p.city, p.county, p.state, p.country].filter(
    (x, i, arr): x is string => !!x && x !== title && arr.indexOf(x) === i
  );
  let bbox: [number, number, number, number] | undefined;
  if (Array.isArray(p.extent) && p.extent.length === 4) {
    const [a, b, c, d] = p.extent;
    bbox = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
  }
  const { level, badge } = detectPhotonAdminLevel(p);
  return {
    id: `photon-${p.osm_type}${p.osm_id}-${idx}`,
    kind: 'place',
    name: title,
    description: parts.join(', '),
    badge,
    lat,
    lng,
    bbox,
    osmType: p.osm_type,
    osmId: p.osm_id,
    adminLevel: level,
    kecamatanName: p.district || p.city,
    kabkotaName: p.county || p.city,
  };
}

async function photonSearch(q: string, signal: AbortSignal): Promise<PlaceSearchResult[]> {
  try {
    const url = `https://photon.komoot.io/api/?limit=8&bbox=${INDONESIA_BBOX}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    return ((json.features || []) as PhotonFeature[]).map(mapPhoton);
  } catch {
    return [];
  }
}

interface EsriCandidate {
  address: string;
  location: { x: number; y: number };
  extent?: { xmin: number; ymin: number; xmax: number; ymax: number };
  attributes: {
    Addr_type?: string;
    Type?: string;
    ShortLabel?: string;
    LongLabel?: string;
    Neighborhood?: string;
    District?: string;
    City?: string;
    Subregion?: string;
    Region?: string;
  };
}

/**
 * Pencarian ke Esri ArcGIS World Geocoder (Sangat lengkap untuk desa pelosok, kampung, jalan di Indonesia)
 */
async function esriSearch(q: string, signal: AbortSignal): Promise<PlaceSearchResult[]> {
  try {
    const url =
      `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates` +
      `?SingleLine=${encodeURIComponent(q)}&countryCode=IDN&maxLocations=8` +
      `&outFields=Addr_type,Type,ShortLabel,LongLabel,Neighborhood,District,City,Subregion,Region&f=json`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    const candidates: EsriCandidate[] = json.candidates || [];

    return candidates.map((c, idx) => {
      const a = c.attributes || {};
      const title = a.ShortLabel || c.address.split(',')[0] || 'Lokasi';
      const hierarchy = [a.Neighborhood, a.District, a.City, a.Subregion, a.Region, 'Indonesia']
        .filter((x, i, arr): x is string => !!x && x !== title && arr.indexOf(x) === i)
        .join(', ');

      const addrType = (a.Addr_type || '').toLowerCase();
      const subType = (a.Type || '').toLowerCase();

      let adminLevel: AdminLevel = 'locality';
      let badge = 'Lokasi / Tempat';
      if (subType === 'island' || /^(kalimantan|sumatera|sulawesi|jawa|papua)$/i.test(title)) {
        adminLevel = 'island';
        badge = 'Pulau / Wilayah';
      } else if (addrType === 'region' || subType === 'state' || subType === 'province') {
        adminLevel = 'province';
        badge = 'Provinsi';
      } else if (subType === 'county' || subType === 'city' || /^kabupaten|kota\b/i.test(title)) {
        adminLevel = a.District && a.District === title ? 'kecamatan' : 'kabkota';
        badge = adminLevel === 'kecamatan' ? 'Kecamatan / Wilayah' : 'Kabupaten / Kota';
      } else if (addrType === 'locality' || addrType === 'neighborhood' || subType === 'village' || subType === 'hamlet') {
        adminLevel = 'desa';
        badge = 'Desa / Kelurahan';
      } else if (addrType === 'streetname' || addrType === 'streetaddress') {
        adminLevel = 'locality';
        badge = 'Jalan / Alamat';
      }

      // Gunakan desa juga bila City/District terisi namun level masih kabkota dan bukan diawali Kab/Kota
      if (adminLevel === 'kabkota' && a.Subregion && a.Subregion !== title && !/^kota\b/i.test(title)) {
        adminLevel = 'desa';
        badge = 'Desa / Kecamatan';
      }

      const bbox: [number, number, number, number] | undefined = c.extent
        ? [c.extent.xmin, c.extent.ymin, c.extent.xmax, c.extent.ymax]
        : undefined;

      return {
        id: `esri-${idx}-${c.location.y.toFixed(4)}-${c.location.x.toFixed(4)}`,
        kind: 'place',
        name: title,
        description: hierarchy || a.LongLabel || 'Indonesia',
        badge,
        lat: c.location.y,
        lng: c.location.x,
        bbox,
        adminLevel,
        kecamatanName: a.City || a.District,
        kabkotaName: a.Subregion,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Pencarian ke Geoservices Resmi BIG (Badan Informasi Geospasial) untuk Desa/Kelurahan & Kecamatan
 * Menjamin desa-desa pelosok (seperti Citorek Kidul, Citorek Tengah, Citorek Sabrang, dll.) muncul lengkap!
 */
export async function searchBigAdmin(rawQuery: string, signal: AbortSignal): Promise<PlaceSearchResult[]> {
  const q = normalizeQuery(rawQuery);
  if (q.length < 3) return [];

  const segments = q.split(', ').filter(Boolean);
  const targetTerm = segments[segments.length - 1].replace(/'/g, '').trim();
  if (targetTerm.length < 3) return [];

  // Title Case untuk pencarian indeks cepat di BIG
  const titleTerm = targetTerm
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  const parentTerms = segments
    .slice(0, -1)
    .map((s) => s.replace(/\b(kabupaten|kota)\s*/gi, '').replace(/'/g, '').trim())
    .filter((s) => s.length >= 3);

  try {
    let whereDesa = `(NAMOBJ LIKE '${titleTerm}%' OR UPPER(NAMOBJ) LIKE '%${targetTerm.toUpperCase()}%')`;
    if (parentTerms.length > 0) {
      const parentConds = parentTerms.map(
        (p) =>
          `(UPPER(WADMKC) LIKE '%${p.toUpperCase()}%' OR UPPER(WADMKK) LIKE '%${p.toUpperCase()}%' OR UPPER(WADMPR) LIKE '%${p.toUpperCase()}%')`
      );
      whereDesa += ` AND ${parentConds.join(' AND ')}`;
    }

    const desaUrl =
      `${BIG_BASE}/BATAS_DESAKEL_AR/MapServer/0/query` +
      `?where=${encodeURIComponent(whereDesa)}` +
      `&outFields=OBJECTID,NAMOBJ,WADMKD,WADMKC,WADMKK,WADMPR,LUASWH` +
      `&returnGeometry=false&resultRecordCount=8&f=json`;

    const kecWhere = `NAMOBJ LIKE '${titleTerm}%'`;
    const kecUrl =
      `${BIG_BASE}/BATAS_KECAMATAN_AR/MapServer/0/query` +
      `?where=${encodeURIComponent(kecWhere)}` +
      `&outFields=OBJECTID,NAMOBJ,WADMKC,WADMKK,WADMPR,LUASWH` +
      `&returnGeometry=false&resultRecordCount=4&f=json`;

    const [desaRes, kecRes] = await Promise.allSettled([
      fetch(desaUrl, { signal }),
      parentTerms.length === 0 ? fetch(kecUrl, { signal }) : Promise.resolve(null),
    ]);

    const results: PlaceSearchResult[] = [];

    if (kecRes.status === 'fulfilled' && kecRes.value && kecRes.value.ok) {
      const kj = await kecRes.value.json();
      for (const feat of kj.features || []) {
        const a = feat.attributes || {};
        if (!a.NAMOBJ || !a.OBJECTID) continue;
        results.push({
          id: `big-kec-${a.OBJECTID}`,
          kind: 'place',
          name: `Kec. ${a.NAMOBJ}`,
          description: [a.WADMKK, a.WADMPR, 'Indonesia'].filter(Boolean).join(', '),
          badge: 'Kecamatan (BIG)',
          lat: 0,
          lng: 0,
          adminLevel: 'kecamatan',
          bigService: 'BATAS_KECAMATAN_AR',
          bigObjectId: Number(a.OBJECTID),
          kecamatanName: a.NAMOBJ,
          kabkotaName: a.WADMKK,
        });
      }
    }

    if (desaRes.status === 'fulfilled' && desaRes.value.ok) {
      const dj = await desaRes.value.json();
      for (const feat of dj.features || []) {
        const a = feat.attributes || {};
        if (!a.NAMOBJ || !a.OBJECTID) continue;
        const luasInfo = a.LUASWH ? ` · ${Number(a.LUASWH).toFixed(1)} km²` : '';
        results.push({
          id: `big-desa-${a.OBJECTID}`,
          kind: 'place',
          name: a.NAMOBJ,
          description: [`Kec. ${a.WADMKC}`, a.WADMKK, a.WADMPR].filter(Boolean).join(', ') + luasInfo,
          badge: 'Desa / Kel (BIG)',
          lat: 0,
          lng: 0,
          adminLevel: 'desa',
          bigService: 'BATAS_DESAKEL_AR',
          bigObjectId: Number(a.OBJECTID),
          kecamatanName: a.WADMKC,
          kabkotaName: a.WADMKK,
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

/** Gabungkan & urutkan hasil dari berbagai sumber tanpa duplikat */
export function mergePlaceResults(lists: PlaceSearchResult[][]): PlaceSearchResult[] {
  const seen = new Set<string>();
  const merged: PlaceSearchResult[] = [];

  for (const list of lists) {
    for (const r of list) {
      const normName = r.name.toLowerCase().replace(/^kec\.\s*|^desa\s*|^kel\.\s*/i, '').trim();
      const normKab = (r.kabkotaName || r.description.split(',')[0] || '').toLowerCase().replace(/^kabupaten\s*|^kab\s*|^kota\s*/i, '').trim();
      const key = `${r.adminLevel || 'loc'}|${normName}|${normKab}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
  }

  merged.sort((a, b) => {
    const rankA = LEVEL_RANK[a.adminLevel || 'locality'] ?? 5;
    const rankB = LEVEL_RANK[b.adminLevel || 'locality'] ?? 5;
    if (rankA !== rankB) return rankA - rankB;
    const hasPolyA = a.osmType === 'R' || a.bigObjectId ? 0 : 1;
    const hasPolyB = b.osmType === 'R' || b.bigObjectId ? 0 : 1;
    return hasPolyA - hasPolyB;
  });

  return merged.slice(0, 12);
}

/**
 * Cari alamat & wilayah secara cepat dari Photon + Esri (instan ~200ms).
 * Mendukung pencarian dari level Pulau/Provinsi hingga Desa/Kampung pelosok.
 */
export async function searchPlaces(rawQuery: string, signal: AbortSignal): Promise<PlaceSearchResult[]> {
  const q = normalizeQuery(rawQuery);
  if (q.length < 2) return [];

  const segments = q.split(', ').filter(Boolean);

  // Jalankan Photon & Esri secara paralel untuk kueri utama
  const [photonPrimary, esriPrimary] = await Promise.all([
    photonSearch(q, signal),
    esriSearch(q, signal),
  ]);

  // Jika segmen terakhir terdiri dari beberapa kata (cth: "Cibereum petir" pada "Kabupaten Bogor, Dramaga, Cibereum petir"),
  // cari juga kata-kata penyusunnya agar Desa Petir & Cibeureum di Kec. Dramaga muncul paling atas
  let subWordResults: PlaceSearchResult[] = [];
  if (segments.length >= 2) {
    const lastSeg = segments[segments.length - 1];
    const words = lastSeg.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length > 1) {
      const prefix = segments.slice(0, -1).join(', ');
      const wordQueries = [...words].reverse().map((w) => `${prefix}, ${w}`);
      const wordBatches = await Promise.all(wordQueries.map((wq) => photonSearch(wq, signal)));
      subWordResults = wordBatches.flat();
    }
  }

  // Jika urutan dibalik (misal user ketik "Kalimantan Timur, Samarinda"), coba juga urutan spesifik -> umum
  let reversedResults: PlaceSearchResult[] = [];
  if (photonPrimary.length === 0 && subWordResults.length === 0 && segments.length > 1) {
    reversedResults = await photonSearch([...segments].reverse().join(', '), signal);
  }

  const combined = mergePlaceResults([subWordResults, photonPrimary, reversedResults, esriPrimary]);
  if (combined.length > 0) return combined;

  // Fallback bertingkat jika belum ada hasil sama sekali
  for (let n = segments.length - 1; n >= 1; n--) {
    const fb = segments.slice(0, n).join(', ');
    const [pFb, eFb] = await Promise.all([photonSearch(fb, signal), esriSearch(fb, signal)]);
    const mergedFb = mergePlaceResults([pFb, eFb]);
    if (mergedFb.length > 0) {
      mergedFb.forEach((r) => {
        r.description = `${r.description} · (wilayah induk terdekat)`;
      });
      return mergedFb;
    }
  }

  return [];
}

/** Hitung bounding box [minLng, minLat, maxLng, maxLat] dari GeoJSON Geometry / FeatureCollection */
export function computeGeoJsonBbox(
  geo: GeoJSON.Geometry | GeoJSON.FeatureCollection
): [number, number, number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visitCoords = (coords: unknown): void => {
    if (!Array.isArray(coords) || coords.length === 0) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = coords[0];
      const lat = coords[1];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const item of coords) visitCoords(item);
  };

  if (geo.type === 'FeatureCollection') {
    for (const f of geo.features) {
      if (f.geometry && 'coordinates' in f.geometry) visitCoords(f.geometry.coordinates);
    }
  } else if ('coordinates' in geo) {
    visitCoords(geo.coordinates);
  }

  if (!isFinite(minLng) || !isFinite(minLat)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

/** Buat poligon persegi halus (smooth rounded zone) dari bbox bila data poligon tidak tersedia di server manapun */
function createFallbackZonePolygon(
  lat: number,
  lng: number,
  bbox?: [number, number, number, number]
): GeoJSON.Polygon {
  const [minLng, minLat, maxLng, maxLat] = bbox || [
    lng - 0.012,
    lat - 0.012,
    lng + 0.012,
    lat + 0.012,
  ];
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}

/**
 * Ambil poligon batas wilayah (outline zona seperti Google Maps) dengan 4 lapis sumber:
 * 1. BIG Official Polygon by OBJECTID (jika hasil dipilih dari daftar Desa/Kecamatan BIG — ~99ms)
 * 2. OpenStreetMap Nominatim Polygon (untuk Pulau, Provinsi, Kabupaten/Kota, Kecamatan, atau Desa yang ber-relasi R/W)
 * 3. BIG Official Spatial & Name Polygon Query (untuk titik Desa/Kelurahan/Pelosok di seluruh Indonesia yang di OSM hanya berupa titik Node!)
 * 4. Fallback Zone Polygon dari Extent/Bbox agar 100% lokasi yang dicari selalu menampilkan outline batas zona.
 */
export async function fetchBoundary(
  place: PlaceSearchResult,
  signal?: AbortSignal
): Promise<GeoJSON.Geometry | GeoJSON.FeatureCollection | null> {
  if (place.boundary) return place.boundary;

  const isArea = (g?: GeoJSON.Geometry | null): g is GeoJSON.Geometry =>
    !!g &&
    (g.type === 'Polygon' ||
      g.type === 'MultiPolygon' ||
      g.type === 'LineString' ||
      g.type === 'MultiLineString');

  try {
    // LAPIS 1: Jika hasil berasal dari BIG (memiliki bigService & bigObjectId), ambil poligon resminya langsung (~99ms)
    if (place.bigService && place.bigObjectId) {
      const offset = place.bigService === 'BATAS_DESAKEL_AR' ? 0.00003 : 0.0001;
      const bigUrl =
        `${BIG_BASE}/${place.bigService}/MapServer/0/query` +
        `?objectIds=${place.bigObjectId}&outFields=NAMOBJ,WADMKC,WADMKK,WADMPR` +
        `&returnGeometry=true&maxAllowableOffset=${offset}&outSR=4326&f=geojson`;
      const res = await fetch(bigUrl, { signal });
      if (res.ok) {
        const json = await res.json();
        const geom: GeoJSON.Geometry | undefined = json.features?.[0]?.geometry;
        if (isArea(geom)) return geom;
      }
    }

    // Hitung threshold penyederhanaan yang presisi (tidak memotong bentuk wilayah)
    let threshold = 0.00003;
    if (place.adminLevel === 'island') threshold = 0.004;
    else if (place.adminLevel === 'province') threshold = 0.0015;
    else if (place.adminLevel === 'kabkota') threshold = 0.0004;
    else if (place.adminLevel === 'kecamatan') threshold = 0.0001;

    // LAPIS 2A: Jika memiliki osmType R (Relation) atau W (Way), ambil dari Nominatim /lookup
    if (place.osmType && place.osmId && place.osmType !== 'N') {
      const lookupUrl =
        `https://nominatim.openstreetmap.org/lookup?format=geojson&polygon_geojson=1` +
        `&polygon_threshold=${threshold}&osm_ids=${place.osmType}${place.osmId}`;
      const res = await fetch(lookupUrl, { signal, headers: { 'Accept-Language': 'id' } });
      if (res.ok) {
        const json = await res.json();
        const geom: GeoJSON.Geometry | undefined = json.features?.[0]?.geometry;
        if (isArea(geom)) return geom;
      }
    }

    // LAPIS 2B: Untuk level Pulau / Provinsi / KabKota / Kecamatan tanpa osmId (misal dari Esri atau Pulau Kalimantan R7225940),
    // cari poligonnya di Nominatim
    if (
      place.adminLevel === 'island' ||
      place.adminLevel === 'province' ||
      place.adminLevel === 'kabkota' ||
      place.adminLevel === 'kecamatan'
    ) {
      const cleanDesc = place.description
        .replace(/\s*·\s*\([^)]*\)$/, '')
        .replace(/\bIndonesia\b/gi, '')
        .replace(/^,\s*|,\s*$/g, '')
        .trim();
      const q =
        place.adminLevel === 'island'
          ? place.name
          : cleanDesc
          ? `${place.name}, ${cleanDesc}`
          : place.name;

      const searchUrl =
        `https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=5` +
        `&polygon_threshold=${threshold}&q=${encodeURIComponent(q)}`;
      const res2 = await fetch(searchUrl, { signal, headers: { 'Accept-Language': 'id' } });
      if (res2.ok) {
        const json2 = await res2.json();
        const hit = (json2.features || []).find(
          (f: GeoJSON.Feature) =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (hit && isArea(hit.geometry)) return hit.geometry;
      }
    }

    // LAPIS 3: Geoservices Resmi BIG (Spatial Point Intersection + Cluster Desa)
    // Menangani seluruh Desa / Kelurahan / Kampung / Pelosok di Indonesia yang di OSM hanya berupa titik (Node)!
    if (place.lat !== 0 && place.lng !== 0) {
      let targetSvc = 'BATAS_DESAKEL_AR';
      let targetLayer = 0;
      let offset = 0.00004;

      if (place.adminLevel === 'kecamatan') {
        targetSvc = 'BATAS_KECAMATAN_AR';
        offset = 0.0001;
      } else if (place.adminLevel === 'kabkota') {
        targetSvc = 'BATAS_KABKOTA_AR';
        offset = 0.0003;
      } else if (place.adminLevel === 'province') {
        targetSvc = 'BATAS_WILAYAH';
        targetLayer = 12;
        offset = 0.001;
      }

      const ptUrl =
        `${BIG_BASE}/${targetSvc}/MapServer/${targetLayer}/query` +
        `?geometry=${place.lng},${place.lat}&geometryType=esriGeometryPoint&inSR=4326` +
        `&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,NAMOBJ,WADMKD,WADMKC,WADMKK,WADMPR` +
        `&returnGeometry=true&maxAllowableOffset=${offset}&outSR=4326&f=geojson`;

      const ptRes = await fetch(ptUrl, { signal });
      if (ptRes.ok) {
        const ptJson = await ptRes.json();
        const firstFeat = ptJson.features?.[0];
        if (firstFeat && isArea(firstFeat.geometry)) {
          const props = firstFeat.properties || {};
          const cleanName = place.name.replace(/^desa\s*|^kel\.\s*|^kampung\s*/i, '').trim();

          // Jika user mencari nama kawasan desa gabungan (contoh: "Citorek" yang terdiri dari Citorek Tengah, Kidul, Barat, Timur, Sabrang di Kec. Cibeber),
          // ambil seluruh poligon desa dalam gugus nama tersebut di kecamatan yang sama agar batas zonanya utuh!
          if (
            targetSvc === 'BATAS_DESAKEL_AR' &&
            cleanName.length >= 4 &&
            props.NAMOBJ &&
            props.WADMKC &&
            props.NAMOBJ.toLowerCase() !== cleanName.toLowerCase() &&
            props.NAMOBJ.toLowerCase().startsWith(cleanName.toLowerCase())
          ) {
            const clusterWhere = `UPPER(NAMOBJ) LIKE '${cleanName.replace(/'/g, '').toUpperCase()}%' AND UPPER(WADMKC) = '${String(props.WADMKC).replace(/'/g, '').toUpperCase()}'`;
            const clusterUrl =
              `${BIG_BASE}/BATAS_DESAKEL_AR/MapServer/0/query` +
              `?where=${encodeURIComponent(clusterWhere)}&outFields=NAMOBJ,WADMKC,WADMKK,WADMPR` +
              `&returnGeometry=true&maxAllowableOffset=0.00006&outSR=4326&f=geojson`;
            const cRes = await fetch(clusterUrl, { signal });
            if (cRes.ok) {
              const cJson = await cRes.json();
              if (Array.isArray(cJson.features) && cJson.features.length > 1) {
                return cJson as GeoJSON.FeatureCollection;
              }
            }
          }

          return firstFeat.geometry;
        }
      }
    }

    // LAPIS 4: Fallback Zone Polygon dari Bbox / Extent bila berada di luar cakupan poligon
    if (place.lat !== 0 && place.lng !== 0) {
      return createFallbackZonePolygon(place.lat, place.lng, place.bbox);
    }

    return null;
  } catch {
    if (place.lat !== 0 && place.lng !== 0) {
      return createFallbackZonePolygon(place.lat, place.lng, place.bbox);
    }
    return null;
  }
}

export async function searchLocalData(q: string, signal: AbortSignal): Promise<LocalSearchResult[]> {
  const res = await fetch(`/api/gis/geocode?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}
