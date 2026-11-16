'use client';

import React from 'react';
import {
  IconFilter,
  IconRefresh,
  IconChevronRight,
  IconLayers,
  IconEye,
  IconEyeOff,
  IconZoomTo,
} from '../GisIcons';
import type { LayerPeta } from '@/types/gis';

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

interface MonitoringSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  // Master lists
  kebunList: KebunItem[];
  afdelingList: AfdelingItem[];
  blokList: BlokItem[];
  // Selected filter states
  selectedWilayah: string;
  onSelectWilayah: (wilayah: string) => void;
  selectedKebunId: number | null;
  onSelectKebun: (id: number | null) => void;
  selectedAfdelingId: number | null;
  onSelectAfdeling: (id: number | null) => void;
  selectedBlokId: number | null;
  onSelectBlok: (id: number | null) => void;
  geometryFilter: 'semua' | 'polygon' | 'line';
  onChangeGeometryFilter: (val: 'semua' | 'polygon' | 'line') => void;
  layerCategoryFilter: string;
  onChangeLayerCategoryFilter: (cat: string) => void;
  onResetFilters: () => void;
  // Manajemen Layer Props (Dipindahkan ke Sidebar Kiri)
  layers?: LayerPeta[];
  selectedLayerId?: number | null;
  onSelectLayer?: (id: number) => void;
  onToggleLayerVisibility?: (id: number, visible: boolean) => void;
  onZoomToLayer?: (bbox: [number, number, number, number]) => void;
}

export function MonitoringSidebar({
  isOpen,
  onToggle,
  kebunList,
  afdelingList,
  blokList,
  selectedWilayah,
  onSelectWilayah,
  selectedKebunId,
  onSelectKebun,
  selectedAfdelingId,
  onSelectAfdeling,
  selectedBlokId,
  onSelectBlok,
  geometryFilter,
  onChangeGeometryFilter,
  layerCategoryFilter,
  onChangeLayerCategoryFilter,
  onResetFilters,
  layers = [],
  selectedLayerId = null,
  onSelectLayer,
  onToggleLayerVisibility,
  onZoomToLayer,
}: MonitoringSidebarProps) {
  // Cascading lists
  const availableWilayah = Array.from(
    new Set(
      kebunList
        .map((k) => k.wilayah?.trim())
        .filter((w): w is string => Boolean(w && w.length > 0))
    )
  );

  const filteredKebun = selectedWilayah
    ? kebunList.filter((k) => k.wilayah?.trim() === selectedWilayah)
    : kebunList;

  const filteredAfdeling = selectedKebunId
    ? afdelingList.filter((a) => a.kebun_id === selectedKebunId)
    : afdelingList;

  const filteredBlok = selectedAfdelingId
    ? blokList.filter((b) => b.afdeling_id === selectedAfdelingId)
    : selectedKebunId
    ? blokList.filter((b) => {
        const parentAfd = afdelingList.find((a) => a.id === b.afdeling_id);
        return parentAfd?.kebun_id === selectedKebunId;
      })
    : blokList;

  if (!isOpen) {
    return (
      <div className="w-10 bg-[#0D1322] border-r border-[#1E2942] flex flex-col items-center py-3 select-none shrink-0 z-20">
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded-lg bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors shadow-md cursor-pointer"
          title="Buka Panel Filter"
        >
          <IconFilter className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <aside className="w-64 sm:w-72 bg-[#0D1322] border-r border-[#1E2942] flex flex-col select-none shrink-0 z-20 h-full overflow-hidden text-[#F0F6FC]">
      {/* Header Panel Filter */}
      <div className="h-11 px-4 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 font-bold text-xs text-[#F0F6FC] uppercase tracking-wider">
          <IconFilter className="w-3.5 h-3.5 text-[#00D2FF]" />
          <span>Filter Monitoring</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onResetFilters}
            className="p-1 rounded text-[#8B9BB4] hover:text-[#00D2FF] hover:bg-[#12192B] text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
            title="Reset Seluruh Filter"
          >
            <IconRefresh className="w-3 h-3" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
            title="Sembunyikan Panel Filter"
          >
            <IconChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Form Cascading Filter */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* 1. Perusahaan / Wilayah */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#8B9BB4] block">
            Wilayah / Perusahaan
          </label>
          <select
            value={selectedWilayah}
            onChange={(e) => {
              onSelectWilayah(e.target.value);
              onSelectKebun(null);
              onSelectAfdeling(null);
              onSelectBlok(null);
            }}
            className="w-full bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
          >
            <option value="" className="bg-[#0D1322]">Semua Wilayah</option>
            {availableWilayah.map((w) => (
              <option key={w} value={w} className="bg-[#0D1322]">
                {w}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Kebun */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#8B9BB4] block">
            Kebun
          </label>
          <select
            value={selectedKebunId || ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null;
              onSelectKebun(val);
              onSelectAfdeling(null);
              onSelectBlok(null);
            }}
            className="w-full bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
          >
            <option value="" className="bg-[#0D1322]">Semua Kebun</option>
            {filteredKebun.map((k) => (
              <option key={k.id} value={k.id} className="bg-[#0D1322]">
                {k.nama_kebun} ({k.kode_kebun})
              </option>
            ))}
          </select>
        </div>

        {/* 3. Afdeling (Cascading dari Kebun) */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#8B9BB4] block">
            Afdeling
          </label>
          <select
            value={selectedAfdelingId || ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null;
              onSelectAfdeling(val);
              onSelectBlok(null);
            }}
            className="w-full bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors disabled:opacity-40"
          >
            <option value="" className="bg-[#0D1322]">Semua Afdeling</option>
            {filteredAfdeling.map((a) => (
              <option key={a.id} value={a.id} className="bg-[#0D1322]">
                {a.nama_afdeling} ({a.kode_afdeling})
              </option>
            ))}
          </select>
        </div>

        {/* 4. Blok (Cascading dari Afdeling) */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#8B9BB4] block">
            Blok
          </label>
          <select
            value={selectedBlokId || ''}
            onChange={(e) =>
              onSelectBlok(e.target.value ? Number(e.target.value) : null)
            }
            className="w-full bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors disabled:opacity-40"
          >
            <option value="" className="bg-[#0D1322]">Semua Blok</option>
            {filteredBlok.map((b) => (
              <option key={b.id} value={b.id} className="bg-[#0D1322]">
                {b.nama_blok} ({b.kode_blok})
              </option>
            ))}
          </select>
        </div>

        {/* 5. Tipe Geometri Filter Buttons */}
        <div className="space-y-1.5 pt-2 border-t border-[#1E2942]">
          <label className="text-[11px] font-semibold text-[#8B9BB4] block">
            Filter Tipe Layer
          </label>
          <div className="grid grid-cols-3 gap-1 bg-[#0A0E1A] p-1 rounded-md border border-[#1E2942]">
            <button
              type="button"
              onClick={() => onChangeGeometryFilter('semua')}
              className={`py-1 text-[10px] font-semibold rounded transition-colors cursor-pointer ${
                geometryFilter === 'semua'
                  ? 'bg-[#00D2FF] text-[#0A0E1A] font-bold shadow-xs'
                  : 'text-[#8B9BB4] hover:text-[#F0F6FC]'
              }`}
            >
              Semua
            </button>
            <button
              type="button"
              onClick={() => onChangeGeometryFilter('polygon')}
              className={`py-1 text-[10px] font-semibold rounded transition-colors cursor-pointer ${
                geometryFilter === 'polygon'
                  ? 'bg-[#00D2FF] text-[#0A0E1A] font-bold shadow-xs'
                  : 'text-[#8B9BB4] hover:text-[#F0F6FC]'
              }`}
            >
              Poligon
            </button>
            <button
              type="button"
              onClick={() => onChangeGeometryFilter('line')}
              className={`py-1 text-[10px] font-semibold rounded transition-colors cursor-pointer ${
                geometryFilter === 'line'
                  ? 'bg-[#00D2FF] text-[#0A0E1A] font-bold shadow-xs'
                  : 'text-[#8B9BB4] hover:text-[#F0F6FC]'
              }`}
            >
              Garis
            </button>
          </div>
        </div>

        {/* 6. Kategori Layer */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#8B9BB4] block">
            Kategori Layer
          </label>
          <select
            value={layerCategoryFilter}
            onChange={(e) => onChangeLayerCategoryFilter(e.target.value)}
            className="w-full bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
          >
            <option value="" className="bg-[#0D1322]">Semua Kategori</option>
            <option value="Batas Kebun" className="bg-[#0D1322]">Batas Kebun</option>
            <option value="Batas Afdeling" className="bg-[#0D1322]">Batas Afdeling</option>
            <option value="Batas Blok" className="bg-[#0D1322]">Batas Blok</option>
            <option value="Jalan Kebun" className="bg-[#0D1322]">Jalan Kebun</option>
            <option value="Sungai" className="bg-[#0D1322]">Sungai</option>
            <option value="Infrastruktur" className="bg-[#0D1322]">Infrastruktur</option>
          </select>
        </div>

        {/* 7. MANAJEMEN LAYER GIS */}
        <div className="space-y-2 pt-2.5 border-t border-[#1E2942]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#F0F6FC] uppercase tracking-wider">
              <IconLayers className="w-3.5 h-3.5 text-[#00D2FF]" />
              <span>Manajemen Layer</span>
            </div>
            <span className="text-[10px] bg-[#12192B] border border-[#1E2942] text-[#8B9BB4] px-1.5 py-0.5 rounded font-mono">
              {layers.length} Layer
            </span>
          </div>

          {layers.length === 0 ? (
            <div className="text-[11px] text-[#566680] italic p-2 bg-[#12192B]/50 rounded border border-[#1E2942] text-center">
              Belum ada layer spasial aktif.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {layers.map((layer) => {
                const isSelected = selectedLayerId === layer.id;
                return (
                  <div
                    key={layer.id}
                    onClick={() => onSelectLayer?.(layer.id)}
                    className={`p-2 rounded-lg border text-xs transition-all cursor-pointer flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-[#132238] border-[#00D2FF] text-[#00D2FF] shadow-xs'
                        : 'bg-[#12192B] border-[#1E2942] text-[#F0F6FC] hover:border-[#2C3B59] hover:bg-[#19233A]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Titik Warna Layer */}
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                        style={{ backgroundColor: layer.warna || '#00D2FF' }}
                      />
                      <div className="truncate">
                        <div className="font-semibold truncate text-[11px]">{layer.nama_layer}</div>
                        <div className="text-[9px] text-[#566680] font-mono">
                          {layer.tipe_geometri || 'Polygon'} • {layer.jumlah_fitur || 0} fitur
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Zoom to layer bbox */}
                      {layer.bbox && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (layer.bbox) onZoomToLayer?.(layer.bbox);
                          }}
                          className="p-1 rounded hover:bg-[#19233A] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors cursor-pointer"
                          title="Fokus Zoom ke Layer ini"
                        >
                          <IconZoomTo className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Toggle Mata (Visibilitas) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleLayerVisibility?.(layer.id, !layer.terlihat);
                        }}
                        className={`p-1 rounded transition-colors cursor-pointer ${
                          layer.terlihat
                            ? 'text-[#00D2FF] hover:bg-[#0E3A5D]/50'
                            : 'text-[#566680] hover:bg-[#19233A]'
                        }`}
                        title={layer.terlihat ? 'Sembunyikan Layer' : 'Tampilkan Layer'}
                      >
                        {layer.terlihat ? (
                          <IconEye className="w-3.5 h-3.5" />
                        ) : (
                          <IconEyeOff className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-[#0D1322] border-t border-[#1E2942] text-[10px] text-[#8B9BB4] flex items-center justify-between">
        <span>PostGIS Filter Engine</span>
        <span className="text-[#00D2FF] font-mono font-semibold">EPSG:4326</span>
      </div>
    </aside>
  );
}
