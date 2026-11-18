'use client';

import React, { useState, useMemo } from 'react';
import {
  IconFilter,
  IconRefresh,
  IconChevronRight,
  IconLayers,
  IconEye,
  IconEyeOff,
  IconZoomTo,
  IconPencil,
  IconSettings,
  IconTrash,
} from '../GisIcons';
import type { LayerPeta } from '@/types/gis';

interface KebunItem {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  perusahaan?: string | null;
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
  selectedPerusahaan: string;
  onSelectPerusahaan: (perusahaan: string) => void;
  selectedWilayah: string;
  onSelectWilayah: (wilayah: string) => void;
  selectedKebunId: number | null;
  onSelectKebun: (id: number | null) => void;
  selectedAfdelingId: number | null;
  onSelectAfdeling: (id: number | null) => void;
  selectedBlokId: number | null;
  onSelectBlok: (id: number | null) => void;
  onResetFilters: () => void;
  // Manajemen Layer Props (Dipindahkan ke Sidebar Kiri)
  layers?: LayerPeta[];
  allLayers?: LayerPeta[];
  selectedLayerId?: number | null;
  onSelectLayer?: (id: number) => void;
  onToggleLayerVisibility?: (id: number, visible: boolean) => void;
  onZoomToLayer?: (bbox: [number, number, number, number]) => void;
  onRenameLayer?: (layerId: number, newName: string) => void;
  onDeleteLayer?: (layerId: number, layerName: string) => Promise<boolean | void>;
  onDeleteWilayah?: (wilayahName: string) => Promise<boolean | void>;
  // Settings & History
  onOpenSettings?: () => void;
  deletedCount?: number;
}

export function MonitoringSidebar({
  isOpen,
  onToggle,
  kebunList,
  afdelingList,
  blokList,
  selectedPerusahaan,
  onSelectPerusahaan,
  selectedWilayah,
  onSelectWilayah,
  selectedKebunId,
  onSelectKebun,
  selectedAfdelingId,
  onSelectAfdeling,
  selectedBlokId,
  onSelectBlok,
  onResetFilters,
  layers = [],
  allLayers,
  selectedLayerId = null,
  onSelectLayer,
  onToggleLayerVisibility,
  onZoomToLayer,
  onRenameLayer,
  onDeleteLayer,
  onDeleteWilayah,
  onOpenSettings,
  deletedCount = 0,
}: MonitoringSidebarProps) {
  // State untuk Rename Layer langsung di sidebar
  const [renamingLayerId, setRenamingLayerId] = useState<number | null>(null);
  const [renamingText, setRenamingText] = useState('');

  // State Modal Konfirmasi Hapus Data (Wilayah atau Layer)
  const [deleteModal, setDeleteModal] = useState<{
    type: 'wilayah' | 'layer';
    id?: number;
    name: string;
    parentName?: string;
    isLastFile?: boolean;
    totalFiles?: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pengelompokan Hirarkis Layer GIS: Wilayah -> Kebun -> Layers
  const groupedLayers = useMemo(() => {
    const result: Record<string, Record<string, LayerPeta[]>> = {};

    layers.forEach((layer) => {
      const matchKebun = kebunList.find((k) => k.id === layer.kebun_id);
      const wil = (layer.wilayah || matchKebun?.wilayah || 'Wilayah Belum Ditentukan').trim();
      const kbn = (layer.nama_kebun || matchKebun?.nama_kebun || 'Kebun Umum').trim();

      if (!result[wil]) result[wil] = {};
      if (!result[wil][kbn]) result[wil][kbn] = [];
      result[wil][kbn].push(layer);
    });

    return result;
  }, [layers, kebunList]);
  // 1. Ekstraksi daftar unik Perusahaan dari master kebun / DB
  const rawPerusahaan = Array.from(
    new Set(
      kebunList
        .map((k) => k.perusahaan?.trim())
        .filter((p): p is string => Boolean(p && p.length > 0))
    )
  );
  // Default list mencakup PTPN I & P3GI jika belum ada di database
  const availablePerusahaan = Array.from(
    new Set([
      ...rawPerusahaan,
      'PT Perkebunan Nusantara I (Regional 4)',
      'Pusat Penelitian Perkebunan Gula Indonesia (P3GI)',
    ])
  );

  // 2. Cascading Wilayah berdasarkan Perusahaan terpilih (gabungkan dari master kebun + layer aktif)
  const filteredByPerusahaanKebun = selectedPerusahaan
    ? kebunList.filter(
        (k) =>
          (k.perusahaan?.trim() || 'PT Perkebunan Nusantara I (Regional 4)').toLowerCase() ===
          selectedPerusahaan.trim().toLowerCase()
      )
    : kebunList;

  const sourceLayersForWilayah = allLayers ?? layers;
  const wilayahMap = new Map<string, string>();
  for (const k of filteredByPerusahaanKebun) {
    const w = k.wilayah?.trim();
    if (w && w.length > 0 && !wilayahMap.has(w.toLowerCase())) {
      wilayahMap.set(w.toLowerCase(), w);
    }
  }
  for (const l of sourceLayersForWilayah) {
    if (selectedPerusahaan) {
      const lPer = (l.perusahaan?.trim() || 'PT Perkebunan Nusantara I (Regional 4)').toLowerCase();
      if (lPer !== selectedPerusahaan.trim().toLowerCase()) continue;
    }
    const w = l.wilayah?.trim();
    if (w && w.length > 0 && !wilayahMap.has(w.toLowerCase())) {
      wilayahMap.set(w.toLowerCase(), w);
    }
  }
  const availableWilayah = Array.from(wilayahMap.values());

  // 3. Kebun berdasarkan Wilayah & Perusahaan terpilih
  const filteredKebun = selectedWilayah
    ? filteredByPerusahaanKebun.filter(
        (k) => (k.wilayah?.trim() || '').toLowerCase() === selectedWilayah.trim().toLowerCase()
      )
    : filteredByPerusahaanKebun;

  // 4. Afdeling berdasarkan Kebun terpilih
  const filteredAfdeling = selectedKebunId
    ? afdelingList.filter((a) => a.kebun_id === selectedKebunId)
    : (selectedWilayah || selectedPerusahaan)
    ? afdelingList.filter((a) => filteredKebun.some((k) => k.id === a.kebun_id))
    : afdelingList;

  // 5. Blok berdasarkan Afdeling terpilih
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
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
        {/* 1. Perusahaan (Induk Holding / Entitas Kebun) */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#8B9BB4] flex items-center justify-between">
            <span>Perusahaan</span>
          </label>
          <select
            value={selectedPerusahaan}
            onChange={(e) => {
              onSelectPerusahaan(e.target.value);
            }}
            className="w-full bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
          >
            <option value="" className="bg-[#0D1322]">Semua Perusahaan</option>
            {availablePerusahaan.map((p) => (
              <option key={p} value={p} className="bg-[#0D1322]">
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Wilayah Geografis */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-[#8B9BB4] block">
              Wilayah
            </label>
            {selectedWilayah && onDeleteWilayah && (
              <button
                type="button"
                onClick={() =>
                  setDeleteModal({
                    type: 'wilayah',
                    name: selectedWilayah,
                  })
                }
                className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors cursor-pointer"
                title={`Hapus seluruh data wilayah "${selectedWilayah}"`}
              >
                <IconTrash className="w-2.5 h-2.5" />
                <span>Hapus Wilayah</span>
              </button>
            )}
          </div>
          <select
            value={selectedWilayah}
            onChange={(e) => {
              onSelectWilayah(e.target.value);
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

        {/* 3. Kebun */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#8B9BB4] block">
            Kebun
          </label>
          <select
            value={selectedKebunId || ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null;
              onSelectKebun(val);
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

        {/* 4. Afdeling (Cascading dari Kebun) */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#8B9BB4] block">
            Afdeling
          </label>
          <select
            value={selectedAfdelingId || ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null;
              onSelectAfdeling(val);
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

        {/* 5. Blok (Cascading dari Afdeling) */}
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
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {Object.entries(groupedLayers).map(([wilayahName, kebunMap]) => {
                const totalLayersInWilayah = Object.values(kebunMap).reduce(
                  (acc, curr) => acc + curr.length,
                  0
                );

                return (
                  <div
                    key={wilayahName}
                    className="space-y-1.5 pb-2 border-b border-[#1E2942]/60 last:border-b-0"
                  >
                    {/* Header Wilayah */}
                    <div className="flex items-center justify-between px-1 py-0.5 group">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#00D2FF] uppercase tracking-wider min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF] shrink-0" />
                        <span className="truncate">{wilayahName}</span>
                      </div>
                      {onDeleteWilayah && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteModal({
                              type: 'wilayah',
                              name: wilayahName,
                              totalFiles: totalLayersInWilayah,
                            });
                          }}
                          className="p-1 rounded text-[#8B9BB4] hover:text-[#EF4444] hover:bg-[#1E1420] transition-colors cursor-pointer"
                          title={`Hapus seluruh data wilayah "${wilayahName}" (${totalLayersInWilayah} file/layer)`}
                        >
                          <IconTrash className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Sub-grup per Kebun */}
                    {Object.entries(kebunMap).map(([kebunName, layerItems]) => (
                      <div key={kebunName} className="pl-1.5 space-y-1">
                        <div className="text-[10px] font-semibold text-[#8B9BB4] flex items-center gap-1">
                          <span className="text-[#10B981]">🌱</span>
                          <span className="truncate">{kebunName}</span>
                        </div>

                        {/* Daftar Layer dalam Kebun ini */}
                        <div className="space-y-1 pl-1">
                          {layerItems.map((layer) => {
                            const isSelected = selectedLayerId === layer.id;
                            const isRenaming = renamingLayerId === layer.id;

                            return (
                              <div
                                key={layer.id}
                                onClick={() => onSelectLayer?.(layer.id)}
                                className={`p-1.5 rounded-lg border text-xs transition-all cursor-pointer flex flex-col gap-1.5 ${
                                  isSelected
                                    ? 'bg-[#132238] border-[#00D2FF] text-[#00D2FF] shadow-xs'
                                    : 'bg-[#12192B] border-[#1E2942] text-[#F0F6FC] hover:border-[#2C3B59] hover:bg-[#19233A]'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0 border border-white/20"
                                      style={{ backgroundColor: layer.warna || '#00D2FF' }}
                                    />
                                    {!isRenaming ? (
                                      <span className="font-semibold truncate text-[11px] leading-tight">
                                        {layer.nama_layer}
                                      </span>
                                    ) : (
                                      <div
                                        className="flex items-center gap-1 flex-1"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <input
                                          type="text"
                                          value={renamingText}
                                          onChange={(e) => setRenamingText(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              if (renamingText.trim()) {
                                                onRenameLayer?.(layer.id, renamingText.trim());
                                              }
                                              setRenamingLayerId(null);
                                            } else if (e.key === 'Escape') {
                                              setRenamingLayerId(null);
                                            }
                                          }}
                                          autoFocus
                                          className="w-full bg-[#0D1322] border border-[#00D2FF] rounded px-1.5 py-0.5 text-xs text-[#F0F6FC] focus:outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (renamingText.trim()) {
                                              onRenameLayer?.(layer.id, renamingText.trim());
                                            }
                                            setRenamingLayerId(null);
                                          }}
                                          className="px-1 text-[#10B981] hover:text-white font-bold"
                                          title="Simpan Nama"
                                        >
                                          ✓
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setRenamingLayerId(null)}
                                          className="px-1 text-[#8B9BB4] hover:text-white font-bold"
                                          title="Batal"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  <div
                                    className="flex items-center gap-0.5 shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {/* Tombol Ganti Nama (Rename) */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRenamingLayerId(layer.id);
                                        setRenamingText(layer.nama_layer);
                                      }}
                                      className="p-1 rounded hover:bg-[#0D1322] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors"
                                      title="Ganti Nama Layer"
                                    >
                                      <IconPencil className="w-3 h-3" />
                                    </button>

                                    {/* Tombol Hapus Layer Tunggal */}
                                    {onDeleteLayer && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDeleteModal({
                                            type: 'layer',
                                            id: layer.id,
                                            name: layer.nama_layer,
                                            parentName: wilayahName,
                                            isLastFile: totalLayersInWilayah <= 1,
                                            totalFiles: totalLayersInWilayah,
                                          })
                                        }
                                        className="p-1 rounded hover:bg-[#1E1420] text-[#8B9BB4] hover:text-[#EF4444] transition-colors cursor-pointer"
                                        title={
                                          totalLayersInWilayah <= 1
                                            ? `Hapus file "${layer.nama_layer}" (File terakhir, wilayah "${wilayahName}" akan otomatis ikut terhapus)`
                                            : `Hapus file layer "${layer.nama_layer}" saja`
                                        }
                                      >
                                        <IconTrash className="w-3 h-3" />
                                      </button>
                                    )}

                                    {/* Zoom to layer bbox */}
                                    {layer.bbox && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (layer.bbox) onZoomToLayer?.(layer.bbox);
                                        }}
                                        className="p-1 rounded hover:bg-[#0D1322] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors cursor-pointer"
                                        title="Fokus Zoom ke Layer ini"
                                      >
                                        <IconZoomTo className="w-3 h-3" />
                                      </button>
                                    )}

                                    {/* Toggle Mata (Visibilitas) */}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onToggleLayerVisibility?.(layer.id, !layer.terlihat)
                                      }
                                      className={`p-1 rounded transition-colors cursor-pointer ${
                                        layer.terlihat
                                          ? 'text-[#00D2FF] hover:bg-[#0E3A5D]/50'
                                          : 'text-[#566680] hover:bg-[#0D1322]'
                                      }`}
                                      title={layer.terlihat ? 'Sembunyikan Layer' : 'Tampilkan Layer'}
                                    >
                                      {layer.terlihat ? (
                                        <IconEye className="w-3 h-3" />
                                      ) : (
                                        <IconEyeOff className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                </div>

                                {/* Badge Tipe Geometri & Jumlah Fitur */}
                                <div className="flex items-center justify-between text-[9px] text-[#8B9BB4] font-mono px-0.5">
                                  <span className="bg-[#0D1322] px-1 py-0.5 rounded border border-[#1E2942]">
                                    {layer.tipe_geometri || 'Polygon'}
                                  </span>
                                  <span>{layer.jumlah_fitur || 0} fitur</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer Info & Settings */}
      <div className="p-2.5 bg-[#0D1322] border-t border-[#1E2942] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#12192B] hover:bg-[#1A2338] border border-[#1E2942] hover:border-[#00D2FF]/50 text-xs text-[#E2E8F0] transition-all cursor-pointer group shadow-sm"
          title="Buka Pengaturan Sistem, Cadangan Data & Riwayat Sampah Spasial"
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#00D2FF]/10 text-[#00D2FF] flex items-center justify-center group-hover:scale-105 transition-transform">
              <IconSettings className="w-3.5 h-3.5" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-[11px] group-hover:text-[#00D2FF] transition-colors leading-tight">
                Settings
              </div>
              <div className="text-[9px] text-[#8B9BB4] leading-tight">Backup & Riwayat</div>
            </div>
          </div>
          {typeof deletedCount === 'number' && deletedCount > 0 ? (
            <span className="px-1.5 py-0.5 rounded-full bg-[#EF4444] text-white text-[9px] font-bold shadow-xs">
              {deletedCount}
            </span>
          ) : (
            <span className="text-[10px] text-[#566680] group-hover:text-[#8B9BB4]">Buka</span>
          )}
        </button>

        <div className="text-right text-[10px] text-[#8B9BB4] pl-1 font-mono flex-shrink-0">
          <div className="text-[9px] text-[#566680]">Proyeksi</div>
          <span className="text-[#00D2FF] font-semibold">EPSG:4326</span>
        </div>
      </div>

      {/* MODAL KONFIRMASI PENGHAPUSAN (WILAYAH ATAU LAYER TUNGGAL) */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0D1322] border border-[#1E2942] rounded-xl shadow-2xl max-w-sm w-full p-5 text-[#F0F6FC] animate-in fade-in duration-200">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  deleteModal.isLastFile
                    ? 'bg-amber-500/15 border border-amber-500/40 text-amber-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}
              >
                <IconTrash className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-[#F0F6FC]">
                  {deleteModal.type === 'wilayah'
                    ? 'Hapus Seluruh Data Wilayah?'
                    : deleteModal.isLastFile
                    ? 'Hapus File Terakhir & Wilayah?'
                    : 'Hapus File / Layer Spasial?'}
                </h3>
                <div className="mt-2 text-xs text-[#8B9BB4] leading-relaxed space-y-2">
                  {deleteModal.type === 'wilayah' ? (
                    <p>
                      Anda akan menghapus seluruh data pada wilayah{' '}
                      <strong className="text-red-400">{deleteModal.name}</strong>, termasuk
                      seluruh unit kebun, data shapefile/layer, dan poligon lahan di dalamnya.
                      Tindakan ini tidak dapat dibatalkan.
                    </p>
                  ) : deleteModal.isLastFile ? (
                    <>
                      <p>
                        Anda akan menghapus file/layer{' '}
                        <strong className="text-[#00D2FF]">{deleteModal.name}</strong>.
                      </p>
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] leading-normal">
                        ⚠️ <strong>Peringatan File Terakhir:</strong> Ini adalah <strong>satu-satunya file/layer yang tersisa</strong> di wilayah{' '}
                        <strong>{deleteModal.parentName}</strong>. Karena seluruh file di wilayah ini habis,{' '}
                        <strong className="underline">wilayah {deleteModal.parentName} dan unit kebunnya akan otomatis ikut terhapus dari sistem</strong>.
                      </div>
                    </>
                  ) : (
                    <p>
                      Anda akan menghapus layer/file{' '}
                      <strong className="text-red-400">{deleteModal.name}</strong> dari wilayah{' '}
                      <strong className="text-[#00D2FF]">{deleteModal.parentName || 'Terkait'}</strong>.
                      Hanya file ini saja yang akan terhapus, data wilayah dan {deleteModal.totalFiles ? deleteModal.totalFiles - 1 : ''} layer lainnya tetap aman.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteModal(null)}
                className="px-3 py-1.5 rounded-lg bg-[#12192B] border border-[#1E2942] hover:bg-[#19233A] text-xs font-semibold text-[#8B9BB4] hover:text-[#F0F6FC] transition-colors cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    if (deleteModal.type === 'wilayah') {
                      await onDeleteWilayah?.(deleteModal.name);
                    } else if (deleteModal.type === 'layer' && deleteModal.id) {
                      await onDeleteLayer?.(deleteModal.id, deleteModal.name);
                    }
                    setDeleteModal(null);
                  } catch (err) {
                    console.error('Delete error:', err);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className={`px-3.5 py-1.5 rounded-lg text-white text-xs font-bold shadow-md transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                  deleteModal.isLastFile
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-red-600 hover:bg-red-500'
                }`}
              >
                {isDeleting ? (
                  <span>Menghapus...</span>
                ) : (
                  <>
                    <IconTrash className="w-3.5 h-3.5" />
                    <span>
                      {deleteModal.type === 'wilayah'
                        ? 'Hapus Semua Data Wilayah'
                        : deleteModal.isLastFile
                        ? 'Hapus File & Wilayah Ini'
                        : 'Hapus File Ini Saja'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
