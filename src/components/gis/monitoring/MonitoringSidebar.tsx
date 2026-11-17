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
  IconMap,
  IconCheck,
  IconClose,
} from '../GisIcons';
import type { LayerPeta } from '@/types/gis';
import { kebunPerusahaanLabel, listAvailablePerusahaan } from '@/lib/perusahaan';
import { toMasterId } from '@/lib/ids';

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
      const layerKebunId = toMasterId(layer.kebun_id);
      const matchKebun = kebunList.find((k) => toMasterId(k.id) === layerKebunId);
      const wil = (layer.wilayah || matchKebun?.wilayah || 'Wilayah Belum Ditentukan').trim();
      const kbn = (layer.nama_kebun || matchKebun?.nama_kebun || 'Kebun Umum').trim();

      if (!result[wil]) result[wil] = {};
      if (!result[wil][kbn]) result[wil][kbn] = [];
      result[wil][kbn].push(layer);
    });

    return result;
  }, [layers, kebunList]);
  const availablePerusahaan = useMemo(
    () => listAvailablePerusahaan(kebunList),
    [kebunList]
  );

  // 2. Cascading Wilayah berdasarkan Perusahaan terpilih
  const filteredByPerusahaanKebun = selectedPerusahaan
    ? kebunList.filter(
        (k) => kebunPerusahaanLabel(k.perusahaan) === selectedPerusahaan
      )
    : kebunList;

  const availableWilayah = Array.from(
    new Set(
      filteredByPerusahaanKebun
        .map((k) => k.wilayah?.trim())
        .filter((w): w is string => Boolean(w && w.length > 0))
    )
  );

  // 3. Kebun berdasarkan Wilayah & Perusahaan terpilih
  const filteredKebun = selectedWilayah
    ? filteredByPerusahaanKebun.filter((k) => k.wilayah?.trim() === selectedWilayah)
    : filteredByPerusahaanKebun;

  // 4. Afdeling berdasarkan Kebun terpilih
  const filteredAfdeling = selectedKebunId
    ? afdelingList.filter((a) => toMasterId(a.kebun_id) === selectedKebunId)
    : (selectedWilayah || selectedPerusahaan)
    ? afdelingList.filter((a) =>
        filteredKebun.some((k) => toMasterId(k.id) === toMasterId(a.kebun_id))
      )
    : afdelingList;

  // 5. Blok berdasarkan Afdeling terpilih
  const filteredBlok = selectedAfdelingId
    ? blokList.filter((b) => b.afdeling_id === selectedAfdelingId)
    : selectedKebunId
    ? blokList.filter((b) => {
        const parentAfd = afdelingList.find((a) => a.id === b.afdeling_id);
        return toMasterId(parentAfd?.kebun_id) === selectedKebunId;
      })
    : blokList;

  if (!isOpen) {
    return (
      <div className="w-10 bg-bg-nav border-r border-border-subtle flex flex-col items-center py-3 select-none shrink-0 z-20">
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded-lg bg-bg-surface border border-border-subtle hover:border-border-active text-text-secondary hover:text-accent-primary transition-colors shadow-md cursor-pointer"
          title="Buka Panel Filter"
        >
          <IconFilter className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <aside
      data-nusa-chrome
      className="w-[min(100vw-2.5rem,18rem)] sm:w-72 bg-bg-nav border-r border-border-subtle flex flex-col select-none shrink-0 z-20 max-lg:z-40 h-full overflow-hidden text-text-primary max-lg:fixed max-lg:left-0 max-lg:top-13 max-lg:bottom-0 max-lg:shadow-2xl lg:relative"
    >
      {/* Header Panel Filter */}
      <div className="h-11 px-4 bg-bg-nav border-b border-border-subtle flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 font-bold text-xs text-text-primary uppercase tracking-wider">
          <IconFilter className="w-3.5 h-3.5 text-accent-primary" />
          <span>Filter Monitoring</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onResetFilters}
            className="p-1 rounded text-text-secondary hover:text-accent-primary hover:bg-bg-surface text-2xs flex items-center gap-1 transition-colors cursor-pointer"
            title="Reset Seluruh Filter"
          >
            <IconRefresh className="w-3 h-3" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
            title="Sembunyikan Panel Filter"
          >
            <IconChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
      {/* Form Cascading Filter — tidak scroll; daftar layer memakai sisa tinggi */}
      <div className="shrink-0 p-4 space-y-3.5 text-xs border-b border-border-subtle">
        {/* 1. Perusahaan (Induk Holding / Entitas Kebun) */}
        <div className="space-y-1.5">
          <label className="text-caption font-semibold text-text-secondary flex items-center justify-between">
            <span>Perusahaan</span>
          </label>
          <select
            value={selectedPerusahaan}
            onChange={(e) => {
              onSelectPerusahaan(e.target.value);
              onSelectWilayah('');
              onSelectKebun(null);
              onSelectAfdeling(null);
              onSelectBlok(null);
            }}
            className="w-full bg-bg-surface border border-border-subtle hover:border-border-subtle focus:border-border-subtle rounded-md px-2.5 py-2 min-h-11 text-xs text-text-primary nusa-focus transition-colors"
          >
            <option value="" className="bg-bg-nav">Semua Perusahaan</option>
            {availablePerusahaan.map((p) => (
              <option key={p} value={p} className="bg-bg-nav">
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Wilayah Geografis */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-caption font-semibold text-text-secondary block">
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
                className="text-2xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors cursor-pointer"
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
              onSelectKebun(null);
              onSelectAfdeling(null);
              onSelectBlok(null);
            }}
            className="w-full bg-bg-surface border border-border-subtle hover:border-border-subtle focus:border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary nusa-focus transition-colors"
          >
            <option value="" className="bg-bg-nav">Semua Wilayah</option>
            {availableWilayah.map((w) => (
              <option key={w} value={w} className="bg-bg-nav">
                {w}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Kebun */}
        <div className="space-y-1.5">
          <label className="text-caption font-semibold text-text-secondary block">
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
            className="w-full bg-bg-surface border border-border-subtle hover:border-border-subtle focus:border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary nusa-focus transition-colors"
          >
            <option value="" className="bg-bg-nav">Semua Kebun</option>
            {filteredKebun.map((k) => (
              <option key={k.id} value={k.id} className="bg-bg-nav">
                {k.nama_kebun} ({k.kode_kebun})
              </option>
            ))}
          </select>
        </div>

        {/* 4. Afdeling (Cascading dari Kebun) */}
        <div className="space-y-1.5">
          <label className="text-caption font-semibold text-text-secondary block">
            Afdeling
          </label>
          <select
            value={selectedAfdelingId || ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null;
              onSelectAfdeling(val);
              onSelectBlok(null);
            }}
            className="w-full bg-bg-surface border border-border-subtle hover:border-border-subtle focus:border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary nusa-focus transition-colors disabled:opacity-40"
          >
            <option value="" className="bg-bg-nav">Semua Afdeling</option>
            {filteredAfdeling.map((a) => (
              <option key={a.id} value={a.id} className="bg-bg-nav">
                {a.nama_afdeling} ({a.kode_afdeling})
              </option>
            ))}
          </select>
        </div>

        {/* 5. Blok (Cascading dari Afdeling) */}
        <div className="space-y-1.5">
          <label className="text-caption font-semibold text-text-secondary block">
            Blok
          </label>
          <select
            value={selectedBlokId || ''}
            onChange={(e) =>
              onSelectBlok(e.target.value ? Number(e.target.value) : null)
            }
            className="w-full bg-bg-surface border border-border-subtle hover:border-border-subtle focus:border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary nusa-focus transition-colors disabled:opacity-40"
          >
            <option value="" className="bg-bg-nav">Semua Blok</option>
            {filteredBlok.map((b) => (
              <option key={b.id} value={b.id} className="bg-bg-nav">
                {b.nama_blok} ({b.kode_blok})
              </option>
            ))}
          </select>
        </div>
      </div>

        {/* 7. MANAJEMEN LAYER GIS */}
        <div className="flex-1 min-h-0 flex flex-col p-4 pt-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-caption font-bold text-text-primary uppercase tracking-wider">
              <IconLayers className="w-3.5 h-3.5 text-accent-primary" />
              <span>Manajemen Layer</span>
            </div>
            <span className="text-2xs bg-bg-surface border border-border-subtle text-text-secondary px-1.5 py-0.5 rounded font-mono">
              {layers.length} Layer
            </span>
          </div>

          {layers.length === 0 ? (
            <div className="text-caption text-text-muted italic p-2 bg-bg-surface/50 rounded border border-border-subtle text-center">
              Belum ada layer spasial aktif.
            </div>
          ) : (
            <div className="flex-1 min-h-0 space-y-2.5 nusa-scroll pr-1">
              {Object.entries(groupedLayers).map(([wilayahName, kebunMap]) => {
                const totalLayersInWilayah = Object.values(kebunMap).reduce(
                  (acc, curr) => acc + curr.length,
                  0
                );

                return (
                  <div
                    key={wilayahName}
                    className="space-y-1.5 pb-2 border-b border-border-subtle/60 last:border-b-0"
                  >
                    {/* Header Wilayah */}
                    <div className="flex items-center justify-between px-1 py-0.5 group">
                      <div className="flex items-center gap-1.5 text-2xs font-bold text-accent-primary uppercase tracking-wider min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />
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
                          className="p-1 rounded text-text-secondary hover:text-status-danger hover:bg-bg-ground transition-colors cursor-pointer"
                          title={`Hapus seluruh data wilayah "${wilayahName}" (${totalLayersInWilayah} file/layer)`}
                        >
                          <IconTrash className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Sub-grup per Kebun */}
                    {Object.entries(kebunMap).map(([kebunName, layerItems]) => (
                      <div key={kebunName} className="pl-1.5 space-y-1">
                        <div className="text-2xs font-semibold text-text-secondary flex items-center gap-1">
                          <IconMap className="w-3 h-3 text-status-success shrink-0" aria-hidden />
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
                                    ? 'bg-bg-surface-hover border-border-active text-accent-primary shadow-xs'
                                    : 'bg-bg-surface border-border-subtle text-text-primary hover:border-border-subtle hover:bg-bg-surface-hover'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0 border border-white/20"
                                      style={{ backgroundColor: layer.warna || '#00D2FF' }}
                                    />
                                    {!isRenaming ? (
                                      <span className="font-semibold truncate text-caption leading-tight">
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
                                          className="w-full bg-bg-nav border border-border-active rounded px-1.5 py-0.5 text-xs text-text-primary nusa-focus"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (renamingText.trim()) {
                                              onRenameLayer?.(layer.id, renamingText.trim());
                                            }
                                            setRenamingLayerId(null);
                                          }}
                                          className="px-1 text-status-success hover:text-white font-bold"
                                          title="Simpan Nama"
                                        >
                                          <IconCheck className="w-3.5 h-3.5" aria-hidden />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setRenamingLayerId(null)}
                                          className="px-1 text-text-secondary hover:text-white font-bold"
                                          title="Batal"
                                        >
                                          <IconClose className="w-3.5 h-3.5" aria-hidden />
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
                                      className="p-1 rounded hover:bg-bg-nav text-text-secondary hover:text-accent-primary transition-colors"
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
                                        className="p-1 rounded hover:bg-bg-ground text-text-secondary hover:text-status-danger transition-colors cursor-pointer"
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
                                        className="p-1 rounded hover:bg-bg-nav text-text-secondary hover:text-accent-primary transition-colors cursor-pointer"
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
                                          ? 'text-accent-primary hover:bg-bg-accent-surface/50'
                                          : 'text-text-muted hover:bg-bg-nav'
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
                                <div className="flex items-center justify-between text-3xs text-text-secondary font-mono px-0.5">
                                  <span className="bg-bg-nav px-1 py-0.5 rounded border border-border-subtle">
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
      <div className="p-2.5 bg-bg-nav border-t border-border-subtle flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-bg-surface hover:bg-bg-surface-hover border border-border-subtle hover:border-border-active/50 text-xs text-text-primary transition-all cursor-pointer group shadow-sm"
          title="Buka Pengaturan Sistem, Cadangan Data & Riwayat Sampah Spasial"
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-accent-primary/10 text-accent-primary flex items-center justify-center group-hover:scale-105 transition-transform">
              <IconSettings className="w-3.5 h-3.5" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-caption group-hover:text-accent-primary transition-colors leading-tight">
                Settings
              </div>
              <div className="text-3xs text-text-secondary leading-tight">Backup & Riwayat</div>
            </div>
          </div>
          {typeof deletedCount === 'number' && deletedCount > 0 ? (
            <span className="px-1.5 py-0.5 rounded-full bg-status-danger text-white text-3xs font-bold shadow-xs">
              {deletedCount}
            </span>
          ) : (
            <span className="text-2xs text-text-muted group-hover:text-text-secondary">Buka</span>
          )}
        </button>

        <div className="text-right text-2xs text-text-secondary pl-1 font-mono flex-shrink-0">
          <div className="text-3xs text-text-muted">Proyeksi</div>
          <span className="text-accent-primary font-semibold">EPSG:4326</span>
        </div>
      </div>

      {/* MODAL KONFIRMASI PENGHAPUSAN (WILAYAH ATAU LAYER TUNGGAL) */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-bg-nav border border-border-subtle rounded-xl shadow-2xl max-w-sm w-full p-5 text-text-primary animate-in fade-in duration-200">
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
                <h3 className="text-sm font-bold text-text-primary">
                  {deleteModal.type === 'wilayah'
                    ? 'Hapus Seluruh Data Wilayah?'
                    : deleteModal.isLastFile
                    ? 'Hapus File Terakhir & Wilayah?'
                    : 'Hapus File / Layer Spasial?'}
                </h3>
                <div className="mt-2 text-xs text-text-secondary leading-relaxed space-y-2">
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
                        <strong className="text-accent-primary">{deleteModal.name}</strong>.
                      </p>
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-caption leading-normal">
                        ⚠️ <strong>Peringatan File Terakhir:</strong> Ini adalah <strong>satu-satunya file/layer yang tersisa</strong> di wilayah{' '}
                        <strong>{deleteModal.parentName}</strong>. Karena seluruh file di wilayah ini habis,{' '}
                        <strong className="underline">wilayah {deleteModal.parentName} dan unit kebunnya akan otomatis ikut terhapus dari sistem</strong>.
                      </div>
                    </>
                  ) : (
                    <p>
                      Anda akan menghapus layer/file{' '}
                      <strong className="text-red-400">{deleteModal.name}</strong> dari wilayah{' '}
                      <strong className="text-accent-primary">{deleteModal.parentName || 'Terkait'}</strong>.
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
                className="px-3 py-1.5 rounded-lg bg-bg-surface border border-border-subtle hover:bg-bg-surface-hover text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50"
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
