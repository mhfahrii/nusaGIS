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
import {
  searchLocalData,
  searchPlaces,
  searchBigAdmin,
  mergePlaceResults,
  fetchBoundary,
  computeGeoJsonBbox,
  type LocalSearchResult,
  type PlaceSearchResult,
  type MapSearchResult,
} from '@/lib/geoSearch';

interface MonitoringMapProps {
  layers: LayerPeta[];
  rasterLayers?: LayerRaster[];
  stats?: MonitoringStats | null;
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
}

export type LeafletBasemapKey = 'google_sat' | 'google_hybrid' | 'satellite' | 'topo' | 'osm' | 'dark';

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
  dark: {
    name: 'Dark Canvas',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    description: 'Peta latar gelap kontras',
    maxNativeZoom: 19,
    maxZoom: 21,
    subdomains: 'abcd',
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
 * Klasifikasi Simbologi Tematik ArcGIS Pro Murni dari Atribut Shapefile (.dbf / PopupInfo)
 * Mengklasifikasikan poligon blok berdasarkan Status Pengelolaan (KTG vs KS GPA) & Kelas Luas (Ha)
 * tanpa angka dummy/simulasi.
 */
export function getFeatureRkapClassification(
  _featId: number,
  props: Record<string, unknown>
): RkapClassification {
  const popupRaw = String(props.PopupInfo ?? props.popupinfo ?? '');
  const popupMap: Record<string, string> = {};
  for (const line of popupRaw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      popupMap[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }

  const rawLuas = parseFloat(
    String(props.luas ?? props.Luas ?? props.LUAS ?? props._luas_geodesik_ha ?? '0').replace(',', '.')
  );
  const luasHa = Number.isFinite(rawLuas) ? Number(rawLuas.toFixed(2)) : 0;

  const statusLahan = String(
    props['Status Lahan'] ?? props.status_lahan ?? popupMap['status lahan'] ?? ''
  ).trim();
  const varietas = String(props.Varietas ?? props.varietas ?? popupMap['varietas'] ?? '').trim();

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
  stats,
  onSelectFeature,
  selectedFeatureId,
  fitBoundsTarget,
  onToggleLayerVisibility,
  onToggleRasterVisibility,
  onChangeRasterOpacity,
  onFeatureCreated,
  onFeatureDeleted,
  dataRevision,
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
  const geojsonCacheRef = useRef<Map<number, GeoJSON.FeatureCollection>>(new Map());
  const initialAutoFitDoneRef = useRef<boolean>(false);

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
  // ArcGIS Thematic Symbology: Mode Pewarnaan Layer ('default' vs 'rkap')
  const [symbologyMode, setSymbologyMode] = useState<'default' | 'rkap'>('default');
  const [isLegendOpen, setIsLegendOpen] = useState(true);
  const [legendCounts, setLegendCounts] = useState({ optimal: 0, warning: 0, critical: 0, total: 0 });
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
        !Number.isFinite(n)
      ) {
        return;
      }
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
    } catch (err) {
      console.warn('Leaflet fitBounds warning:', err);
    }
  }, []);

  // Helper: Membangun kartu popup fitur VEKTOR bergaya RPN Monitoring Dashboard + Tombol Ekspor
  const buildPopupElement = useCallback(
    (
      map: LType.Map,
      featureBounds: LType.LatLngBounds | null,
      clickLatLng: LType.LatLng,
      properties: Record<string, unknown>,
      layer: LayerPeta,
      featId: number
    ): HTMLElement => {
      const nameVal =
        properties.kode_kebun ||
        properties.KODE_KEBUN ||
        properties.nama_kebun ||
        properties.NAMA_KEBUN ||
        properties.kode_afdeling ||
        properties.nama_afdeling ||
        properties.kode_blok ||
        properties.KODE_BLOK ||
        properties.Name ||
        properties.NAME ||
        `Fitur #${featId}`;

      const titleLabel = `Peta ${layer.nama_layer}: ${String(nameVal)}`;

      const rows = Object.entries(properties)
        .filter(([k]) => !k.startsWith('_'))
        .slice(0, 15)
        .map(
          ([k, v], idx) => `
          <tr style="background: ${idx % 2 === 0 ? '#0d1322' : '#12192b'};">
            <td style="padding: 6px 12px; color: #8b9bb4; font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; white-space: nowrap; border-bottom: 1px solid #1e2942;">${k}</td>
            <td style="padding: 6px 12px; color: #f0f6fc; font-weight: 600; font-size: 11px; text-align: left; word-break: break-all; border-bottom: 1px solid #1e2942;">${String(
              v ?? '-'
            )}</td>
          </tr>`
        )
        .join('');

      const rkapClass = getFeatureRkapClassification(featId, properties);
      const extraRkap = `
        <tr style="background: ${rkapClass.color}15; border-bottom: 1px solid ${rkapClass.color}40;">
          <td style="padding: 6px 12px; color: ${rkapClass.color}; font-size: 11px; font-weight: 700; font-family: ui-monospace, monospace;">kelas_areal</td>
          <td style="padding: 6px 12px; color: #ffffff; font-weight: 800; font-size: 11px; text-align: left;">
            <span style="background: ${rkapClass.color}25; border: 1px solid ${rkapClass.color}; color: ${rkapClass.color}; padding: 1.5px 6px; border-radius: 4px; font-size: 10px; margin-right: 6px;">
              ${rkapClass.badgeText}
            </span>
            <span style="font-size: 10px; color: #8b9bb4;">${rkapClass.statusText}</span>
          </td>
        </tr>`;

      const extraLuas = properties._luas_geodesik_ha
        ? `<tr style="background: #0e3a5d; border-bottom: 1px solid #00b4d8;">
            <td style="padding: 6px 12px; color: #7dd3fc; font-size: 11px; font-weight: 700; font-family: ui-monospace, monospace;">luas_geodesik</td>
            <td style="padding: 6px 12px; color: #00d2ff; font-weight: 800; font-size: 11px; text-align: left;">${properties._luas_geodesik_ha} Ha</td>
          </tr>`
        : '';

      const wrapper = document.createElement('div');
      wrapper.style.cssText =
        'font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; color: #f0f6fc; background: #0d1322; border: 1px solid #1e2942; border-radius: 8px; overflow: hidden; min-width: 310px; max-width: 390px; box-shadow: 0 14px 35px -4px rgba(0, 0, 0, 0.6), 0 8px 16px -4px rgba(0, 0, 0, 0.4);';

      wrapper.innerHTML = `
        <!-- Top Action Bar (Zoom to | Pan | Export) matching RPN screenshot -->
        <div style="background: #12192b; padding: 7px 12px; border-bottom: 1px solid #1e2942; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <button type="button" data-action="zoom" style="background: transparent; border: none; color: #8b9bb4; font-size: 11px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; border-radius: 3px;">
              <svg style="width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <span>Zoom to</span>
            </button>
            <button type="button" data-action="pan" style="background: transparent; border: none; color: #8b9bb4; font-size: 11px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; border-radius: 3px;">
              <svg style="width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
              <span>Pan</span>
            </button>
          </div>
          <!-- Download Links -->
          <div style="display: flex; align-items: center; gap: 6px;">
            <a href="/api/gis/export?feature_id=${featId}&format=geojson" target="_blank" download="${String(nameVal)}.geojson" style="color: #00d2ff; background: #0e3a5d; border: 1px solid #00b4d8; font-size: 10px; font-weight: 700; text-decoration: none; padding: 2px 6px; border-radius: 3px; display: inline-flex; align-items: center; gap: 3px;" title="Unduh GeoJSON">
              <svg style="width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"></path></svg>
              <span>GeoJSON</span>
            </a>
            <a href="/api/gis/export?feature_id=${featId}&format=kml" target="_blank" download="${String(nameVal)}.kml" style="color: #7dd3fc; background: #132238; border: 1px solid #1e2942; font-size: 10px; font-weight: 700; text-decoration: none; padding: 2px 6px; border-radius: 3px; display: inline-flex; align-items: center; gap: 3px;" title="Unduh KML Google Earth">
              <svg style="width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"></path></svg>
              <span>KML</span>
            </a>
            <button type="button" data-action="delete" style="color: #f87171; background: #450a0a; border: 1px solid #991b1b; font-size: 10px; font-weight: 700; cursor: pointer; padding: 2px 6px; border-radius: 3px; display: inline-flex; align-items: center; gap: 3px;" title="Hapus Lahan ini dari Database">
              <svg style="width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
              <span>Hapus</span>
            </button>
          </div>
        </div>

        <!-- Title bar matching screenshot: "Peta Kebun: ptpnxivluwu" -->
        <div style="background: #0d1322; padding: 10px 12px 6px;">
          <h4 style="margin: 0; font-size: 12px; font-weight: 700; color: #f0f6fc; line-height: 1.3;">${titleLabel}</h4>
        </div>

        <!-- Attributes table with dark alternating zebra striping -->
        <div style="padding: 0 12px 10px; max-height: 220px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <tbody>${extraRkap}${rows}${extraLuas}</tbody>
          </table>
        </div>
      `;

      const zoomBtn = wrapper.querySelector('[data-action="zoom"]');
      if (zoomBtn) {
        zoomBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (featureBounds && featureBounds.isValid()) {
            map.fitBounds(featureBounds, { padding: [60, 60], maxZoom: 17, animate: true });
          } else {
            map.setView(clickLatLng, 16, { animate: true });
          }
        });
      }

      const panBtn = wrapper.querySelector('[data-action="pan"]');
      if (panBtn) {
        panBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (featureBounds && featureBounds.isValid()) {
            map.panTo(featureBounds.getCenter(), { animate: true });
          } else {
            map.panTo(clickLatLng, { animate: true });
          }
        });
      }

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

  // 1. Inisialisasi Leaflet Map sekali saat mount
  useEffect(() => {
    let cancelled = false;

    async function initLeaflet() {
      if (!mapContainerRef.current || mapRef.current) return;

      const L = (await import('leaflet')).default;
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      leafletRef.current = L;

      // Cari initial center dari layer yang aktif jika ada
      const initialLayerWithBbox = layers.find((l) => l.terlihat && l.bbox) || layers.find((l) => l.bbox);
      let initCenter: [number, number] = [-7.6668, 112.9125]; // Default ke Kebun Bakalan
      let initZoom = 15;
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
      const resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    initLeaflet();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [layers]);

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
              maxWidth: 380,
              minWidth: 300,
              closeButton: true,
              autoPan: true,
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

      const visibleLayers = layers.filter((l) => l.terlihat);

      let optCount = 0;
      let warnCount = 0;
      let critCount = 0;
      let totalFeaturesCount = 0;

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

        // Hitung statistik klasifikasi RKAP jika fitur poligon
        if (geojsonData.features) {
          for (const f of geojsonData.features) {
            totalFeaturesCount++;
            const featId = Number(f.id || f.properties?._feature_id || 0);
            const rkap = getFeatureRkapClassification(featId, (f.properties || {}) as Record<string, unknown>);
            if (rkap.category === 'optimal') optCount++;
            else if (rkap.category === 'warning') warnCount++;
            else critCount++;
          }
        }

        // Styling outline tebal & kontras sesuai hierarki perkebunan
        let strokeColor = layer.warna || '#be185d';
        let strokeWidth = 3;

        const layerNameLower = layer.nama_layer.toLowerCase();
        if (layerNameLower.includes('kebun')) {
          strokeColor = '#be185d'; // Magenta / rose tebal (Batas Kebun)
          strokeWidth = 3.5;
        } else if (layerNameLower.includes('afdeling')) {
          strokeColor = '#65a30d'; // Olive / Greenish gold (Batas Afdeling)
          strokeWidth = 3.0;
        } else if (layerNameLower.includes('blok')) {
          strokeColor = '#15803d'; // Forest green (Batas Blok)
          strokeWidth = 2.5;
        }

        const defaultFillColor = strokeColor;

        const geoJsonLayer = L.geoJSON(geojsonData, {
          style: (feature) => {
            const featId = Number(feature?.id || feature?.properties?._feature_id || 0);
            const isSelected = selectedFeatureId !== null && featId === selectedFeatureId;
            const geomType = feature?.geometry?.type || layer.tipe_geometri;
            const isLine = geomType === 'LineString' || geomType === 'MultiLineString';

            if (isSelected) {
              return {
                color: '#00f5ff',
                weight: 5,
                opacity: 1,
                fillColor: '#00f5ff',
                fillOpacity: isOutlineOnly ? 0.1 : 0.55,
              };
            }

            if (isLine) {
              return {
                color: layer.warna || '#f59e0b',
                weight: 3.5,
                opacity: 1,
              };
            }

            // Mode Simbologi Tematik RKAP ala ArcGIS Choropleth Map
            if (symbologyMode === 'rkap') {
              const rkap = getFeatureRkapClassification(featId, (feature?.properties || {}) as Record<string, unknown>);
              return {
                color: rkap.color,
                weight: isOutlineOnly ? 3.5 : 2.5,
                opacity: 1.0,
                fillColor: rkap.color,
                fillOpacity: isOutlineOnly ? 0 : 0.45,
              };
            }

            return {
              color: strokeColor,
              weight: strokeWidth,
              opacity: 1.0, // Outline tegas 100% solid
              fillColor: defaultFillColor,
              fillOpacity: isOutlineOnly ? 0 : 0.38, // Transparan agar citra satelit/raster tembus
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

            // Hover effect: pertebal garis batas
            featureLayer.on('mouseover', () => {
              if ('setStyle' in featureLayer && typeof featureLayer.setStyle === 'function') {
                (featureLayer as LType.Path).setStyle({
                  weight: 5,
                  opacity: 1,
                });
              }
            });
            featureLayer.on('mouseout', () => {
              if ('resetStyle' in geoJsonLayer && typeof geoJsonLayer.resetStyle === 'function') {
                geoJsonLayer.resetStyle(featureLayer as LType.Path);
              }
            });

            // Label permanen jika toggle Labels aktif
            if (showLabels) {
              const labelText = String(
                props._label ||
                  props.kode_blok ||
                  props.KODE_BLOK ||
                  props.nama_blok ||
                  props.nama_afdeling ||
                  props.nama_kebun ||
                  props.Name ||
                  props.NAME ||
                  ''
              ).trim();

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

              const popupEl = buildPopupElement(
                map,
                featBounds,
                e.latlng,
                props,
                layer,
                featId
              );

              L.popup({
                className: 'monitoring-leaflet-popup',
                maxWidth: 390,
                minWidth: 310,
                closeButton: true,
                autoPan: true,
              })
                .setLatLng(e.latlng)
                .setContent(popupEl)
                .openOn(map);
            });
          },
        });

        geoJsonLayer.addTo(group);
      }

      setLegendCounts({
        optimal: optCount,
        warning: warnCount,
        critical: critCount,
        total: totalFeaturesCount,
      });

      // Auto-fit awal jika belum pernah auto-fit
      if (!initialAutoFitDoneRef.current && (visibleLayers.length > 0 || rasterLayers.length > 0)) {
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
    if (fitBoundsTarget) {
      zoomToBounds(fitBoundsTarget);
    }
  }, [fitBoundsTarget, zoomToBounds]);

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
      setLocalResults([]);
      setPlaceResults([]);
      setIsSearching(false);
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
  const addSearchPin = useCallback((loc: MapSearchResult, openPopup: boolean) => {
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
  }, []);

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
        className="absolute top-3 left-3 z-[1000] w-72 sm:w-80 md:w-96 select-text"
      >
        <div className="relative flex items-center bg-[#0D1322]/95 backdrop-blur-md border border-[#1E2942] focus-within:border-[#00D2FF] rounded-xl shadow-2xl transition-all">
          <div className="pl-3 text-[#00D2FF]">
            {isSearching ? (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <IconSearch className="w-4 h-4" />
            )}
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
            placeholder="Cari Lokasi"
            className="w-full bg-transparent text-[#F0F6FC] placeholder-[#566680] text-xs py-2.5 pl-2 pr-8 focus:outline-none"
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
                title="Mulai Gambar Lahan Baru di Lokasi Ini"
              >
                <IconPencil className="w-3.5 h-3.5" />
                <span>+ Buat Lahan</span>
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
            title="Klik untuk mengaktifkan Tool Pensil Gambar Lahan Baru di Peta"
          >
            <IconPencil className="w-3.5 h-3.5" />
            <span>{isDrawingMode ? 'Mode Gambar Aktif' : 'Gambar Lahan Baru'}</span>
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

      {/* ArcGIS Standalone Legend Panel (Pojok Kiri Bawah) */}
      <div className="absolute bottom-6 left-3 z-[1000] pointer-events-auto select-none transition-all">
        {!isLegendOpen ? (
          <button
            type="button"
            onClick={() => setIsLegendOpen(true)}
            className="flex items-center gap-1.5 bg-[#0D1322]/95 hover:bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#F0F6FC] px-2.5 py-1.5 rounded-lg shadow-xl text-xs font-semibold backdrop-blur-md transition-all cursor-pointer group"
            title="Buka Legenda Peta (ArcGIS Legend)"
          >
            <span className="w-2.5 h-2.5 rounded-xs bg-[#00D2FF] group-hover:scale-110 transition-transform" />
            <span className="text-[11px]">Legenda</span>
            <span className="text-[10px] text-[#00D2FF] font-mono">▲</span>
          </button>
        ) : (
          <div className="w-64 bg-[#0D1322]/95 backdrop-blur-md border border-[#1E2942] rounded-xl shadow-2xl p-3 text-[#F0F6FC] space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
            {/* Header Legenda */}
            <div className="flex items-center justify-between pb-2 border-b border-[#1E2942]">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#00D2FF]" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#F0F6FC]">
                  {symbologyMode === 'rkap' ? 'Legenda Status & Luas' : 'Legenda Layer GIS'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsLegendOpen(false)}
                className="text-[#8B9BB4] hover:text-[#EF4444] text-xs px-1 rounded hover:bg-[#12192B] transition-colors cursor-pointer"
                title="Sembunyikan Legenda"
              >
                ✕
              </button>
            </div>

            {/* Konten Simbol Legenda */}
            {symbologyMode === 'rkap' ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between p-1 rounded hover:bg-[#12192B]">
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded-xs border border-white/40 bg-[#10B981] shadow-xs" />
                    <span className="text-[11px] text-[#F0F6FC] font-medium">KTG · Tebu Giling</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#10B981] font-bold tabular-nums">
                    {legendCounts.optimal} blok
                  </span>
                </div>

                <div className="flex items-center justify-between p-1 rounded hover:bg-[#12192B]">
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded-xs border border-white/40 bg-[#00D2FF] shadow-xs" />
                    <span className="text-[11px] text-[#F0F6FC] font-medium">KS GPA (≥ 1,50 Ha)</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#00D2FF] font-bold tabular-nums">
                    {legendCounts.warning} blok
                  </span>
                </div>

                <div className="flex items-center justify-between p-1 rounded hover:bg-[#12192B]">
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded-xs border border-white/40 bg-[#F59E0B] shadow-xs" />
                    <span className="text-[11px] text-[#F0F6FC] font-medium">KS GPA (&lt; 1,50 Ha)</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#F59E0B] font-bold tabular-nums">
                    {legendCounts.critical} blok
                  </span>
                </div>

                <div className="pt-1.5 border-t border-[#1E2942]/60 flex items-center justify-between text-[10px] text-[#8B9BB4]">
                  <span>Total Unit Terpetakan</span>
                  <span className="font-mono font-bold text-[#00D2FF] tabular-nums">
                    {legendCounts.total} Poligon
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2 p-1">
                  <span className="w-3.5 h-3.5 rounded-xs border border-white/30 bg-[#BE185D]" />
                  <span className="text-[11px] text-[#F0F6FC]">Batas Kebun (Induk)</span>
                </div>
                <div className="flex items-center gap-2 p-1">
                  <span className="w-3.5 h-3.5 rounded-xs border border-white/30 bg-[#65A30D]" />
                  <span className="text-[11px] text-[#F0F6FC]">Batas Afdeling</span>
                </div>
                <div className="flex items-center gap-2 p-1">
                  <span className="w-3.5 h-3.5 rounded-xs border border-white/30 bg-[#15803D]" />
                  <span className="text-[11px] text-[#F0F6FC]">Batas Blok Lahan</span>
                </div>
                <div className="pt-1.5 border-t border-[#1E2942]/60 text-[9.5px] text-[#8B9BB4] leading-tight">
                  Aktifkan tombol <strong>Tema: Status &amp; Luas</strong> di menu atas untuk simbologi tematik sesuai atribut shapefile.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
