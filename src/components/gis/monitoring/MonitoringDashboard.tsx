'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MonitoringHeader } from './MonitoringHeader';
import { MonitoringSidebar } from './MonitoringSidebar';
import { MonitoringRightPanel } from './MonitoringRightPanel';
import { MonitoringBottomPanel } from './MonitoringBottomPanel';
import { MonitoringMap } from './MonitoringMap';
import { GisUploadModal } from './GisUploadModal';
import type { LayerPeta, LayerRaster, MonitoringStats } from '@/types/gis';

interface KebunItem {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  wilayah: string | null;
}

interface AfdelingItem {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
}

interface BlokItem {
  id: number;
  afdeling_id: number;
  kode_blok: string;
  nama_blok: string;
}

export function MonitoringDashboard() {
  // Panel toggles
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Time & Period state (matching screenshot: January 2021)
  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedMonth, setSelectedMonth] = useState('November');

  // Master lists
  const [kebunList, setKebunList] = useState<KebunItem[]>([]);
  const [afdelingList, setAfdelingList] = useState<AfdelingItem[]>([]);
  const [blokList, setBlokList] = useState<BlokItem[]>([]);
  const [rawLayers, setRawLayers] = useState<LayerPeta[]>([]);
  const [rasterLayers, setRasterLayers] = useState<LayerRaster[]>([]);
  const [stats, setStats] = useState<MonitoringStats | null>(null);

  // Filter states
  const [selectedWilayah, setSelectedWilayah] = useState('');
  const [selectedKebunId, setSelectedKebunId] = useState<number | null>(null);
  const [selectedAfdelingId, setSelectedAfdelingId] = useState<number | null>(null);
  const [selectedBlokId, setSelectedBlokId] = useState<number | null>(null);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'ktg' | 'ks_gpa'>('all');
  const [layerCategoryFilter, setLayerCategoryFilter] = useState('');

  // Active map and selection states
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null);
  const [fitBoundsTarget, setFitBoundsTarget] = useState<[number, number, number, number] | null>(null);
  const [dataRevision, setDataRevision] = useState(0);

  // 1. Load initial master data (kebun, afdeling, blok, stats, layers, rasters)
  const refreshStatsAndLayers = useCallback(async () => {
    try {
      const params: string[] = [];
      if (selectedKebunId) params.push(`kebun_id=${selectedKebunId}`);
      if (selectedLayerId) params.push(`layer_id=${selectedLayerId}`);
      const statsQuery = params.length > 0 ? `?${params.join('&')}` : '';

      const [lRes, rRes, sRes] = await Promise.all([
        fetch('/api/gis/layers'),
        fetch('/api/gis/rasters'),
        fetch(`/api/stats${statsQuery}`),
      ]);
      if (lRes.ok) {
        const lj = await lRes.json();
        setRawLayers(lj.data || []);
      }
      if (rRes.ok) {
        const rj = await rRes.json();
        setRasterLayers(rj.data || []);
      }
      if (sRes.ok) {
        const sj = await sRes.json();
        setStats(sj.data || null);
      }
    } catch (err) {
      console.error('Failed to refresh layers and stats:', err);
    }
  }, [selectedKebunId, selectedLayerId]);

  // Reaktif perbarui statistik KPI saat filter Kebun atau Layer berubah
  useEffect(() => {
    let ignore = false;
    async function updateStats() {
      try {
        const params: string[] = [];
        if (selectedKebunId) params.push(`kebun_id=${selectedKebunId}`);
        if (selectedLayerId) params.push(`layer_id=${selectedLayerId}`);
        const statsQuery = params.length > 0 ? `?${params.join('&')}` : '';
        const sRes = await fetch(`/api/stats${statsQuery}`);
        if (sRes.ok && !ignore) {
          const sj = await sRes.json();
          setStats(sj.data || null);
        }
      } catch (err) {
        console.error('Failed to update stats:', err);
      }
    }
    updateStats();
    return () => {
      ignore = true;
    };
  }, [selectedKebunId, selectedLayerId]);

  useEffect(() => {
    let ignore = false;
    async function loadMasterData() {
      try {
        const statsQuery = selectedKebunId ? `?kebun_id=${selectedKebunId}` : '';
        const [kRes, aRes, bRes, lRes, rRes, sRes] = await Promise.all([
          fetch('/api/kebun'),
          fetch('/api/afdeling'),
          fetch('/api/blok'),
          fetch('/api/gis/layers'),
          fetch('/api/gis/rasters'),
          fetch(`/api/stats${statsQuery}`),
        ]);

        if (!ignore) {
          if (kRes.ok) {
            const kj = await kRes.json();
            setKebunList(kj.data || []);
          }
          if (aRes.ok) {
            const aj = await aRes.json();
            setAfdelingList(aj.data || []);
          }
          if (bRes.ok) {
            const bj = await bRes.json();
            setBlokList(bj.data || []);
          }
          if (lRes.ok) {
            const lj = await lRes.json();
            const data: LayerPeta[] = lj.data || [];
            setRawLayers(data);
            setSelectedLayerId((prev) => {
              if (prev) return prev;
              const urlParams =
                typeof window !== 'undefined'
                  ? new URLSearchParams(window.location.search)
                  : null;
              const paramLayerId = urlParams?.get('layer_id')
                ? Number(urlParams.get('layer_id'))
                : null;
              const paramKebunId = urlParams?.get('kebun_id')
                ? Number(urlParams.get('kebun_id'))
                : null;

              const defaultL =
                (paramLayerId && data.find((l) => l.id === paramLayerId)) ||
                (paramKebunId && data.find((l) => l.kebun_id === paramKebunId)) ||
                data.find((l) => l.terlihat && l.bbox) ||
                data[0];

              if (defaultL?.bbox) {
                setFitBoundsTarget(defaultL.bbox);
              }
              return defaultL ? defaultL.id : null;
            });
          }
          if (rRes.ok) {
            const rj = await rRes.json();
            setRasterLayers(rj.data || []);
          }
          if (sRes.ok) {
            const sj = await sRes.json();
            setStats(sj.data || null);
          }
        }
      } catch (err) {
        console.error('Failed to load master dashboard data:', err);
      }
    }

    loadMasterData();
    return () => {
      ignore = true;
    };
  }, [selectedKebunId]);

  // 2. Filter layers based on cascading filter
  const displayedLayers = useMemo(() => {
    return rawLayers.filter((l) => {
      // Filter Kebun
      if (selectedKebunId && l.kebun_id && l.kebun_id !== selectedKebunId) {
        return false;
      }
      // Filter Afdeling: Hanya sembunyikan jika layer ini memang eksplisit milik afdeling lain
      if (selectedAfdelingId && l.afdeling_id && l.afdeling_id !== selectedAfdelingId) {
        if (!l.kebun_id || (selectedKebunId && l.kebun_id !== selectedKebunId)) {
          return false;
        }
      }
      // Filter Blok
      if (selectedBlokId && l.blok_id && l.blok_id !== selectedBlokId) {
        return false;
      }
      // Filter Category
      if (
        layerCategoryFilter &&
        !l.nama_layer.toLowerCase().includes(layerCategoryFilter.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [
    rawLayers,
    selectedKebunId,
    selectedAfdelingId,
    selectedBlokId,
    layerCategoryFilter,
  ]);

  // Reset filters
  const handleResetFilters = () => {
    setSelectedWilayah('');
    setSelectedKebunId(null);
    setSelectedAfdelingId(null);
    setSelectedBlokId(null);
    setLayerCategoryFilter('');
    const firstLayerWithBbox = rawLayers.find((l) => l.bbox);
    if (firstLayerWithBbox?.bbox) {
      setFitBoundsTarget(firstLayerWithBbox.bbox);
    }
  };

  // Toggle layer visibility
  const handleToggleLayerVisibility = async (layerId: number, visible: boolean) => {
    setRawLayers((prev) =>
      prev.map((l) => (l.id === layerId ? { ...l, terlihat: visible } : l))
    );
    try {
      await fetch('/api/gis/layers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: layerId, terlihat: visible }),
      });
    } catch (err) {
      console.error('Toggle visibility error:', err);
    }
  };

  // Toggle raster visibility
  const handleToggleRasterVisibility = async (rasterId: number, visible: boolean) => {
    setRasterLayers((prev) =>
      prev.map((r) => (r.id === rasterId ? { ...r, terlihat: visible } : r))
    );
    try {
      await fetch('/api/gis/rasters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rasterId, terlihat: visible }),
      });
    } catch (err) {
      console.error('Toggle raster visibility error:', err);
    }
  };

  // Change raster opacity
  const handleChangeRasterOpacity = async (rasterId: number, opacity: number) => {
    setRasterLayers((prev) =>
      prev.map((r) => (r.id === rasterId ? { ...r, transparansi: opacity } : r))
    );
    try {
      await fetch('/api/gis/rasters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rasterId, transparansi: opacity }),
      });
    } catch (err) {
      console.error('Change raster opacity error:', err);
    }
  };

  // Upload success handler
  const handleUploadSuccess = (
    newLayers: LayerPeta[],
    bbox: [number, number, number, number] | null
  ) => {
    setRawLayers((prev) => [...prev, ...newLayers]);
    if (newLayers.length > 0) {
      setSelectedLayerId(newLayers[0].id);
    }
    if (bbox) {
      setFitBoundsTarget(bbox);
    }
    // Refresh stats from database
    refreshStatsAndLayers();
  };

  // Handler when a new parcel/feature is digitized via Pencil Tool
  const handleFeatureCreated = (newFeature: Record<string, unknown>, layerId: number) => {
    setDataRevision((prev) => prev + 1);
    refreshStatsAndLayers();
    if (newFeature && typeof newFeature.id === 'number') {
      setSelectedFeatureId(newFeature.id);
    }
    setSelectedLayerId(layerId);
  };

  // Handler when a parcel/feature is deleted
  const handleFeatureDeleted = (featId: number, layerId: number) => {
    setSelectedFeatureId(null);
    setDataRevision((prev) => prev + 1);
    refreshStatsAndLayers();
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0A0E1A] text-[#F0F6FC] font-sans antialiased select-none">
      {/* 1. TOP HEADER (RPN Monitoring Dashboard Style) */}
      <MonitoringHeader
        kebunList={kebunList}
        selectedKebunId={selectedKebunId}
        selectedStatusFilter={selectedStatusFilter}
        onSelectStatusFilter={(val) => setSelectedStatusFilter(val as 'all' | 'ktg' | 'ks_gpa')}
        onOpenUpload={() => setIsUploadModalOpen(true)}
      />

      {/* 2. MAIN WORKSPACE BODY */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Filter Sidebar */}
        <MonitoringSidebar
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
          kebunList={kebunList}
          afdelingList={afdelingList}
          blokList={blokList}
          selectedWilayah={selectedWilayah}
          onSelectWilayah={setSelectedWilayah}
          selectedKebunId={selectedKebunId}
          onSelectKebun={(id) => {
            setSelectedKebunId(id);
            setSelectedAfdelingId(null);
            setSelectedBlokId(null);
            if (id) {
              const kebunLayers = rawLayers.filter((l) => l.kebun_id === id && l.bbox);
              if (kebunLayers.length > 0 && kebunLayers[0].bbox) {
                setFitBoundsTarget(kebunLayers[0].bbox);
              }
            }
          }}
          selectedAfdelingId={selectedAfdelingId}
          onSelectAfdeling={setSelectedAfdelingId}
          selectedBlokId={selectedBlokId}
          onSelectBlok={setSelectedBlokId}
          layerCategoryFilter={layerCategoryFilter}
          onChangeLayerCategoryFilter={setLayerCategoryFilter}
          onResetFilters={handleResetFilters}
          layers={displayedLayers}
          selectedLayerId={selectedLayerId}
          onSelectLayer={(id) => setSelectedLayerId(id)}
          onToggleLayerVisibility={handleToggleLayerVisibility}
          onZoomToLayer={(bbox) => setFitBoundsTarget(bbox)}
        />

        {/* Center: Main Map View + Collapsible Bottom Panel */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden">
          {/* Main Map Viewport */}
          <div className="flex-1 min-h-0 relative">
            <MonitoringMap
              layers={displayedLayers}
              rasterLayers={rasterLayers}
              stats={stats}
              selectedLayerId={selectedLayerId}
              statusFilter={selectedStatusFilter}
              selectedAfdelingId={selectedAfdelingId}
              afdelingList={afdelingList}
              onSelectFeature={(featId, layerId) => {
                setSelectedFeatureId(featId);
                if (layerId) setSelectedLayerId(layerId);
              }}
              selectedFeatureId={selectedFeatureId}
              fitBoundsTarget={fitBoundsTarget}
              onToggleLayerVisibility={handleToggleLayerVisibility}
              onToggleRasterVisibility={handleToggleRasterVisibility}
              onChangeRasterOpacity={handleChangeRasterOpacity}
              onFeatureCreated={handleFeatureCreated}
              onFeatureDeleted={handleFeatureDeleted}
              dataRevision={dataRevision}
            />
          </div>

          {/* Bottom Information & Attribute Table Panel */}
          <MonitoringBottomPanel
            isOpen={isBottomPanelOpen}
            onToggle={() => setIsBottomPanelOpen((prev) => !prev)}
            layers={displayedLayers}
            selectedLayerId={selectedLayerId}
            onSelectLayer={(id) => setSelectedLayerId(id)}
            selectedFeatureId={selectedFeatureId}
            onSelectFeature={(id) => setSelectedFeatureId(id)}
            onZoomToFeature={(bbox) => setFitBoundsTarget(bbox)}
            selectedKebunId={selectedKebunId}
            selectedAfdelingId={selectedAfdelingId}
            selectedBlokId={selectedBlokId}
            kebunList={kebunList}
            afdelingList={afdelingList}
            blokList={blokList}
            stats={stats}
            periodYear={selectedYear}
            periodMonth={selectedMonth}
            onFeatureDeleted={handleFeatureDeleted}
            dataRevision={dataRevision}
          />
        </div>

        {/* Right Information & KPI Panel */}
        <MonitoringRightPanel
          isOpen={isRightPanelOpen}
          onToggle={() => setIsRightPanelOpen((prev) => !prev)}
          stats={stats}
          periodMonth={selectedMonth}
          periodYear={selectedYear}
          activeKebunName={kebunList.find((k) => k.id === selectedKebunId)?.nama_kebun}
          activeAfdelingName={afdelingList.find((a) => a.id === selectedAfdelingId)?.nama_afdeling}
        />
      </div>

      {/* 3. UPLOAD & DATA MAPPING MODAL */}
      <GisUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />
    </div>
  );
}
