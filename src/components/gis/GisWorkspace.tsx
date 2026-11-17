'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GisTitleBar } from './GisTitleBar';
import { GisRibbon, RibbonTab, ActiveTool } from './GisRibbon';
import { ContentsPanel } from './ContentsPanel';
import { MapViewTabs, ViewMode } from './MapViewTabs';
import { MapWorkspace } from './MapWorkspace';
import { AttributeTablePanel } from './AttributeTablePanel';
import { PropertiesPanel } from './PropertiesPanel';
import { GisStatusBar } from './GisStatusBar';
import { AddDataModal } from './AddDataModal';
import { IconChevronUp } from './GisIcons';
import type { LayerPeta, SearchResultItem } from '@/types/gis';

export function GisWorkspace() {
  // Panel dimensions and visibility
  const [leftWidth, setLeftWidth] = useState(270);
  const [rightWidth, setRightWidth] = useState(280);
  const [bottomHeight, setBottomHeight] = useState(230);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(true);
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [isAddDataOpen, setIsAddDataOpen] = useState(false);

  // Workspace controls & active states
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTab>('Map');
  const [activeTool, setActiveTool] = useState<ActiveTool>('pan');
  const [viewMode, setViewMode] = useState<ViewMode>('2D');

  // Real Database Layers State
  const [layers, setLayers] = useState<LayerPeta[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null);
  const [fitBoundsTarget, setFitBoundsTarget] = useState<[number, number, number, number] | null>(null);

  // Pointer coordinate tracking
  const [coords, setCoords] = useState({ lat: 0.7534, lng: 101.4682 });

  // Resizing references
  const isResizingLeft = useRef(false);
  const isResizingRight = useRef(false);
  const isResizingBottom = useRef(false);

  // Ambil daftar layer PostGIS saat pertama kali dimuat + dukung parameter URL (?layer_id= / ?kebun_id=)
  useEffect(() => {
    let ignore = false;
    async function loadLayers() {
      try {
        const res = await fetch('/api/gis/layers');
        if (res.ok && !ignore) {
          const json = await res.json();
          const data: LayerPeta[] = json.data || [];
          setLayers(data);

          if (data.length > 0) {
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

            const matchedLayer =
              (paramLayerId && data.find((l) => l.id === paramLayerId)) ||
              (paramKebunId && data.find((l) => l.kebun_id === paramKebunId)) ||
              data.find((l) => l.nama_layer.toLowerCase().includes('blok')) ||
              data[0];

            setSelectedLayerId(matchedLayer.id);
            if (matchedLayer.bbox) {
              setFitBoundsTarget([...matchedLayer.bbox]);
            } else if (data[0].bbox) {
              setFitBoundsTarget([...data[0].bbox]);
            }
          }
        }
      } catch (err) {
        console.error('Fetch layers error:', err);
      }
    }

    loadLayers();
    return () => {
      ignore = true;
    };
  }, []);

  const handlePointerMove = useCallback((lat: number, lng: number) => {
    setCoords({ lat, lng });
  }, []);

  const handleSelectFeature = useCallback((id: number | null, layerId?: number) => {
    setSelectedFeatureId(id);
    if (layerId) {
      setSelectedLayerId(layerId);
    }
    if (id !== null) {
      setIsTableOpen(true);
    }
  }, []);

  // Resize handler callbacks
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isResizingLeft.current) {
      const newWidth = Math.max(180, Math.min(480, e.clientX));
      setLeftWidth(newWidth);
    }
    if (isResizingRight.current) {
      const newWidth = Math.max(200, Math.min(500, window.innerWidth - e.clientX));
      setRightWidth(newWidth);
    }
    if (isResizingBottom.current) {
      const newHeight = Math.max(100, Math.min(550, window.innerHeight - e.clientY));
      setBottomHeight(newHeight);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizingLeft.current = false;
    isResizingRight.current = false;
    isResizingBottom.current = false;
    document.body.style.cursor = 'default';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Toggle visibilitas layer
  const handleToggleLayerVisibility = async (layerId: number, visible: boolean) => {
    setLayers((prev) =>
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

  // Hapus layer
  const handleDeleteLayer = async (layerId: number) => {
    try {
      const res = await fetch(`/api/gis/layers?id=${layerId}`, { method: 'DELETE' });
      if (res.ok) {
        setLayers((prev) => prev.filter((l) => l.id !== layerId));
        if (selectedLayerId === layerId) {
          setSelectedLayerId(null);
        }
      }
    } catch (err) {
      console.error('Delete layer error:', err);
    }
  };

  // Callback setelah upload Shapefile ZIP berhasil (Bagian F: Auto Zoom ke extent layer baru)
  const handleUploadSuccess = (
    newLayers: LayerPeta[],
    bbox: [number, number, number, number] | null
  ) => {
    setLayers((prev) => [...prev, ...newLayers]);
    if (newLayers.length > 0) {
      setSelectedLayerId(newLayers[0].id);
    }
    if (bbox) {
      setFitBoundsTarget([...bbox]);
    }
  };

  // Callback saat pengguna memilih hasil pencarian (Bagian G: Search + Auto Zoom + Highlight)
  const handleSelectSearchResult = useCallback(
    (item: SearchResultItem) => {
      if (item.layer_id) {
        setSelectedLayerId(item.layer_id);
        // Pastikan layer terlihat di peta
        setLayers((prev) =>
          prev.map((l) => (l.id === item.layer_id ? { ...l, terlihat: true } : l))
        );
      }
      if (item.feature_id) {
        setSelectedFeatureId(item.feature_id);
        setIsTableOpen(true);
      } else {
        setSelectedFeatureId(null);
      }
      if (item.bbox) {
        setFitBoundsTarget([...item.bbox]);
      }
    },
    []
  );

  const selectedLayer = layers.find((l) => l.id === selectedLayerId);
  const totalFeatureCount = layers.reduce((acc, curr) => acc + (curr.jumlah_fitur || 0), 0);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-950 text-slate-100 font-sans antialiased select-none">
      {/* 1. Application Title Bar + Global Spatial Search */}
      <GisTitleBar
        projectName="Perkebunan"
        isPropertiesOpen={isPropertiesOpen}
        onToggleProperties={() => setIsPropertiesOpen(!isPropertiesOpen)}
        isTableOpen={isTableOpen}
        onToggleTable={() => setIsTableOpen(!isTableOpen)}
        onSelectSearchResult={handleSelectSearchResult}
      />

      {/* 2. Ribbon Navigation */}
      <GisRibbon
        activeTab={activeRibbonTab}
        onTabChange={setActiveRibbonTab}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onToggleTable={() => setIsTableOpen(!isTableOpen)}
        onToggleProperties={() => setIsPropertiesOpen(!isPropertiesOpen)}
        onClearSelection={() => setSelectedFeatureId(null)}
        selectedCount={selectedFeatureId ? 1 : 0}
        onOpenAddData={() => setIsAddDataOpen(true)}
      />

      {/* 3. Central Workspace Body with Resizable Splitters */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Panel: Contents, Catalog & History */}
        <div style={{ width: leftWidth }} className="h-full shrink-0 flex flex-col">
          <ContentsPanel
            layers={layers}
            selectedLayerId={selectedLayerId}
            onSelectLayer={(id) => {
              setSelectedLayerId(id);
              if (!isPropertiesOpen) setIsPropertiesOpen(true);
            }}
            onToggleLayerVisibility={handleToggleLayerVisibility}
            onOpenAttributeTable={(id) => {
              setSelectedLayerId(id);
              setIsTableOpen(true);
            }}
            onOpenProperties={(id) => {
              setSelectedLayerId(id);
              setIsPropertiesOpen(true);
            }}
            onZoomToLayer={(bbox) => {
              if (bbox) setFitBoundsTarget([...bbox]);
            }}
            onDeleteLayer={handleDeleteLayer}
            onOpenAddData={() => setIsAddDataOpen(true)}
          />
        </div>

        {/* Left Splitter */}
        <div
          onMouseDown={() => {
            isResizingLeft.current = true;
            document.body.style.cursor = 'col-resize';
          }}
          className="w-1 bg-slate-800 hover:bg-emerald-500 transition-colors cursor-col-resize shrink-0 z-20"
          title="Drag untuk resize panel Contents"
        />

        {/* Center Section: Map View + Bottom Attribute Table */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden">
          {/* Map View Tabs Header */}
          <MapViewTabs viewMode={viewMode} onViewModeChange={setViewMode} />

          {/* Map Canvas Viewport with MapLibre GL */}
          <div className="flex-1 min-h-0 relative">
            <MapWorkspace
              viewMode={viewMode}
              activeTool={activeTool}
              layers={layers}
              selectedLayerId={selectedLayerId}
              onPointerMove={handlePointerMove}
              onSelectFeature={handleSelectFeature}
              selectedFeatureId={selectedFeatureId}
              fitBoundsTarget={fitBoundsTarget}
            />
          </div>

          {/* Bottom Splitter */}
          {isTableOpen && (
            <div
              onMouseDown={() => {
                isResizingBottom.current = true;
                document.body.style.cursor = 'row-resize';
              }}
              className="h-1 bg-slate-800 hover:bg-emerald-500 transition-colors cursor-row-resize shrink-0 z-20"
              title="Drag untuk resize tinggi Attribute Table"
            />
          )}

          {/* Bottom Panel: Attribute Table */}
          {isTableOpen ? (
            <div style={{ height: bottomHeight }} className="shrink-0">
              <AttributeTablePanel
                isOpen={isTableOpen}
                onToggle={() => setIsTableOpen(false)}
                selectedLayerId={selectedLayerId}
                selectedLayerName={selectedLayer?.nama_layer || 'Belum ada layer'}
                selectedFeatureId={selectedFeatureId}
                onSelectFeature={setSelectedFeatureId}
                onZoomToFeature={(bbox) => setFitBoundsTarget([...bbox])}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsTableOpen(true)}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 hover:border-emerald-500 text-slate-300 hover:text-emerald-400 shadow-xl flex items-center gap-1.5 z-30 text-caption font-semibold transition-all hover:scale-105"
              title="Buka Tabel Atribut"
            >
              <IconChevronUp className="w-3.5 h-3.5" />
              <span>Attribute Table</span>
            </button>
          )}
        </div>

        {/* Right Splitter */}
        {isPropertiesOpen && (
          <div
            onMouseDown={() => {
              isResizingRight.current = true;
              document.body.style.cursor = 'col-resize';
            }}
            className="w-1 bg-slate-800 hover:bg-emerald-500 transition-colors cursor-col-resize shrink-0 z-20"
            title="Drag untuk resize panel Properties"
          />
        )}

        {/* Right Panel: Properties, Symbology, Labels */}
        {isPropertiesOpen && (
          <div style={{ width: rightWidth }} className="h-full shrink-0">
            <PropertiesPanel
              key={selectedLayer?.id || 'none'}
              isOpen={isPropertiesOpen}
              onClose={() => setIsPropertiesOpen(false)}
              selectedLayer={selectedLayer}
              onUpdateLayer={(id, updates) => {
                setLayers((prev) =>
                  prev.map((l) => (l.id === id ? { ...l, ...updates } : l))
                );
              }}
            />
          </div>
        )}
      </div>

      {/* 4. Bottom Status Bar */}
      <GisStatusBar
        lat={coords.lat}
        lng={coords.lng}
        selectedCount={selectedFeatureId ? 1 : 0}
        totalFeatures={totalFeatureCount}
      />

      {/* Add Data / Upload Shapefile Modal */}
      <AddDataModal
        isOpen={isAddDataOpen}
        onClose={() => setIsAddDataOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />
    </div>
  );
}
