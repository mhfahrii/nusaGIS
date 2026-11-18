'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type * as LType from 'leaflet';
import {
  IconFullExtent,
  IconBasemap,
  IconFullscreen,
  IconLayers,
  IconClose,
  IconPencil,
  IconCheck,
  IconDownload,
  IconSearch,
} from '../GisIcons';
import { CreateParcelModal } from './CreateParcelModal';
import type { LayerPeta, LayerRaster, MonitoringStats } from '@/types/gis';
import { extractFeatureIntel } from '@/lib/gis/attributeExtractor';
import {
  searchLocalData,
  searchPlaces,
  searchBigAdmin,
  mergePlaceResults,
  fetchBoundary,
  fetchWilayahBoundary,
  computeGeoJsonBbox,
  type LocalSearchResult,
  type PlaceSearchResult,
  type MapSearchResult,
} from '@/lib/geoSearch';

interface MonitoringMapProps {
  layers: LayerPeta[];
  rasterLayers?: LayerRaster[];
  stats?: MonitoringStats | null;
  selectedWilayah?: string;
  selectedLayerId?: number | null;
  onSelectFeature?: (featureId: number | null, layerId?: number) => void;
  selectedFeatureId?: number | null;
  fitBoundsTarget?: [number, number, number, number] | null;
  onToggleLayerVisibility?: (id: number, visible: boolean) => void;
  onToggleRasterVisibility?: (id: number, visible: boolean) => void;
  onChangeRasterOpacity?: (id: number, opacity: number) => void;
  onFeatureCreated?: (newFeature: Record<string, unknown>, layerId: number) => void;
  onFeatureDeleted?: (featureId: number, layerId: number) => void;
  dataRevision?: number;
  statusFilter?: 'all' | 'ktg' | 'ks_gpa';
  selectedAfdelingId?: number | null;
  afdelingList?: { id: number; kebun_id?: number; nama_afdeling: string; kode_afdeling: string }[];
}

export type LeafletBasemapKey = 'google_sat' | 'google_hybrid' | 'satellite' | 'topo' | 'osm';

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
  topo: {
    name: 'Topografi',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, TomTom, USGS, FAO, NPS, OpenStreetMap',
    description: 'Peta kontur dan relief medan perkebunan',
    maxNativeZoom: 18,
    maxZoom: 21,
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

  // 0. Guard Kebun Induk: jika Afdeling punya kebun_id dan layer berasal dari kebun lain (misal Bandung), LANGSUNG tolak!
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

  // 4. Heuristik Partisi Blok Kebun Bakalan (cek Afdeling II / 2 DULU agar 'ii' tidak terdeteksi sebagai 'i'!)
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

  // 5. Jika filter adalah klaster eksplisit (Afdeling A/B/C/D atau Kebun Rakyat) namun fitur tidak cocok di langkah 2, tolak
  if (/afdeling\s+[a-d]\b|kebun rakyat/i.test(afdNameLower)) {
    return false;
  }

  return false;
}

/**
 * Klasifikasi Simbologi Tematik ArcGIS Pro Murni dari Atribut Shapefile (.dbf / PopupInfo)
 * - Mendukung Status Pengelolaan (KTG vs KS GPA), Varietas, serta Pewarnaan Klaster Afdeling (A, B, C, Kebun Rakyat)
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
      color: '#10b981', // Emerald 500
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

  // Kelas 2: KS GPA 2023 — Blok Luas Besar (>= 1.50 Ha)
  if (luasHa >= 1.5) {
    return {
      luasHa,
      category: 'warning',
      color: '#00d2ff', // Electric Cyan
      label: 'KS GPA (≥ 1,50 Ha)',
      statusText: `${statusLahan || 'KS GPA 2023'} · Blok Besar`,
      badgeText: `${luasHa} Ha`,
    };
  }

  // Kelas 3: KS GPA 2023 — Blok Luas Kecil (< 1.50 Ha)
  return {
    luasHa,
    category: 'critical',
    color: '#f59e0b', // Amber 500
    label: 'KS GPA (< 1,50 Ha)',
    statusText: `${statusLahan || 'KS GPA 2023'} · Blok Kecil`,
    badgeText: `${luasHa} Ha`,
  };
}

/**
 * Menghitung luas poligon geodesik bola bumi dalam satuan Hektar (Ha)
 */
function calculatePolygonAreaHa(latlngs: [number, number][]): number {
  if (latlngs.length < 3) return 0;
  const radius = 6378137; // radius bumi dalam meter
  let total = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const j = (i + 1) % latlngs.length;
    const lat1 = (latlngs[i][0] * Math.PI) / 180;
    const lat2 = (latlngs[j][0] * Math.PI) / 180;
    const lng1 = (latlngs[i][1] * Math.PI) / 180;
    const lng2 = (latlngs[j][1] * Math.PI) / 180;
    total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  const areaM2 = (Math.abs(total * radius * radius) / 2.0);
  return Number((areaM2 / 10000.0).toFixed(2));
}

function SearchResultRow({
  loc,
  onSelect,
  accent,
}: {
  loc: MapSearchResult;
  onSelect: (loc: MapSearchResult) => void;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(loc)}
      className="w-full text-left px-3 py-2 hover:bg-[#19233A] transition-colors flex items-start justify-between gap-2 cursor-pointer group border-b border-[#1E2942]/50 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
          <span className="text-xs font-semibold text-[#F0F6FC] group-hover:text-[#00D2FF] truncate transition-colors">
            {loc.name}
          </span>
        </div>
        {loc.description && (
          <div className="text-[10.5px] text-[#8B9BB4] pl-3 truncate leading-tight mt-0.5">{loc.description}</div>
        )}
      </div>
      <span className="shrink-0 text-[9px] font-semibold text-[#8B9BB4] bg-[#12192B] border border-[#1E2942] px-1.5 py-0.5 rounded">
        {loc.badge}
      </span>
    </button>
  );
}

export function MonitoringMap({
  layers,
  rasterLayers = [],
  selectedWilayah = '',
  onSelectFeature,
  selectedFeatureId,
  fitBoundsTarget,
  onToggleLayerVisibility,
  onToggleRasterVisibility,
  onChangeRasterOpacity,
  onFeatureCreated,
  onFeatureDeleted,
  dataRevision,
  statusFilter = 'all',
  selectedAfdelingId = null,
  afdelingList = [],
}: MonitoringMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof LType | null>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const baseTileLayerRef = useRef<LType.TileLayer | null>(null);
  const hdDetailLayerRef = useRef<LType.TileLayer | null>(null);
  const geoJsonGroupRef = useRef<LType.LayerGroup | null>(null);
  const rasterGroupRef = useRef<LType.LayerGroup | null>(null);
  const drawGroupRef = useRef<LType.LayerGroup | null>(null);
  const searchGroupRef = useRef<LType.LayerGroup | null>(null);
  const wilayahGroupRef = useRef<LType.LayerGroup | null>(null);
  const wilayahAbortRef = useRef<AbortController | null>(null);
  const geojsonCacheRef = useRef<Map<number, GeoJSON.FeatureCollection>>(new Map());
  const initialAutoFitDoneRef = useRef<boolean>(false);
  const layersRef = useRef<LayerPeta[]>(layers);
  const selectedWilayahRef = useRef<string>(selectedWilayah);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);
  useEffect(() => {
    selectedWilayahRef.current = selectedWilayah;
  }, [selectedWilayah]);

  const onFeatureDeletedRef = useRef(onFeatureDeleted);
  useEffect(() => {
    onFeatureDeletedRef.current = onFeatureDeleted;
  }, [onFeatureDeleted]);

  // UI states — Default ke Citra Satelit HD (Google 2x Retina) agar tidak pecah saat zoom dekat
  const [currentBasemap, setCurrentBasemap] = useState<LeafletBasemapKey>('google_sat');
  const [isBasemapMenuOpen, setIsBasemapMenuOpen] = useState(false);
  const [isLayersPanelOpen, setIsLayersPanelOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [isOutlineOnly, setIsOutlineOnly] = useState(false);
  // ArcGIS Thematic Symbology: Mode Pewarnaan Layer ('default' vs 'rkap') — Default 'rkap' agar tematik status langsung aktif
  const [symbologyMode, setSymbologyMode] = useState<'default' | 'rkap'>('rkap');
  const [mapReady, setMapReady] = useState(false);
  const [loadingLayers, setLoadingLayers] = useState(false);
  const [inspectingPixel, setInspectingPixel] = useState(false);

  // Digitizing / Drawing Tool States
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]); // [lat, lng]
  const [mouseLatLng, setMouseLatLng] = useState<[number, number] | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);

  // Map Location Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [localResults, setLocalResults] = useState<LocalSearchResult[]>([]);
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingBoundary, setIsLoadingBoundary] = useState(false);
  const boundaryAbortRef = useRef<AbortController | null>(null);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [activeLocationPin, setActiveLocationPin] = useState<MapSearchResult | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  const onSelectFeatureRef = useRef(onSelectFeature);
  useEffect(() => {
    onSelectFeatureRef.current = onSelectFeature;
  }, [onSelectFeature]);

  // Helper: Zoom ke bbox [west, south, east, north] -> Leaflet [[south, west], [north, east]]
  const zoomToBounds = useCallback((bounds: [number, number, number, number]) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const [w, s, e, n] = bounds;
      if (
        !Number.isFinite(w) ||
        !Number.isFinite(s) ||
        !Number.isFinite(e) ||
        !Number.isFinite(n) ||
        Math.abs(w) > 180 ||
        Math.abs(e) > 180 ||
        Math.abs(s) > 90 ||
        Math.abs(n) > 90
      ) {
        return;
      }
      map.stop();
      if (typeof map.flyToBounds === 'function') {
        map.flyToBounds(
          [
            [s, w],
            [n, e],
          ],
          {
            padding: [50, 50],
            maxZoom: 17,
            duration: 0.9,
            easeLinearity: 0.25,
          }
        );
      } else {
        map.fitBounds(
          [
            [s, w],
            [n, e],
          ],
          {
            padding: [50, 50],
            maxZoom: 17,
            animate: true,
          }
        );
      }
    } catch (err) {
      console.warn('Leaflet fitBounds warning:', err);
    }
  }, []);

  // Helper: Membangun kartu popup fitur VEKTOR standar ArcGIS Pro / ArcGIS Enterprise
  const buildPopupElement = useCallback(
    (
      map: LType.Map,
      featureBounds: LType.LatLngBounds | null,
      clickLatLng: LType.LatLng,
      properties: Record<string, unknown>,
      layer: LayerPeta,
      featId: number
    ): HTMLElement => {
      // 0. Helper Validasi Nilai (Hilangkan jika kosong / null / tanda strip '-')
      const isValidValue = (val: unknown): boolean => {
        if (val === undefined || val === null) return false;
        const str = String(val).trim();
        if (
          str === '' ||
          str === '-' ||
          str === '--' ||
          str.toLowerCase() === 'null' ||
          str.toLowerCase() === 'none' ||
          str.toLowerCase() === 'undefined'
        ) {
          return false;
        }
        return true;
      };

      // 1. Ekstraksi Universal Multi-Kolom (nama_unit, Block, Name, Luas1, Luas, PopupInfo, Afdeling, Estimasi Produksi)
      const intel = extractFeatureIntel(properties, {
        featId,
        layerName: layer.nama_layer,
        namaKebun: layer.nama_kebun,
        wilayah: layer.wilayah,
        isSingleBoundaryLayer: layer.jumlah_fitur === 1,
      });

      const nameVal = intel.blokName;
      const luasUkurHa = intel.luasUkurHa;
      const luasBakuNum = intel.luasBakuHa;
      const selisihHa = intel.selisihHa;
      const selisihPct = intel.selisihPct;
      const statusLahan = intel.statusLahan;
      const varietas = intel.varietas;
      const mtFormatted = intel.mt
        ? intel.mtFormatted && intel.mtFormatted !== intel.mt
          ? `${intel.mtFormatted} (${intel.mt})`
          : intel.mt
        : '';
      const luasTanam = intel.luasTanamHa !== null ? `${intel.luasTanamHa.toFixed(2)} Ha` : '';
      const labelWilayah = intel.afdelingGroup || layer.wilayah || '';

      // 2. Filter Kolom Sampah Teknis KML / GIS (SymbolID, Clamped, Extruded, FolderPath, Derajat)
      const GARBAGE_KEYS = new Set([
        'symbolid',
        'altmode',
        'base',
        'clamped',
        'extruded',
        'snippet',
        'folderpath',
        'shape_leng',
        'shape_area',
        'popupinfo',
        '_luas_geodesik_ha',
        '_bbox',
        'id',
        'layer_id',
        'created_at',
        'updated_at',
        'luas',
        'luas1',
        'name',
        'nama_unit',
        'block',
        'label',
      ]);

      // 3. Susun baris atribut yang hanya BERISI DATA (Jika kosong, HILANGKAN row & nama barisnya!)
      const extraAttributes: Array<{ label: string; value: string }> = [];

      const rawPerusahaan =
        properties.perusahaan ||
        properties.Perusahaan ||
        properties.PERUSAHAAN ||
        properties.holding ||
        layer.perusahaan ||
        'PT Perkebunan Nusantara I (Regional 4)';
      if (isValidValue(rawPerusahaan)) {
        extraAttributes.push({ label: 'Perusahaan', value: String(rawPerusahaan) });
      }

      extraAttributes.push({ label: 'Komoditas', value: intel.commodity.label });

      if (isValidValue(intel.afdelingGroup)) {
        extraAttributes.push({ label: 'Afdeling / Klaster', value: String(intel.afdelingGroup) });
      }
      if (isValidValue(statusLahan)) {
        extraAttributes.push({ label: 'Status Lahan', value: statusLahan });
      }
      if (isValidValue(varietas)) {
        extraAttributes.push({ label: 'Varietas', value: varietas });
      }
      if (isValidValue(mtFormatted)) {
        extraAttributes.push({ label: 'Masa Tanam (MT)', value: mtFormatted });
      }
      if (isValidValue(luasTanam)) {
        extraAttributes.push({ label: 'Luas Tanam', value: luasTanam });
      }
      if (isValidValue(layer.wilayah) && layer.wilayah !== labelWilayah) {
        extraAttributes.push({ label: 'Wilayah', value: String(layer.wilayah) });
      }

      // Masukkan atribut kustom lain jika ada (yang bukan sampah dan punya nilai nyata)
      for (const [k, v] of Object.entries(properties)) {
        if (!k.startsWith('_') && !GARBAGE_KEYS.has(k.toLowerCase()) && isValidValue(v)) {
          const keyLower = k.toLowerCase();
          if (
            keyLower !== 'status' &&
            keyLower !== 'status_lahan' &&
            keyLower !== 'varietas' &&
            keyLower !== 'mt' &&
            keyLower !== 'luas_tanam' &&
            keyLower !== 'wilayah' &&
            keyLower !== 'afdeling' &&
            keyLower !== 'perusahaan' &&
            keyLower !== 'nama_kebun'
          ) {
            extraAttributes.push({ label: k, value: String(v) });
          }
        }
      }

      // Header Badge: Status Lahan atau Klaster Afdeling
      const headerBadgeText = statusLahan || intel.afdelingGroup || '';
      const isKTG =
        statusLahan.toLowerCase().includes('ktg') ||
        statusLahan.toLowerCase().includes('kebun tebu giling');
      const statusBadgeColor = isKTG
        ? '#10B981'
        : intel.afdelingGroup
        ? intel.afdelingColor
        : '#00D2FF';

      // Selisih Badge Styling
      let varianceBadge = '';
      if (selisihHa !== null && selisihPct !== null) {
        const isOptimal = Math.abs(selisihPct) <= 3.0;
        const varColor = isOptimal ? '#10B981' : selisihHa > 0 ? '#00D2FF' : '#F59E0B';
        const sign = selisihHa > 0 ? '+' : '';
        varianceBadge = `
          <div style="margin-top: 6px; padding: 4px 8px; background: ${varColor}15; border: 1px solid ${varColor}40; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; font-size: 10px;">
            <span style="color: #8b9bb4;">Audit Selisih Ukur vs Baku:</span>
            <span style="font-weight: 800; color: ${varColor}; font-family: ui-monospace, monospace;">${sign}${selisihHa.toFixed(2)} Ha (${sign}${selisihPct}%)</span>
          </div>
        `;
      }

      // Estimasi Produksi & Panen Highlight Box
      const productionHtml =
        intel.estimasiPanenTon > 0
          ? `
          <div style="margin-top: 6px; padding: 6px 8px; background: #0f241f; border: 1px solid #10b98145; border-radius: 6px; display: grid; grid-template-columns: ${
            intel.estimasiOlahanTon !== null ? '1fr 1fr' : '1fr'
          }; gap: 8px;">
            <div>
              <div style="font-size: 8.5px; font-weight: 700; color: #6ee7b7; text-transform: uppercase;">Est. ${intel.commodity.yieldUnit}</div>
              <div style="font-size: 13px; font-weight: 900; color: #10b981; font-family: ui-monospace, monospace;">
                ${intel.estimasiPanenTon.toLocaleString('id-ID', { maximumFractionDigits: 1 })} Ton
              </div>
            </div>
            ${
              intel.estimasiOlahanTon !== null && intel.commodity.processedUnit
                ? `<div>
                    <div style="font-size: 8.5px; font-weight: 700; color: #7dd3fc; text-transform: uppercase;">${intel.commodity.processedLabel || 'Hasil Olahan'}</div>
                    <div style="font-size: 13px; font-weight: 900; color: #00d2ff; font-family: ui-monospace, monospace;">
                      ${intel.estimasiOlahanTon.toLocaleString('id-ID', { maximumFractionDigits: 2 })} Ton
                    </div>
                  </div>`
                : ''
            }
          </div>`
          : '';

      // Highlight Luas: Hanya render box Luas Baku jika datanya ada
      const hasLuasBaku = Boolean(luasBakuNum && luasBakuNum > 0);
      const kpiHighlightHtml = hasLuasBaku
        ? `
        <div style="padding: 9px 12px; background: #0a0e1a; border-bottom: 1px solid #1e2942;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div style="background: #0d1322; border: 1px solid #1e2942; border-radius: 6px; padding: 6px 8px;">
              <div style="font-size: 9px; font-weight: 700; color: #8b9bb4; text-transform: uppercase; letter-spacing: 0.03em;">Luas Ukur GIS</div>
              <div style="font-size: 15px; font-weight: 900; color: #00D2FF; margin-top: 1px; font-family: ui-monospace, monospace;">
                ${luasUkurHa > 0 ? `${luasUkurHa.toFixed(2)} Ha` : '-'}
              </div>
              <div style="font-size: 8.5px; color: #566680; margin-top: 1px;">${intel.luasUkurSource}</div>
            </div>
            <div style="background: #0d1322; border: 1px solid #1e2942; border-radius: 6px; padding: 6px 8px;">
              <div style="font-size: 9px; font-weight: 700; color: #8b9bb4; text-transform: uppercase; letter-spacing: 0.03em;">Luas Baku Dokumen</div>
              <div style="font-size: 15px; font-weight: 900; color: #f0f6fc; margin-top: 1px; font-family: ui-monospace, monospace;">
                ${luasBakuNum ? `${luasBakuNum.toFixed(2)} Ha` : '-'}
              </div>
              <div style="font-size: 8.5px; color: #566680; margin-top: 1px;">${intel.luasBakuSource || 'Legal Dokumen'}</div>
            </div>
          </div>
          ${varianceBadge}
          ${productionHtml}
        </div>`
        : `
        <div style="padding: 9px 12px; background: #0a0e1a; border-bottom: 1px solid #1e2942;">
          <div style="background: #0d1322; border: 1px solid #1e2942; border-radius: 6px; padding: 6px 10px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 9px; font-weight: 700; color: #8b9bb4; text-transform: uppercase; letter-spacing: 0.03em;">Luas Ukur GIS</div>
              <div style="font-size: 8.5px; color: #566680; margin-top: 1px;">${intel.luasUkurSource}</div>
            </div>
            <div style="font-size: 16px; font-weight: 900; color: #00D2FF; font-family: ui-monospace, monospace;">
              ${luasUkurHa > 0 ? `${luasUkurHa.toFixed(2)} Ha` : '-'}
            </div>
          </div>
          ${productionHtml}
        </div>`;

      // Tabel Atribut: Hanya tampil jika ada atribut yang memiliki nilai
      const tableContentHtml =
        extraAttributes.length > 0
          ? `
        <div style="max-height: 150px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 10.5px;">
            <tbody>
              ${extraAttributes
                .map(
                  (attr, idx) => `
                <tr style="background: ${idx % 2 === 0 ? '#0d1322' : '#12192b'}; border-bottom: 1px solid #1e2942;">
                  <td style="padding: 5px 10px; color: #8b9bb4; font-size: 10px; font-weight: 600; white-space: nowrap; width: 44%;">${attr.label}</td>
                  <td style="padding: 5px 10px; color: #f0f6fc; font-weight: 700; font-size: 11px; text-align: left;">${attr.value}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>`
          : '';

      const wrapper = document.createElement('div');
      wrapper.style.cssText =
        'font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; color: #f0f6fc; background: #0d1322; border: 1px solid #1e2942; border-radius: 10px; overflow: hidden; width: 340px; max-width: 370px; max-height: min(480px, 72vh); display: flex; flex-direction: column; box-shadow: 0 20px 45px -4px rgba(0, 0, 0, 0.8), 0 10px 20px -4px rgba(0, 0, 0, 0.5);';

      wrapper.innerHTML = `
        <!-- 1. ArcGIS Pro Header -->
        <div style="background: linear-gradient(180deg, #12192b 0%, #0d1322 100%); padding: 10px 12px; border-bottom: 1px solid #1e2942; flex-shrink: 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${statusBadgeColor};"></span>
                <span style="font-size: 9px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #00D2FF;">${layer.nama_layer}</span>
              </div>
              <h4 style="margin: 0; font-size: 13px; font-weight: 800; color: #ffffff; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${String(nameVal)}
              </h4>
            </div>
            ${
              isValidValue(headerBadgeText)
                ? `<span style="background: ${statusBadgeColor}20; border: 1px solid ${statusBadgeColor}60; color: ${statusBadgeColor}; padding: 2px 7px; border-radius: 4px; font-size: 9.5px; font-weight: 800; white-space: nowrap;">
                     ${headerBadgeText}
                   </span>`
                : ''
            }
          </div>
        </div>

        <!-- 2. Dual KPI Highlight Card (Luas Ukur GIS vs Luas Baku) -->
        <div style="flex-shrink: 0;">
          ${kpiHighlightHtml}
        </div>

        <!-- 3. Clean Attribute Table (Hanya baris yang ada nilainya) -->
        <div style="flex: 1; min-height: 0; overflow-y: auto;">
          ${tableContentHtml}
        </div>

        <!-- 4. Modern Action Bar (Download & Kelola Data) -->
        <div style="background: #12192b; padding: 8px 12px; border-top: 1px solid #1e2942; display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-shrink: 0;">
          <a href="/api/gis/export?feature_id=${featId}&format=geojson" target="_blank" download="${String(nameVal)}.geojson" style="color: #00d2ff; background: #0e3a5d; border: 1px solid #00b4d8; font-size: 10px; font-weight: 700; text-decoration: none; padding: 4px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;" title="Unduh GeoJSON">
            <span>GeoJSON</span>
          </a>
          <a href="/api/gis/export?feature_id=${featId}&format=kml" target="_blank" download="${String(nameVal)}.kml" style="color: #7dd3fc; background: #132238; border: 1px solid #1e2942; font-size: 10px; font-weight: 700; text-decoration: none; padding: 4px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;" title="Unduh KML Google Earth">
            <span>KML</span>
          </a>
          <button type="button" data-action="delete" style="color: #f87171; background: #450a0a; border: 1px solid #991b1b; font-size: 10px; font-weight: 700; cursor: pointer; padding: 4px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;" title="Hapus Lahan ini dari Database">
            <span>Hapus</span>
          </button>
        </div>
      `;

      const delBtn = wrapper.querySelector('[data-action="delete"]');
      if (delBtn && featId) {
        delBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const confirmDel = window.confirm(
            `Apakah Anda yakin ingin menghapus lahan "${nameVal}" ini dari database?`
          );
          if (!confirmDel) return;

          try {
            const res = await fetch(`/api/gis/features?id=${featId}`, { method: 'DELETE' });
            if (res.ok) {
              map.closePopup();
              geojsonCacheRef.current.delete(layer.id);
              if (onFeatureDeletedRef.current) {
                onFeatureDeletedRef.current(featId, layer.id);
              }
            } else {
              const errJson = await res.json();
              alert(errJson.message || 'Gagal menghapus lahan.');
            }
          } catch (delErr) {
            console.error('Delete error:', delErr);
            alert('Terjadi kesalahan koneksi saat menghapus lahan.');
          }
        });
      }

      return wrapper;
    },
    []
  );

  // Helper: Membangun kartu popup inspeksi piksel RASTER
  const buildRasterPopupElement = useCallback(
    (
      raster: LayerRaster,
      pixelData: {
        primaryValue: number | null;
        values: number[];
        interpretation?: string;
        pixelX: number;
        pixelY: number;
      },
      clickLatLng: LType.LatLng
    ): HTMLElement => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText =
        'font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; color: #0f172a; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; min-width: 300px; max-width: 380px; box-shadow: 0 14px 35px -4px rgba(0, 0, 0, 0.4);';

      const val = pixelData.primaryValue;

      wrapper.innerHTML = `
        <div style="background: #064e3b; color: #ffffff; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34d399;"></span>
            <span style="font-weight: 700; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase;">Inspeksi Citra Raster</span>
          </div>
          <span style="font-size: 10px; background: rgba(255,255,255,0.2); padding: 1px 6px; border-radius: 4px; font-mono font-bold;">${raster.tipe_raster}</span>
        </div>

        <div style="padding: 10px 12px;">
          <h4 style="margin: 0 0 4px 0; font-size: 12px; font-weight: 700; color: #0f172a;">${raster.nama_layer}</h4>
          <p style="margin: 0 0 10px 0; color: #64748b; font-size: 10.5px;">
            Koordinat: ${clickLatLng.lat.toFixed(5)}, ${clickLatLng.lng.toFixed(5)} (Pixel [${pixelData.pixelX}, ${pixelData.pixelY}])
          </p>

          ${
            pixelData.interpretation
              ? `<div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; padding: 6px 10px; color: #065f46; font-weight: 600; font-size: 11px; margin-bottom: 10px;">
                  ${pixelData.interpretation}
                </div>`
              : ''
          }

          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <tbody>
              <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 5px 8px; color: #475569; font-family: ui-monospace, monospace;">Nilai Utama</td>
                <td style="padding: 5px 8px; color: #0f172a; font-weight: 700;">${val !== null ? val : '-'}</td>
              </tr>
              <tr style="background: #ffffff; border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 5px 8px; color: #475569; font-family: ui-monospace, monospace;">Rentang Data</td>
                <td style="padding: 5px 8px; color: #0f172a;">${raster.min_val ?? '-'} s/d ${raster.max_val ?? '-'}</td>
              </tr>
              <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 5px 8px; color: #475569; font-family: ui-monospace, monospace;">Dimensi Citra</td>
                <td style="padding: 5px 8px; color: #0f172a;">${raster.width} &times; ${raster.height} px</td>
              </tr>
              <tr style="background: #ffffff;">
                <td style="padding: 5px 8px; color: #475569; font-family: ui-monospace, monospace;">Jumlah Band</td>
                <td style="padding: 5px 8px; color: #0f172a;">${raster.bands_count} Band</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;

      return wrapper;
    },
    []
  );

  // 1. Inisialisasi Leaflet Map sekali saat mount (JANGAN pernah bergantung pada [layers] agar peta tidak hancur setiap filter berubah!)
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function initLeaflet() {
      if (!mapContainerRef.current || mapRef.current) return;

      const L = (await import('leaflet')).default;
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      leafletRef.current = L;

      // Cari initial center dari layer yang aktif jika ada
      const initLayers = layersRef.current;
      const initialLayerWithBbox =
        initLayers.find((l) => l.terlihat && l.bbox) || initLayers.find((l) => l.bbox);
      let initCenter: [number, number] = [-7.6668, 112.9125]; // Default ke Kebun Bakalan
      const initZoom = 15;
      if (initialLayerWithBbox?.bbox) {
        initCenter = [
          (initialLayerWithBbox.bbox[1] + initialLayerWithBbox.bbox[3]) / 2,
          (initialLayerWithBbox.bbox[0] + initialLayerWithBbox.bbox[2]) / 2,
        ];
      }

      const map = L.map(mapContainerRef.current, {
        center: initCenter,
        zoom: initZoom,
        minZoom: 2,
        maxZoom: 21,
        zoomControl: false,
        preferCanvas: true,
      });

      // Kontrol Zoom di kanan bawah
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Kontrol Skala di kiri bawah sesuai referensi RPN
      L.control
        .scale({
          position: 'bottomleft',
          metric: true,
          imperial: true,
          maxWidth: 120,
        })
        .addTo(map);

      // Tile layer basemap awal: Citra Satelit HD (Google 2x Retina 512px) agar tajam sampai zoom 21
      const defaultStyle = BASEMAP_STYLES.google_sat;
      const baseTile = L.tileLayer(defaultStyle.url, {
        attribution: defaultStyle.attribution,
        maxNativeZoom: defaultStyle.maxNativeZoom,
        maxZoom: defaultStyle.maxZoom,
        subdomains: defaultStyle.subdomains || 'abc',
        keepBuffer: 4,
      }).addTo(map);
      baseTile.bringToBack();
      baseTileLayerRef.current = baseTile;

      // Group untuk layer raster
      const rasterGrp = L.layerGroup().addTo(map);
      rasterGroupRef.current = rasterGrp;

      // Group untuk outline batas administratif Filter Wilayah (di bawah vektor blok agar blok tetap interaktif)
      const wilayahGrp = L.layerGroup().addTo(map);
      wilayahGroupRef.current = wilayahGrp;

      // Group untuk layer GeoJSON vektor
      const geoGrp = L.layerGroup().addTo(map);
      geoJsonGroupRef.current = geoGrp;

      // Group untuk live drawing tool (Pensil Digitasi Lahan)
      const drawGrp = L.layerGroup().addTo(map);
      drawGroupRef.current = drawGrp;

      // Group untuk pin marker hasil pencarian lokasi
      const searchGrp = L.layerGroup().addTo(map);
      searchGroupRef.current = searchGrp;

      mapRef.current = map;
      setMapReady(true);

      // Resize observer
      resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    initLeaflet();

    return () => {
      cancelled = true;
      wilayahAbortRef.current?.abort();
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  // 2. Event Listener Map untuk Menggambar (Tool Pensil) dan Inspeksi Piksel
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (isDrawingMode) {
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.getContainer().style.cursor = '';
    }

    const handleMapClick = async (e: LType.LeafletMouseEvent) => {
      // Jika mode gambar aktif: tambahkan titik koordinat baru
      if (isDrawingMode) {
        setDrawingPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
        return;
      }

      // Mode Normal: Periksa klik piksel citra raster jika melingkupi titik klik
      const visibleRasters = rasterLayers.filter((r) => r.terlihat && r.bbox);
      const clickedRaster = visibleRasters.find((r) => {
        if (!r.bbox) return false;
        const [minX, minY, maxX, maxY] = r.bbox;
        return (
          e.latlng.lng >= minX &&
          e.latlng.lng <= maxX &&
          e.latlng.lat >= minY &&
          e.latlng.lat <= maxY
        );
      });

      if (!clickedRaster) return;

      try {
        setInspectingPixel(true);
        const res = await fetch(
          `/api/gis/rasters/${clickedRaster.id}/identify?lng=${e.latlng.lng}&lat=${e.latlng.lat}`
        );
        if (res.ok) {
          const json = await res.json();
          if (json.data && json.data.found) {
            const L = leafletRef.current;
            if (!L) return;

            const popupEl = buildRasterPopupElement(clickedRaster, json.data, e.latlng);
            L.popup({
              className: 'monitoring-leaflet-popup',
              maxWidth: 360,
              minWidth: 300,
              closeButton: true,
              autoPan: true,
              autoPanPaddingTopLeft: [60, 60],
              autoPanPaddingBottomRight: [60, 60],
              keepInView: false,
              offset: [0, -12],
            })
              .setLatLng(e.latlng)
              .setContent(popupEl)
              .openOn(map);
          }
        }
      } catch (err) {
        console.warn('Raster pixel inspection error:', err);
      } finally {
        setInspectingPixel(false);
      }
    };

    const handleMouseMove = (e: LType.LeafletMouseEvent) => {
      if (isDrawingMode) {
        setMouseLatLng([e.latlng.lat, e.latlng.lng]);
      }
    };

    const handleDblClick = (e: LType.LeafletMouseEvent) => {
      if (isDrawingMode) {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        if (drawingPoints.length >= 3) {
          setIsCreateModalOpen(true);
        }
      }
    };

    map.on('click', handleMapClick);
    map.on('mousemove', handleMouseMove);
    map.on('dblclick', handleDblClick);

    return () => {
      map.off('click', handleMapClick);
      map.off('mousemove', handleMouseMove);
      map.off('dblclick', handleDblClick);
    };
  }, [isDrawingMode, drawingPoints, rasterLayers, mapReady, buildRasterPopupElement]);

  // 3. Render Visualisasi Interaktif Mode Gambar (Pencil Digitize Preview)
  useEffect(() => {
    const L = leafletRef.current;
    const group = drawGroupRef.current;
    if (!L || !group) return;

    group.clearLayers();

    if (!isDrawingMode || drawingPoints.length === 0) return;

    // Gambar titik sudut (vertices)
    drawingPoints.forEach((pt, idx) => {
      const isFirst = idx === 0;
      const marker = L.circleMarker(pt, {
        radius: isFirst ? 7 : 5,
        fillColor: isFirst ? '#10b981' : '#00f5ff',
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      });

      if (isFirst) {
        marker.bindTooltip('Titik Awal (Klik untuk menutup poligon)', {
          permanent: false,
          direction: 'top',
        });
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (drawingPoints.length >= 3) {
            setIsCreateModalOpen(true);
          }
        });
      }

      marker.addTo(group);
    });

    // Gambar garis batas poligon yang sudah dibuat
    if (drawingPoints.length >= 2) {
      L.polyline(drawingPoints, {
        color: '#00f5ff',
        weight: 3,
        dashArray: '4, 4',
      }).addTo(group);
    }

    // Jika ada mouse position: gambar garis karet dinamis (rubberband) ke kursor
    if (mouseLatLng && drawingPoints.length > 0) {
      const lastPoint = drawingPoints[drawingPoints.length - 1];
      L.polyline([lastPoint, mouseLatLng], {
        color: '#34d399',
        weight: 2,
        dashArray: '3, 6',
      }).addTo(group);

      // Garis penutup ke titik pertama jika sudah >= 2 titik
      if (drawingPoints.length >= 2) {
        L.polyline([mouseLatLng, drawingPoints[0]], {
          color: '#f59e0b',
          weight: 1.5,
          dashArray: '2, 4',
        }).addTo(group);
      }
    }

    // Gambar poligon transparan jika >= 3 titik
    if (drawingPoints.length >= 3) {
      L.polygon(drawingPoints, {
        color: '#10b981',
        weight: 2.5,
        fillColor: '#10b981',
        fillOpacity: 0.25,
      }).addTo(group);
    }
  }, [isDrawingMode, drawingPoints, mouseLatLng]);

  // 4. Render layer RASTER (GeoTIFF Overlay)
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const group = rasterGroupRef.current;
    if (!map || !L || !group || !mapReady) return;

    group.clearLayers();

    for (const raster of rasterLayers) {
      if (!raster.terlihat || !raster.bbox) continue;

      const [minX, minY, maxX, maxY] = raster.bbox;
      const bounds: LType.LatLngBoundsExpression = [
        [minY, minX],
        [maxY, maxX],
      ];

      const overlayUrl = raster.preview_url || `/api/gis/rasters/${raster.id}/preview`;

      const imageOverlay = L.imageOverlay(overlayUrl, bounds, {
        opacity: raster.transparansi ?? 0.85,
        interactive: true,
        alt: raster.nama_layer,
      });

      imageOverlay.addTo(group);
    }
  }, [rasterLayers, mapReady]);

  // 5. Render layer VEKTOR GeoJSON
  useEffect(() => {
    const mapInstance = mapRef.current;
    const LInstance = leafletRef.current;
    const groupInstance = geoJsonGroupRef.current;
    if (!mapInstance || !LInstance || !groupInstance || !mapReady) return;

    let ignore = false;

    async function renderVectorLayers(
      map: LType.Map,
      L: typeof LType,
      group: LType.LayerGroup
    ) {
      setLoadingLayers(true);
      group.clearLayers();

      // Urutkan layer agar batas luar (1 poligon perimeter) dirender di BAWAH petak blok, sehingga outline & klik selalu rapi
      const visibleLayers = [...layers.filter((l) => l.terlihat)].sort((a, b) => {
        const aOuter = a.jumlah_fitur <= 1 ? 0 : 1;
        const bOuter = b.jumlah_fitur <= 1 ? 0 : 1;
        return aOuter - bOuter;
      });

      const combinedAfdelingBounds = L.latLngBounds([]);

      for (const layer of visibleLayers) {
        let geojsonData = geojsonCacheRef.current.get(layer.id);

        if (!geojsonData) {
          try {
            const res = await fetch(`/api/gis/geojson?layer_id=${layer.id}`);
            if (res.ok) {
              const json = await res.json();
              if (json.data && !ignore) {
                geojsonData = json.data as GeoJSON.FeatureCollection;
                geojsonCacheRef.current.set(layer.id, geojsonData);
              }
            }
          } catch (err) {
            console.error(`Gagal memuat GeoJSON layer ${layer.nama_layer}:`, err);
          }
        }

        if (ignore || !geojsonData) continue;

        const isOuterBoundaryLayer =
          layer.jumlah_fitur <= 1 ||
          (geojsonData.features?.length === 1 &&
            /batas|kebun|perimeter|konsesi|sarongge$/i.test(layer.nama_layer));

        // Styling outline rapi & presisi standar ArcGIS Pro
        let strokeColor = layer.warna || '#be185d';
        let strokeWidth = 2.2;

        const layerNameLower = layer.nama_layer.toLowerCase();
        if (isOuterBoundaryLayer) {
          strokeColor = '#f43f5e'; // Rose tegas untuk batas luar konsesi
          strokeWidth = 2.8;
        } else if (layerNameLower.includes('kebun')) {
          strokeColor = '#00d2ff';
          strokeWidth = 2.2;
        } else if (layerNameLower.includes('afdeling')) {
          strokeColor = '#65a30d';
          strokeWidth = 2.4;
        } else if (layerNameLower.includes('blok')) {
          strokeColor = '#10b981';
          strokeWidth = 2.0;
        }

        const defaultFillColor = strokeColor;

        const geoJsonLayer = L.geoJSON(geojsonData, {
          filter: (feature) => {
            if (
              selectedAfdelingId &&
              !isFeatureMatchingAfdeling(feature, selectedAfdelingId, afdelingList, layer.kebun_id)
            ) {
              return false;
            }
            if (!statusFilter || statusFilter === 'all') return true;
            const featId = Number(feature?.id || feature?.properties?._feature_id || 0);
            const rkap = getFeatureRkapClassification(featId, (feature?.properties || {}) as Record<string, unknown>);
            if (statusFilter === 'ktg') return rkap.category === 'optimal';
            if (statusFilter === 'ks_gpa') return rkap.category === 'warning' || rkap.category === 'critical';
            return true;
          },
          style: (feature) => {
            const featId = Number(feature?.id || feature?.properties?._feature_id || 0);
            const isSelected = selectedFeatureId !== null && featId === selectedFeatureId;
            const geomType = feature?.geometry?.type || layer.tipe_geometri;
            const isLine = geomType === 'LineString' || geomType === 'MultiLineString';

            if (isSelected) {
              return {
                color: '#00f5ff',
                weight: 3.8,
                opacity: 1,
                dashArray: '7, 5',
                lineJoin: 'round',
                lineCap: 'round',
                className: 'selected-feature-pulse',
                fillColor: '#00f5ff',
                fillOpacity: isOutlineOnly ? 0.12 : 0.38,
              };
            }

            if (isLine) {
              return {
                color: layer.warna || '#f59e0b',
                weight: 3,
                opacity: 0.95,
                lineJoin: 'round',
                lineCap: 'round',
              };
            }

            // Layer Batas Luar (1 poligon konsesi): outline putus-putus rapi & transparan agar tidak menutupi blok di dalamnya
            if (isOuterBoundaryLayer) {
              return {
                color: '#f43f5e',
                weight: 2.8,
                opacity: 0.95,
                dashArray: '8, 5',
                lineJoin: 'round',
                lineCap: 'round',
                fillColor: '#f43f5e',
                fillOpacity: isOutlineOnly ? 0 : 0.06,
              };
            }

            // Mode Simbologi Tematik RKAP / Klaster Afdeling ala ArcGIS Pro (garis tajam, fill jernih)
            if (symbologyMode === 'rkap') {
              const rkap = getFeatureRkapClassification(featId, (feature?.properties || {}) as Record<string, unknown>);
              return {
                color: rkap.color,
                weight: isOutlineOnly ? 2.8 : selectedAfdelingId ? 2.8 : 2.1,
                opacity: 0.98,
                lineJoin: 'round',
                lineCap: 'round',
                fillColor: rkap.color,
                fillOpacity: isOutlineOnly ? 0 : 0.26,
              };
            }

            return {
              color: strokeColor,
              weight: strokeWidth,
              opacity: 0.98,
              lineJoin: 'round',
              lineCap: 'round',
              fillColor: defaultFillColor,
              fillOpacity: isOutlineOnly ? 0 : 0.24,
            };
          },
          pointToLayer: (feature, latlng) => {
            const featId = Number(feature?.id || feature?.properties?._feature_id || 0);
            const isSelected = selectedFeatureId !== null && featId === selectedFeatureId;
            let pColor = strokeColor;
            if (symbologyMode === 'rkap') {
              pColor = getFeatureRkapClassification(featId, (feature?.properties || {}) as Record<string, unknown>).color;
            }
            return L.circleMarker(latlng, {
              radius: isSelected ? 8 : 6,
              fillColor: isSelected ? '#00f5ff' : pColor,
              color: '#ffffff',
              weight: 2,
              opacity: 1,
              fillOpacity: 0.9,
            });
          },
          onEachFeature: (feature, featureLayer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            const featId = Number(feature.id || props._feature_id || 0);

            // Hover effect: pertebal garis batas secara halus dan rapi
            featureLayer.on('mouseover', () => {
              if ('setStyle' in featureLayer && typeof featureLayer.setStyle === 'function') {
                (featureLayer as LType.Path).setStyle({
                  weight: 3.8,
                  opacity: 1,
                });
              }
            });
            featureLayer.on('mouseout', () => {
              if ('resetStyle' in geoJsonLayer && typeof geoJsonLayer.resetStyle === 'function') {
                geoJsonLayer.resetStyle(featureLayer as LType.Path);
              }
            });

            // Label permanen (Nama Blok + Luas Ha) jika toggle Labels aktif
            if (showLabels) {
              const labelIntel = extractFeatureIntel(props, {
                featId,
                layerName: layer.nama_layer,
                namaKebun: layer.nama_kebun,
                wilayah: layer.wilayah,
                isSingleBoundaryLayer: layer.jumlah_fitur === 1,
              });
              const hasRealName =
                !labelIntel.blokName.startsWith('Blok #') &&
                !labelIntel.blokName.startsWith('Petak ');
              const luasLabel =
                labelIntel.luasUkurHa > 0
                  ? `${labelIntel.luasUkurHa.toLocaleString('id-ID', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} Ha`
                  : '';
              const labelText = hasRealName
                ? luasLabel
                  ? `${labelIntel.shortName} · ${luasLabel}`
                  : labelIntel.shortName
                : luasLabel;

              if (labelText) {
                featureLayer.bindTooltip(labelText, {
                  permanent: true,
                  direction: 'center',
                  className: 'leaflet-gis-label',
                });
              }
            }

            // Interaksi klik fitur: tampilkan popup RPN
            featureLayer.on('click', (e: LType.LeafletMouseEvent) => {
              L.DomEvent.stopPropagation(e);

              if (featId && onSelectFeatureRef.current) {
                onSelectFeatureRef.current(featId, layer.id);
              }

              let featBounds: LType.LatLngBounds | null = null;
              if ('getBounds' in featureLayer && typeof featureLayer.getBounds === 'function') {
                featBounds = (featureLayer as LType.Polygon | LType.Polyline).getBounds();
              }

              const popupLatLng =
                featBounds && featBounds.isValid() ? featBounds.getCenter() : e.latlng;

              // Pusatkan peta ke tengah poligon/wilayah yang diklik
              map.panTo(popupLatLng, { animate: true, duration: 0.35 });

              const popupEl = buildPopupElement(
                map,
                featBounds,
                popupLatLng,
                props,
                layer,
                featId
              );

              L.popup({
                className: 'monitoring-leaflet-popup',
                maxWidth: 380,
                minWidth: 320,
                closeButton: true,
                autoPan: false,
                keepInView: false,
                offset: [0, -14],
              })
                .setLatLng(popupLatLng)
                .setContent(popupEl)
                .openOn(map);
            });
          },
        });

        geoJsonLayer.addTo(group);

        // Akumulasi bounds gabungan khusus fitur yang lolos filter Afdeling (tanpa kotak persegi L.rectangle yang menutupi peta!)
        if (selectedAfdelingId) {
          const afdBnds = geoJsonLayer.getBounds();
          if (afdBnds.isValid()) {
            combinedAfdelingBounds.extend(afdBnds);
          }
        }
      }

      if (ignore) return;

      // Arahkan peta 1 kali ke gabungan seluruh poligon Afdeling terpilih (cegah lompat ke kebun/wilayah lain!)
      if (selectedAfdelingId && combinedAfdelingBounds.isValid()) {
        map.stop();
        map.fitBounds(combinedAfdelingBounds, {
          padding: [55, 55],
          maxZoom: 17,
          animate: true,
        });
      }

      // Auto-fit awal jika belum pernah auto-fit
      if (!initialAutoFitDoneRef.current && !selectedAfdelingId && !selectedWilayahRef.current && (visibleLayers.length > 0 || rasterLayers.length > 0)) {
        const firstVector = visibleLayers.find((l) => l.bbox);
        const firstRaster = rasterLayers.find((r) => r.bbox);
        const targetBbox = firstVector?.bbox || firstRaster?.bbox;
        if (targetBbox) {
          initialAutoFitDoneRef.current = true;
          zoomToBounds(targetBbox);
        }
      }

      setLoadingLayers(false);
    }

    renderVectorLayers(mapInstance, LInstance, groupInstance);

    return () => {
      ignore = true;
    };
  }, [
    layers,
    rasterLayers,
    showLabels,
    isOutlineOnly,
    symbologyMode,
    statusFilter,
    selectedAfdelingId,
    afdelingList,
    selectedFeatureId,
    mapReady,
    buildPopupElement,
    zoomToBounds,
    dataRevision,
  ]);

  // Bersihkan cache layer jika ada perubahan/penghapusan fitur dari luar
  useEffect(() => {
    geojsonCacheRef.current.clear();
  }, [dataRevision]);

  // 6. FitBounds target jika diperbarui dari luar
  useEffect(() => {
    if (fitBoundsTarget && mapReady) {
      zoomToBounds(fitBoundsTarget);
    }
  }, [fitBoundsTarget, mapReady, zoomToBounds]);

  // 7. Outline Batas Administratif & Auto-Navigation saat Filter Wilayah dipilih
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const group = wilayahGroupRef.current;
    if (!map || !L || !group || !mapReady) return;

    wilayahAbortRef.current?.abort();
    group.clearLayers();

    const targetWilayah = selectedWilayah?.trim();
    if (!targetWilayah) {
      return;
    }

    const controller = new AbortController();
    wilayahAbortRef.current = controller;

    async function loadWilayahOutline() {
      setIsLoadingBoundary(true);
      try {
        const res = await fetchWilayahBoundary(targetWilayah, controller.signal);
        if (controller.signal.aborted || !res?.boundary) return;
        const activeGroup = wilayahGroupRef.current;
        const activeMap = mapRef.current;
        const activeL = leafletRef.current;
        if (!activeGroup || !activeMap || !activeL) return;

        activeGroup.clearLayers();

        // Outline batas wilayah rapi dengan sudut halus: halo putih tipis + garis putus-putus merah
        const halo = activeL.geoJSON(res.boundary as GeoJSON.GeoJsonObject, {
          interactive: false,
          style: {
            color: '#ffffff',
            weight: 4.5,
            opacity: 0.35,
            lineJoin: 'round',
            lineCap: 'round',
            fill: false,
          },
        });
        const outline = activeL.geoJSON(res.boundary as GeoJSON.GeoJsonObject, {
          interactive: false,
          style: {
            color: '#EF4444',
            weight: 2.5,
            opacity: 0.95,
            dashArray: '10 6',
            lineJoin: 'round',
            lineCap: 'round',
            fillColor: '#EF4444',
            fillOpacity: 0.04,
          },
        });
        halo.addTo(activeGroup);
        outline.addTo(activeGroup);

        // Jika wilayah belum memiliki layer ber-bbox di PostGIS, arahkan peta langsung ke batas administratif wilayah
        const hasLayerBbox = layersRef.current.some(
          (l) => Array.isArray(l.bbox) && l.bbox.length === 4
        );
        if (!hasLayerBbox) {
          const b = outline.getBounds();
          if (b.isValid()) {
            activeMap.stop();
            activeMap.fitBounds(b, { padding: [45, 45], maxZoom: 14, animate: true });
          } else if (res.bbox) {
            zoomToBounds(res.bbox);
          }
        }
      } catch {
        // ignore abort or network hiccup
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingBoundary(false);
        }
      }
    }

    loadWilayahOutline();

    return () => {
      controller.abort();
    };
  }, [selectedWilayah, mapReady, zoomToBounds]);

  // Handler Drawing Toolbar
  const handleUndoPoint = () => {
    setDrawingPoints((prev) => prev.slice(0, -1));
  };

  const handleCancelDrawing = () => {
    setIsDrawingMode(false);
    setDrawingPoints([]);
    setMouseLatLng(null);
  };

  const handleFinishDrawing = () => {
    if (drawingPoints.length >= 3) {
      setIsCreateModalOpen(true);
    }
  };

  // Konversi koordinat Leaflet [lat, lng] -> GeoJSON [lng, lat]
  const completedGeoJsonCoords = drawingPoints.map(
    (pt) => [Number(pt[1].toFixed(7)), Number(pt[0].toFixed(7))] as [number, number]
  );
  const calculatedAreaHa = calculatePolygonAreaHa(drawingPoints);

  // Ganti Basemap
  const handleSelectBasemap = (key: LeafletBasemapKey) => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    setCurrentBasemap(key);
    setIsBasemapMenuOpen(false);

    if (baseTileLayerRef.current) {
      map.removeLayer(baseTileLayerRef.current);
      baseTileLayerRef.current = null;
    }
    if (hdDetailLayerRef.current) {
      map.removeLayer(hdDetailLayerRef.current);
      hdDetailLayerRef.current = null;
    }

    const selectedStyle = BASEMAP_STYLES[key];
    const newBase = L.tileLayer(selectedStyle.url, {
      attribution: selectedStyle.attribution,
      maxNativeZoom: selectedStyle.maxNativeZoom,
      maxZoom: selectedStyle.maxZoom,
      subdomains: selectedStyle.subdomains || 'abc',
      keepBuffer: 4,
    }).addTo(map);
    newBase.bringToBack();
    baseTileLayerRef.current = newBase;

    // Jika memilih Esri Satellite (yang terbatas di zoom 18), tambahkan Auto-HD Booster di zoom >= 18 agar tidak pecah
    if (key === 'satellite') {
      const hdBooster = L.tileLayer(BASEMAP_STYLES.google_sat.url, {
        minZoom: 18,
        maxNativeZoom: 20,
        maxZoom: 21,
        subdomains: BASEMAP_STYLES.google_sat.subdomains,
        keepBuffer: 4,
      }).addTo(map);
      hdDetailLayerRef.current = hdBooster;
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!mapContainerRef.current) return;
    if (!document.fullscreenElement) {
      mapContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Pencarian bertahap: data internal (server) + alamat/wilayah (Photon + Esri + BIG Geoservices)
  const skipNextSearchRef = useRef(false);
  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    const q = searchQuery.trim();
    if (q.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearching(true);
      setIsSearchDropdownOpen(true);

      // Tahap 1 (~200ms): data internal PostGIS + Photon + Esri ArcGIS Geocoder
      const [local, places] = await Promise.allSettled([
        searchLocalData(q, controller.signal),
        searchPlaces(q, controller.signal),
      ]);
      if (controller.signal.aborted) return;

      const initialPlaces = places.status === 'fulfilled' ? places.value : [];
      setLocalResults(local.status === 'fulfilled' ? local.value : []);
      setPlaceResults(initialPlaces);
      setIsSearching(false);

      // Tahap 2 (progresif): Database resmi BIG (83.000+ Desa/Kelurahan & Kecamatan se-Indonesia)
      searchBigAdmin(q, controller.signal)
        .then((bigResults) => {
          if (controller.signal.aborted || bigResults.length === 0) return;
          setPlaceResults((prev) => mergePlaceResults([prev, bigResults]));
        })
        .catch(() => {});
    }, 320);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  // Click outside listener untuk menutup dropdown pencarian
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Pin penanda + popup "Buat Lahan di Sini"
  const addSearchPin = (loc: MapSearchResult, openPopup: boolean) => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const group = searchGroupRef.current;
    if (!map || !L || !group) return;
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || (loc.lat === 0 && loc.lng === 0)) {
      return;
    }

    const customIcon = L.divIcon({
      className: 'gis-search-pin-icon',
      html: `
        <div style="position: relative; width: 34px; height: 34px;">
          <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 32px; height: 32px; background: rgba(0, 210, 255, 0.35); border-radius: 50%; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; background: #00d2ff; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 12px #00d2ff;"></div>
        </div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

    const marker = L.marker([loc.lat, loc.lng], { icon: customIcon });
    const popupDiv = document.createElement('div');
    popupDiv.style.cssText =
      'background: #0d1322; color: #f0f6fc; padding: 12px; border-radius: 8px; border: 1px solid #00d2ff; min-width: 240px; font-family: ui-sans-serif, system-ui, sans-serif;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px;';
    const badge = document.createElement('span');
    badge.style.cssText =
      'font-size:9px;font-weight:800;text-transform:uppercase;color:#00d2ff;background:#0e3a5d;padding:2px 6px;border-radius:4px;border:1px solid #00b4d8;';
    badge.textContent = loc.badge;
    const coords = document.createElement('span');
    coords.style.cssText = 'font-size:10px;color:#8b9bb4;font-family:monospace;font-variant-numeric:tabular-nums;';
    coords.textContent = `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
    header.append(badge, coords);

    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;font-weight:700;color:#ffffff;margin-bottom:3px;';
    title.textContent = loc.name;
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#8b9bb4;line-height:1.35;margin-bottom:12px;';
    desc.textContent = loc.description;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText =
      'width:100%;background:#00d2ff;color:#0a0e1a;font-weight:800;font-size:11px;padding:7px 10px;border-radius:6px;border:none;cursor:pointer;';
    btn.textContent = '+ Buat Lahan di Sini';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      map.closePopup();
      setIsDrawingMode(true);
      setDrawingPoints([]);
    });

    popupDiv.append(header, title, desc, btn);
    // autoPan: false agar tidak membatalkan animasi flyTo / fitBounds Leaflet di tengah jalan!
    marker.bindPopup(popupDiv, {
      className: 'monitoring-leaflet-popup',
      closeButton: true,
      autoPan: false,
      offset: [0, -8],
    });
    marker.addTo(group);
    if (openPopup) marker.openPopup();
  };

  const fitToBbox = (bbox: [number, number, number, number], maxZoom: number) => {
    const map = mapRef.current;
    if (!map) return;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    map.stop();
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { maxZoom, padding: [50, 50], animate: true }
    );
  };

  // Handler saat salah satu hasil pencarian dipilih
  const handleSelectLocation = async (loc: MapSearchResult) => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const group = searchGroupRef.current;
    if (!map || !L || !group) return;

    boundaryAbortRef.current?.abort();
    skipNextSearchRef.current = true;
    setSearchQuery(loc.name);
    setActiveLocationPin(loc);
    setIsSearchDropdownOpen(false);
    group.clearLayers();
    map.closePopup();

    // A. Data internal: zoom ke lahan/layer/raster, nyalakan layer bila tersembunyi, pilih & highlight fiturnya
    if (loc.kind === 'feature' || loc.kind === 'layer' || loc.kind === 'raster') {
      if (loc.kind === 'raster' && loc.rasterId && loc.layerVisible === false) {
        onToggleRasterVisibility?.(loc.rasterId, true);
      } else if (loc.layerId && loc.layerVisible === false) {
        onToggleLayerVisibility?.(loc.layerId, true);
      }
      if (loc.bbox) fitToBbox(loc.bbox, loc.kind === 'feature' ? 18 : 17);
      if (loc.kind === 'feature' && loc.geometry) {
        const featOutline = L.geoJSON(loc.geometry, {
          interactive: false,
          style: {
            color: '#00D2FF',
            weight: 3.5,
            opacity: 1,
            dashArray: '6 4',
            fillColor: '#00D2FF',
            fillOpacity: 0.18,
          },
        });
        featOutline.addTo(group);
      }
      addSearchPin(loc, false);
      onSelectFeatureRef.current?.(loc.kind === 'feature' ? loc.featureId ?? null : null, loc.layerId);
      return;
    }

    // B. Koordinat GPS
    if (loc.kind === 'coordinate') {
      map.stop();
      map.setView([loc.lat, loc.lng], 17, { animate: true });
      addSearchPin(loc, true);
      return;
    }

    // C. Alamat / wilayah: arahkan ke wilayah & gambar outline batas zona (4-Tier Boundary Engine)
    if (loc.kind !== 'place') return;
    if (loc.bbox) {
      fitToBbox(loc.bbox, 16);
    } else if (loc.lat !== 0 || loc.lng !== 0) {
      map.stop();
      map.setView([loc.lat, loc.lng], 15, { animate: true });
    }

    const controller = new AbortController();
    boundaryAbortRef.current = controller;
    setIsLoadingBoundary(true);
    const boundary = await fetchBoundary(loc, controller.signal);
    if (controller.signal.aborted) return;
    setIsLoadingBoundary(false);

    let resolvedLoc: PlaceSearchResult = loc;
    if (boundary) {
      const computedBbox = computeGeoJsonBbox(boundary);
      if (computedBbox && (loc.lat === 0 && loc.lng === 0)) {
        resolvedLoc = {
          ...loc,
          lat: (computedBbox[1] + computedBbox[3]) / 2,
          lng: (computedBbox[0] + computedBbox[2]) / 2,
          bbox: computedBbox,
        };
        setActiveLocationPin(resolvedLoc);
      }

      // Outline batas wilayah ala Google Maps: halo putih + garis putus-putus merah tegas + isian tipis
      const halo = L.geoJSON(boundary as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: { color: '#ffffff', weight: 5.5, opacity: 0.4, fill: false },
      });
      const outline = L.geoJSON(boundary as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: {
          color: '#EF4444',
          weight: 3,
          opacity: 1,
          dashArray: '8 5',
          fillColor: '#EF4444',
          fillOpacity: 0.08,
        },
      });
      halo.addTo(group);
      outline.addTo(group);
      const b = outline.getBounds();
      if (b.isValid()) {
        map.stop();
        map.fitBounds(b, { padding: [45, 45], maxZoom: 16, animate: true });
      }
    }

    addSearchPin(resolvedLoc, false);
  };

  const handleClearLocation = () => {
    boundaryAbortRef.current?.abort();
    setIsLoadingBoundary(false);
    setActiveLocationPin(null);
    setSearchQuery('');
    setLocalResults([]);
    setPlaceResults([]);
    setIsSearchDropdownOpen(false);
    searchGroupRef.current?.clearLayers();
    mapRef.current?.closePopup();
  };

  const handleStartDrawAtLocation = () => {
    setIsDrawingMode(true);
    setDrawingPoints([]);
    mapRef.current?.closePopup();
  };

  const allSearchResults: MapSearchResult[] = [...localResults, ...placeResults];

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      {/* Leaflet Map Viewport */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* 1. MAP SEARCH & LOCATION LOCATOR BAR (Pencarian Lokasi Global & Regional Indonesia) */}
      <div
        ref={searchContainerRef}
        className="absolute top-3 left-3 z-[1000] w-48 sm:w-56 md:w-64 select-text"
      >
        <div className="relative flex items-center bg-[#0D1322]/95 backdrop-blur-md border border-[#1E2942] focus-within:border-[#00D2FF] rounded-lg shadow-xl transition-all">
          <div className="pl-2.5 text-[#00D2FF]">
            {isSearching ? (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <IconSearch className="w-3.5 h-3.5" />
            )}
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              const val = e.target.value;
              setSearchQuery(val);
              if (val.trim().length < 2) {
                setLocalResults([]);
                setPlaceResults([]);
                setIsSearching(false);
              }
            }}
            onFocus={() => {
              if (allSearchResults.length > 0) setIsSearchDropdownOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && allSearchResults.length > 0) {
                handleSelectLocation(allSearchResults[0]);
              } else if (e.key === 'Escape') {
                setIsSearchDropdownOpen(false);
              }
            }}
            placeholder="Cari Lokasi..."
            className="w-full bg-transparent text-[#F0F6FC] placeholder-[#566680] text-xs py-1.5 pl-2 pr-7 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearLocation}
              className="absolute right-2.5 p-1 text-[#8B9BB4] hover:text-[#EF4444] rounded transition-colors cursor-pointer"
              title="Bersihkan pencarian dan batas wilayah"
            >
              <IconClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dropdown hasil: data internal dulu, lalu wilayah/alamat */}
        {isSearchDropdownOpen && (
          <div className="mt-1.5 bg-[#0D1322] border border-[#1E2942] rounded-xl shadow-2xl overflow-hidden max-h-80 overflow-y-auto">
            {allSearchResults.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#566680]">
                {isSearching
                  ? 'Mencari…'
                  : 'Tidak ditemukan. Coba tulis bertingkat, misalnya "Kabupaten Bogor, Dramaga".'}
              </div>
            ) : (
              <>
                {localResults.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 bg-[#12192B] border-b border-[#1E2942] text-[10px] font-semibold text-[#8B9BB4] tabular-nums">
                      Data kebun Anda ({localResults.length})
                    </div>
                    {localResults.map((loc) => (
                      <SearchResultRow key={loc.id} loc={loc} onSelect={handleSelectLocation} accent="#10B981" />
                    ))}
                  </div>
                )}
                {placeResults.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 bg-[#12192B] border-y border-[#1E2942] text-[10px] font-semibold text-[#8B9BB4] tabular-nums">
                      Wilayah &amp; alamat ({placeResults.length})
                    </div>
                    {placeResults.map((loc) => (
                      <SearchResultRow key={loc.id} loc={loc} onSelect={handleSelectLocation} accent="#00D2FF" />
                    ))}
                  </div>
                )}
                {isSearching && (
                  <div className="px-3 py-1.5 text-[10px] text-[#566680] border-t border-[#1E2942]">Memperbarui hasil…</div>
                )}
              </>
            )}
          </div>
        )}

        {/* Active Location Banner with 1-Click "Buat Lahan di Sini" */}
        {activeLocationPin && !isDrawingMode && (
          <div className="mt-2 bg-[#0E3A5D]/95 backdrop-blur-md border border-[#00B4D8] rounded-xl p-2.5 shadow-xl flex items-center justify-between gap-2 text-xs animate-in fade-in slide-in-from-top-1">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-[#7DD3FC] font-bold uppercase tracking-wider flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#00D2FF] animate-pulse" />
                <span>{isLoadingBoundary ? 'Memuat batas wilayah…' : 'Peta terarah ke:'}</span>
              </div>
              <div className="font-bold text-white truncate text-xs">{activeLocationPin.name}</div>
              <div className="text-[10px] text-[#8B9BB4] truncate">{activeLocationPin.description}</div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleStartDrawAtLocation}
                className="bg-[#00D2FF] hover:bg-[#38BDF8] text-[#0A0E1A] font-extrabold px-3 py-1.5 rounded-lg text-xs transition-all shadow-md shadow-[#00D2FF]/20 flex items-center gap-1 cursor-pointer"
                title="Mulai Digitasi Lahan di Lokasi Ini"
              >
                <IconPencil className="w-3.5 h-3.5" />
                <span>+ Digitasi Lahan</span>
              </button>
              <button
                type="button"
                onClick={handleClearLocation}
                className="p-1 text-[#7DD3FC] hover:text-white rounded hover:bg-[#132238] transition-colors cursor-pointer"
                title="Hapus Pin Lokasi"
              >
                <IconClose className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Digitize Toolbar (Muncul saat Mode Gambar Lahan Aktif) */}
      {isDrawingMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1100] bg-[#0D1322]/95 backdrop-blur-md border border-[#00D2FF] rounded-xl shadow-2xl p-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-top-3">
          <div className="flex items-center gap-2 pr-3 border-r border-[#1E2942]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00D2FF] animate-ping" />
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#F0F6FC]">
              <IconPencil className="w-4 h-4 text-[#00D2FF]" />
              <span>Tool Gambar Lahan</span>
            </div>
          </div>

          <div className="text-[11px] text-[#8B9BB4] flex items-center gap-2">
            <span>
              Titik: <strong className="text-[#00D2FF] font-mono tabular-nums">{drawingPoints.length}</strong>
            </span>
            {drawingPoints.length >= 3 && (
              <span className="bg-[#12192B] border border-[#1E2942] px-2 py-0.5 rounded font-mono text-[#00D2FF] tabular-nums">
                Estimasi Luas: {calculatedAreaHa} Ha
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 pl-2 border-l border-[#1E2942]">
            {drawingPoints.length > 0 && (
              <button
                type="button"
                onClick={handleUndoPoint}
                className="px-2.5 py-1 bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-[#8B9BB4] hover:text-[#F0F6FC] rounded text-xs transition-colors cursor-pointer"
                title="Hapus titik terakhir"
              >
                Undo Titik
              </button>
            )}
            <button
              type="button"
              onClick={handleCancelDrawing}
              className="px-2.5 py-1 bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-[#8B9BB4] hover:text-[#EF4444] rounded text-xs transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={drawingPoints.length < 3}
              onClick={handleFinishDrawing}
              className="px-3.5 py-1 bg-[#00D2FF] hover:bg-[#38BDF8] disabled:opacity-40 text-[#0A0E1A] font-bold rounded text-xs transition-all shadow-md shadow-[#00D2FF]/20 cursor-pointer flex items-center gap-1"
              title="Tutup poligon dan buka formulir data lahan"
            >
              <IconCheck className="w-3.5 h-3.5" />
              <span>Selesai &amp; Isi Info Lahan</span>
            </button>
          </div>
        </div>
      )}

      {/* Top Right Quick Controls Toolbar (Buka / Tutup Collapsible) */}
      {!isToolbarOpen && !isDrawingMode ? (
        <div className="absolute top-3 right-3 z-[1000]">
          <button
            type="button"
            onClick={() => setIsToolbarOpen(true)}
            className="flex items-center gap-2 bg-[#0D1322]/95 hover:bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#F0F6FC] px-3 py-1.5 rounded-lg shadow-xl text-xs font-semibold backdrop-blur-md transition-all cursor-pointer group"
            title="Buka Toolbar Kontrol Peta & Gambar Lahan"
          >
            <IconPencil className="w-3.5 h-3.5 text-[#00D2FF] group-hover:scale-110 transition-transform" />
            <span>Kontrol Peta</span>
            <span className="text-[10px] text-[#00D2FF] bg-[#0E3A5D]/70 px-1.5 py-0.2 rounded font-mono">Buka ▾</span>
          </button>
        </div>
      ) : (
        <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 bg-[#0D1322]/95 backdrop-blur-md p-1 rounded-xl border border-[#1E2942] shadow-2xl animate-in fade-in zoom-in-95 duration-100">
          {/* Full Extent / Home */}
          <button
            type="button"
            onClick={() => {
              const firstLayerWithBbox = layers.find((l) => l.bbox) || rasterLayers.find((r) => r.bbox);
              if (firstLayerWithBbox?.bbox) {
                zoomToBounds(firstLayerWithBbox.bbox);
              } else if (mapRef.current) {
                mapRef.current.setView([-7.6668, 112.9125], 15, { animate: true });
              }
            }}
            className="p-1.5 rounded-md hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors cursor-pointer"
            title="Zoom ke Seluruh Extent Kebun"
          >
            <IconFullExtent className="w-4 h-4" />
          </button>

          {/* TOOL PENSIL: Digitasi Lahan Baru */}
          <button
            type="button"
            onClick={() => {
              if (isDrawingMode) {
                handleCancelDrawing();
              } else {
                setIsDrawingMode(true);
                setDrawingPoints([]);
              }
            }}
            className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
              isDrawingMode
                ? 'bg-[#00D2FF] border-[#00B4D8] text-[#0A0E1A] font-extrabold shadow-lg shadow-[#00D2FF]/20'
                : 'bg-[#12192B] border-[#1E2942] text-[#00D2FF] hover:bg-[#19233A] hover:border-[#00D2FF]'
            }`}
            title="Klik untuk mengaktifkan Tool Digitasi Poligon Lahan di Peta"
          >
            <IconPencil className="w-3.5 h-3.5" />
            <span>{isDrawingMode ? 'Mode Digitasi Aktif' : 'Digitasi'}</span>
          </button>

          {/* Panel Manajemen Layer & Konten (Vektor & Raster) */}
          <button
            type="button"
            onClick={() => setIsLayersPanelOpen((prev) => !prev)}
            className={`p-1.5 rounded-md transition-colors cursor-pointer flex items-center gap-1 ${
              isLayersPanelOpen
                ? 'bg-[#132238] border border-[#00D2FF] text-[#00D2FF]'
                : 'hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#00D2FF]'
            }`}
            title="Buka Panel Layer & Konten"
          >
            <IconLayers className="w-4 h-4" />
          </button>

          {/* ArcGIS Thematic Symbology Switch: Warna Layer Normal vs Kelas Status & Luas Shapefile */}
          <button
            type="button"
            onClick={() => setSymbologyMode((prev) => (prev === 'default' ? 'rkap' : 'default'))}
            className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
              symbologyMode === 'rkap'
                ? 'bg-[#0E3A5D] border-[#00D2FF] text-[#00D2FF] shadow-md shadow-[#00D2FF]/20'
                : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4] hover:text-[#F0F6FC]'
            }`}
            title="Alihkan mode pewarnaan: Warna Asli Layer vs Simbologi Tematik Status Lahan & Luas Blok (ArcGIS Standard)"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                symbologyMode === 'rkap' ? 'bg-[#10B981] animate-pulse' : 'bg-[#8B9BB4]'
              }`}
            />
            <span>{symbologyMode === 'rkap' ? 'Tema: Status & Luas' : 'Tema: Normal'}</span>
          </button>

          {/* Outline Mode Toggle: Fill+Outline vs Outline Saja */}
          <button
            type="button"
            onClick={() => setIsOutlineOnly((prev) => !prev)}
            className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
              isOutlineOnly
                ? 'bg-[#0E3A5D] border-[#00B4D8] text-[#7DD3FC] shadow-xs'
                : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4] hover:text-[#F0F6FC]'
            }`}
            title="Alihkan antara mode Garis Batas Saja (Outline) dan Isian Berwarna (Fill + Outline) agar citra satelit tembus pandang"
          >
            <span
              className={`w-2 h-2 rounded-xs border ${
                isOutlineOnly ? 'border-[#7DD3FC] bg-transparent' : 'border-[#00D2FF] bg-[#00D2FF]'
              }`}
            />
            <span>{isOutlineOnly ? 'Outline Saja' : 'Fill + Outline'}</span>
          </button>

          {/* Labels Toggle */}
          <button
            type="button"
            onClick={() => setShowLabels((prev) => !prev)}
            className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
              showLabels
                ? 'bg-[#132238] border-[#00D2FF] text-[#00D2FF]'
                : 'bg-[#12192B] border-[#1E2942] text-[#566680]'
            }`}
            title="Tampilkan / Sembunyikan Label Teks pada Peta"
          >
            Labels
          </button>

          {/* Basemap Switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsBasemapMenuOpen((prev) => !prev)}
              className="p-1.5 rounded-md hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors flex items-center gap-1 cursor-pointer"
              title="Pilih Peta Dasar (Basemap)"
            >
              <IconBasemap className="w-4 h-4" />
            </button>

            {isBasemapMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-52 bg-[#0D1322] border border-[#1E2942] rounded-xl shadow-2xl p-1 z-[1010] space-y-1">
                <div className="text-[10px] font-bold text-[#8B9BB4] px-2 py-1 uppercase tracking-wider">
                  Peta Dasar (Basemap)
                </div>
                {(Object.keys(BASEMAP_STYLES) as LeafletBasemapKey[]).map((key) => {
                  const s = BASEMAP_STYLES[key];
                  const isActive = currentBasemap === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectBasemap(key)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer ${
                        isActive
                          ? 'bg-[#132238] text-[#00D2FF] font-semibold'
                          : 'hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#F0F6FC]'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="truncate font-medium">{s.name}</div>
                        <div className="text-[10px] text-[#566680] truncate">{s.description}</div>
                      </div>
                      {isActive && <span className="text-[#00D2FF] font-bold shrink-0">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors cursor-pointer"
            title="Fullscreen Mode"
          >
            <IconFullscreen className="w-4 h-4" />
          </button>

          {/* Tombol Tutup Toolbar */}
          <button
            type="button"
            onClick={() => {
              setIsToolbarOpen(false);
              setIsBasemapMenuOpen(false);
            }}
            className="px-2 py-1 rounded-md hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#EF4444] transition-colors cursor-pointer border-l border-[#1E2942] ml-0.5 flex items-center gap-1 text-[11px] font-semibold"
            title="Tutup Toolbar Kontrol"
          >
            <span>✕</span>
            <span className="hidden sm:inline">Tutup</span>
          </button>
        </div>
      )}

      {/* Floating Layer & Contents Panel */}
      {isLayersPanelOpen && (
        <div className="absolute top-14 right-3 z-[1000] w-84 bg-[#0D1322]/95 backdrop-blur-md border border-[#1E2942] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh] animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="h-10 px-3.5 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconLayers className="w-4 h-4 text-[#00D2FF]" />
              <span className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider">
                Manajemen Layer GIS
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsLayersPanelOpen(false)}
              className="p-1 rounded text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] cursor-pointer"
            >
              <IconClose className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Seksi Layer Vektor */}
            <div>
              <div className="text-[10px] font-bold text-[#8B9BB4] uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Layer Vektor ({layers.length})</span>
                <span className="text-[9px] bg-[#12192B] border border-[#1E2942] px-1.5 py-0.5 rounded text-[#00D2FF] font-mono">
                  PostGIS
                </span>
              </div>
              {layers.length === 0 ? (
                <div className="text-[11px] text-[#566680] py-2 text-center">Belum ada layer vektor</div>
              ) : (
                <div className="space-y-2">
                  {layers.map((l) => (
                    <div
                      key={l.id}
                      className="bg-[#12192B] border border-[#1E2942] rounded-lg p-2.5 space-y-1.5 text-xs shadow-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <input
                            type="checkbox"
                            checked={l.terlihat}
                            onChange={(e) => onToggleLayerVisibility?.(l.id, e.target.checked)}
                            className="rounded text-[#00D2FF] focus:ring-[#00D2FF] bg-[#0A0E1A] border-[#1E2942] cursor-pointer accent-[#00D2FF]"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: l.warna || '#00D2FF' }}
                          />
                          <span className="truncate text-[#F0F6FC] font-semibold" title={l.nama_layer}>
                            {l.nama_layer}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] font-mono text-[#8B9BB4] bg-[#0A0E1A] border border-[#1E2942] px-1.5 py-0.5 rounded tabular-nums">
                            {l.jumlah_fitur} fitur
                          </span>
                          {l.bbox && (
                            <button
                              type="button"
                              onClick={() => zoomToBounds(l.bbox!)}
                              className="p-1 text-[#8B9BB4] hover:text-[#00D2FF] hover:bg-[#19233A] rounded cursor-pointer"
                              title="Zoom ke Layer"
                            >
                              <IconFullExtent className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Export Baris Layer */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#1E2942] text-[10px]">
                        <span className="text-[#8B9BB4]">Ekspor Layer:</span>
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`/api/gis/export?layer_id=${l.id}&format=geojson`}
                            target="_blank"
                            download={`${l.nama_layer}.geojson`}
                            className="px-2 py-0.5 rounded bg-[#0E3A5D] hover:bg-[#0E3A5D]/80 text-[#00D2FF] border border-[#00B4D8]/50 font-semibold transition-colors flex items-center gap-1"
                          >
                            <IconDownload className="w-3 h-3" />
                            <span>GeoJSON</span>
                          </a>
                          <a
                            href={`/api/gis/export?layer_id=${l.id}&format=kml`}
                            target="_blank"
                            download={`${l.nama_layer}.kml`}
                            className="px-2 py-0.5 rounded bg-[#132238] hover:bg-[#19233A] text-[#7DD3FC] border border-[#1E2942] font-semibold transition-colors flex items-center gap-1"
                          >
                            <IconDownload className="w-3 h-3" />
                            <span>KML</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Seksi Layer Raster */}
            <div>
              <div className="text-[10px] font-bold text-[#F59E0B] uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Layer Raster ({rasterLayers.length})</span>
                <span className="text-[9px] bg-amber-950/80 text-amber-300 border border-amber-800/60 px-1.5 py-0.5 rounded font-mono">
                  GeoTIFF
                </span>
              </div>
              {rasterLayers.length === 0 ? (
                <div className="text-[11px] text-[#566680] py-2 text-center">
                  Belum ada layer raster GeoTIFF
                </div>
              ) : (
                <div className="space-y-2">
                  {rasterLayers.map((r) => (
                    <div
                      key={r.id}
                      className="bg-[#12192B] border border-[#1E2942] rounded-lg p-2.5 space-y-2 shadow-xs"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <input
                            type="checkbox"
                            checked={r.terlihat}
                            onChange={(e) => onToggleRasterVisibility?.(r.id, e.target.checked)}
                            className="rounded text-amber-500 focus:ring-amber-500 bg-[#0A0E1A] border-[#1E2942] cursor-pointer"
                          />
                          <span className="truncate text-[#F0F6FC] font-semibold" title={r.nama_layer}>
                            {r.nama_layer}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[9px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800 px-1.5 py-0.5 rounded">
                            {r.tipe_raster}
                          </span>
                          {r.bbox && (
                            <button
                              type="button"
                              onClick={() => zoomToBounds(r.bbox!)}
                              className="p-1 text-[#8B9BB4] hover:text-[#00D2FF] hover:bg-[#19233A] rounded cursor-pointer"
                              title="Zoom ke Citra Raster"
                            >
                              <IconFullExtent className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Slider Opasitas Transparansi */}
                      <div className="flex items-center gap-2 text-[10px] text-[#8B9BB4] pt-1">
                        <span className="shrink-0">Opasitas:</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={r.transparansi ?? 0.85}
                          onChange={(e) => onChangeRasterOpacity?.(r.id, parseFloat(e.target.value))}
                          className="flex-1 accent-[#00D2FF] h-1 bg-[#0A0E1A] rounded-lg cursor-pointer"
                        />
                        <span className="font-mono w-7 text-right tabular-nums text-[#F0F6FC]">
                          {Math.round((r.transparansi ?? 0.85) * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Indikator Inspeksi / Sinkronisasi */}
      {loadingLayers && (
        <div className="absolute top-3 left-3 z-[1000] bg-slate-900/90 border border-slate-800 text-emerald-300 px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-2 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span>Memuat geometri PostGIS...</span>
        </div>
      )}

      {inspectingPixel && (
        <div className="absolute top-12 left-3 z-[1000] bg-slate-900/90 border border-amber-800 text-amber-300 px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-2 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Menginspeksi nilai piksel GeoTIFF...</span>
        </div>
      )}

      {/* Modal Pengisian Informasi Lahan Baru */}
      <CreateParcelModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setIsDrawingMode(false);
          setDrawingPoints([]);
          setMouseLatLng(null);
        }}
        coordinates={completedGeoJsonCoords}
        calculatedAreaHa={calculatedAreaHa}
        layers={layers}
        defaultLayerId={layers.find((l) => l.terlihat)?.id || layers[0]?.id}
        onSuccess={(newFeature, layerId) => {
          // Bersihkan cache layer dan refresh data
          geojsonCacheRef.current.delete(layerId);
          setIsDrawingMode(false);
          setDrawingPoints([]);
          setMouseLatLng(null);
          if (onFeatureCreated) {
            onFeatureCreated(newFeature, layerId);
          }
        }}
      />
    </div>
  );
}
