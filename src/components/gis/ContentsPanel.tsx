'use client';

import React, { useState, useMemo } from 'react';
import {
  IconTable,
  IconLayers,
  IconFolder,
  IconHistory,
  IconFullExtent,
  IconAddData,
  IconChevronDown,
  IconChevronRight,
} from './GisIcons';
import { IconTrash } from '@/components/icons';
import type { LayerPeta } from '@/types/gis';

interface ContentsPanelProps {
  layers: LayerPeta[];
  selectedLayerId: number | null;
  onSelectLayer: (layerId: number) => void;
  onToggleLayerVisibility: (layerId: number, visible: boolean) => void;
  onOpenAttributeTable: (layerId: number) => void;
  onOpenProperties: (layerId: number) => void;
  onZoomToLayer: (bbox: [number, number, number, number] | null) => void;
  onDeleteLayer?: (layerId: number) => void;
  onOpenAddData: () => void;
}

interface LayerGroup {
  id: string;
  name: string;
  icon?: string;
  layers: LayerPeta[];
}

export function ContentsPanel({
  layers,
  selectedLayerId,
  onSelectLayer,
  onToggleLayerVisibility,
  onOpenAttributeTable,
  onOpenProperties,
  onZoomToLayer,
  onDeleteLayer,
  onOpenAddData,
}: ContentsPanelProps) {
  const [activeTab, setActiveTab] = useState<'contents' | 'catalog' | 'history'>('contents');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewStyle, setViewStyle] = useState<'hierarchy' | 'flat'>('hierarchy');

  // Track collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // Filter layers by search
  const filteredLayers = useMemo(() => {
    return layers.filter((l) =>
      l.nama_layer.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [layers, searchQuery]);

  // Group layers into Plantation Hierarchy matching ArcGIS Pro & mockup
  const groups = useMemo<LayerGroup[]>(() => {
    const kebunLayers: LayerPeta[] = [];
    const afdelingLayers: LayerPeta[] = [];
    const blokLayers: LayerPeta[] = [];
    const otherLayers: LayerPeta[] = [];

    filteredLayers.forEach((layer) => {
      const name = layer.nama_layer.toLowerCase();
      if (name.includes('kebun') && !name.includes('jalan')) {
        kebunLayers.push(layer);
      } else if (name.includes('afdeling')) {
        afdelingLayers.push(layer);
      } else if (name.includes('blok') || name.includes('jalan')) {
        // Mockup shows Blok group containing Batas Blok and Jalan Kebun
        blokLayers.push(layer);
      } else {
        otherLayers.push(layer);
      }
    });

    const result: LayerGroup[] = [];
    if (kebunLayers.length > 0) {
      result.push({ id: 'kebun', name: 'Kebun', layers: kebunLayers });
    }
    if (afdelingLayers.length > 0) {
      result.push({ id: 'afdeling', name: 'Afdeling', layers: afdelingLayers });
    }
    if (blokLayers.length > 0) {
      result.push({ id: 'blok', name: 'Blok', layers: blokLayers });
    }
    if (otherLayers.length > 0) {
      result.push({ id: 'other', name: 'Layer Tematik', layers: otherLayers });
    }

    // Fallback if no matching standard name
    if (result.length === 0 && filteredLayers.length > 0) {
      result.push({ id: 'all', name: 'Layer Spasial', layers: filteredLayers });
    }

    return result;
  }, [filteredLayers]);

  // Render a single layer item row
  const renderLayerItem = (layer: LayerPeta) => {
    const isSelected = selectedLayerId === layer.id;
    return (
      <div
        key={layer.id}
        onClick={() => onSelectLayer(layer.id)}
        className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors ${
          isSelected
            ? 'bg-slate-800/90 text-white border-l-2 border-emerald-500'
            : 'hover:bg-slate-900/60 text-slate-300'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Visibility Checkbox */}
          <input
            type="checkbox"
            checked={layer.terlihat}
            onChange={(e) => {
              e.stopPropagation();
              onToggleLayerVisibility(layer.id, !layer.terlihat);
            }}
            className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-emerald-500"
          />

          {/* Symbology Color Swatch */}
          <div
            className="w-3.5 h-3.5 rounded-xs shrink-0 border"
            style={{
              backgroundColor: layer.warna,
              borderColor: layer.warna,
            }}
          />

          <div className="truncate">
            <span className="text-xs font-medium block truncate">
              {layer.nama_layer}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              {layer.jumlah_fitur} fitur ({layer.tipe_geometri})
            </span>
          </div>
        </div>

        {/* Quick Action Icons */}
        <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
          {layer.bbox && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onZoomToLayer(layer.bbox || null);
              }}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-400"
              title="Zoom to Layer Extent"
            >
              <IconFullExtent className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenAttributeTable(layer.id);
            }}
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-400"
            title="Buka Tabel Atribut"
          >
            <IconTable className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenProperties(layer.id);
            }}
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-400"
            title="Layer Properties"
          >
            <IconLayers className="w-3 h-3" />
          </button>
          {onDeleteLayer && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Hapus layer "${layer.nama_layer}" dan seluruh fiturnya dari PostGIS?`)) {
                  onDeleteLayer(layer.id);
                }
              }}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-rose-400"
              title="Hapus Layer"
            >
              <IconTrash className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 border-r border-slate-800 text-slate-200 select-none overflow-hidden">
      {/* Panel Tab Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 text-xs px-2 pt-1 shrink-0">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setActiveTab('contents')}
            className={`px-3 py-1.5 font-semibold transition-colors border-b-2 ${
              activeTab === 'contents'
                ? 'text-emerald-400 border-emerald-500 bg-slate-950/60'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Contents
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`px-3 py-1.5 font-semibold transition-colors border-b-2 ${
              activeTab === 'catalog'
                ? 'text-emerald-400 border-emerald-500 bg-slate-950/60'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Catalog
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 font-semibold transition-colors border-b-2 ${
              activeTab === 'history'
                ? 'text-emerald-400 border-emerald-500 bg-slate-950/60'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            History
          </button>
        </div>

        {/* Hierarchy / Flat Toggle */}
        {activeTab === 'contents' && (
          <button
            type="button"
            onClick={() => setViewStyle(viewStyle === 'hierarchy' ? 'flat' : 'hierarchy')}
            className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800/80 transition-colors"
            title={viewStyle === 'hierarchy' ? 'Ganti ke Tampilan Daftar' : 'Ganti ke Tampilan Hierarki'}
          >
            {viewStyle === 'hierarchy' ? 'Tree' : 'List'}
          </button>
        )}
      </div>

      {activeTab === 'contents' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Action Header: Search & Add Data */}
          <div className="p-2 border-b border-slate-800/80 bg-slate-950/40 shrink-0 flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Filter layer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={onOpenAddData}
              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[10px] flex items-center gap-1 transition-colors shadow-xs"
              title="Add Data / Unggah Shapefile ZIP"
            >
              <IconAddData className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          {/* Tree View of Layers */}
          <div className="flex-1 p-2 space-y-2 overflow-y-auto text-xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
              <span>{viewStyle === 'hierarchy' ? 'Layer / Catalog' : 'Drawing Order · Map'}</span>
              <span className="text-slate-500 font-mono text-[10px]">{layers.length} Layer</span>
            </div>

            {filteredLayers.length === 0 ? (
              <div className="py-8 text-center text-slate-500 space-y-3 px-3">
                <IconLayers className="w-8 h-8 text-slate-700 mx-auto" />
                <p className="text-xs">
                  {searchQuery
                    ? 'Tidak ada layer yang cocok.'
                    : 'Belum ada layer spasial. Unggah Shapefile ZIP untuk menambahkan layer.'}
                </p>
                {!searchQuery && (
                  <button
                    type="button"
                    onClick={onOpenAddData}
                    className="px-3 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 hover:bg-emerald-900 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <IconAddData className="w-3.5 h-3.5" />
                    <span>Upload Shapefile ZIP</span>
                  </button>
                )}
              </div>
            ) : viewStyle === 'hierarchy' ? (
              /* Hierarchical Group View */
              <div className="space-y-3">
                {groups.map((group) => {
                  const isCollapsed = !!collapsedGroups[group.id];
                  return (
                    <div key={group.id} className="space-y-1">
                      {/* Group Header */}
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="w-full flex items-center gap-1.5 text-left px-1 py-1 rounded hover:bg-slate-900/60 text-slate-300 font-semibold text-xs transition-colors"
                      >
                        {isCollapsed ? (
                          <IconChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <IconChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span className="text-slate-200">{group.name}</span>
                        <span className="text-[10px] text-slate-500 font-normal">
                          ({group.layers.length})
                        </span>
                      </button>

                      {/* Group Children Layers */}
                      {!isCollapsed && (
                        <div className="pl-4 space-y-1 border-l border-slate-800/80 ml-2">
                          {group.layers.map((layer) => renderLayerItem(layer))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Flat Drawing Order View */
              <div className="space-y-1">
                {filteredLayers.map((layer) => renderLayerItem(layer))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'catalog' && (
        <div className="flex-1 p-3 space-y-4 overflow-y-auto text-xs text-slate-300">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Project Datasets (PostGIS)
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-900 cursor-pointer">
              <IconFolder className="w-4 h-4 text-emerald-400" />
              <span>Layer Tersimpan di PostGIS ({layers.length})</span>
            </div>
            <div className="pl-6 space-y-1 text-slate-400 text-[11px]">
              {layers.map((l) => (
                <div
                  key={l.id}
                  onClick={() => onSelectLayer(l.id)}
                  className="hover:text-emerald-300 cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-xs" style={{ backgroundColor: l.warna }} />
                  <span className="truncate">{l.nama_layer}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="flex-1 p-3 space-y-3 overflow-y-auto text-xs text-slate-300">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <IconHistory className="w-3.5 h-3.5 text-emerald-400" />
            <span>Riwayat Aktivitas GIS</span>
          </div>
          <div className="p-2.5 rounded bg-slate-900/70 border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-emerald-400">PostGIS 3.6 Connected</span>
              <span className="text-[10px] text-slate-500">System</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Database nusagis siap memproses data spasial Shapefile.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
