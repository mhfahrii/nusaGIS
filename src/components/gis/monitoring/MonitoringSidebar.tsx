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
  IconTrash,
  IconClose,
} from '../GisIcons';
import {
  RPN_ENTITY_OPTIONS,
  normalizePerusahaanName,
  matchPerusahaanFilter,
} from '@/lib/gis/rpnEntities';
import {
  parseWilayahHierarchy,
  resolveLokasiLabel,
  matchWilayahFilter,
  formatKebunOptionLabel,
} from '@/lib/gis/wilayah';
import type { LayerPeta } from '@/types/gis';
import { CustomFilterDropdown, type DropdownOption } from './CustomFilterDropdown';

interface KebunItem {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  perusahaan?: string | null;
  wilayah: string | null;
  provinsi?: string | null;
  kabupaten_kota?: string | null;
}

interface AfdelingItem {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
}

interface MonitoringSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  selectedStatusFilter?: string;
  onSelectStatusFilter?: (status: string) => void;
  // Master lists
  kebunList: KebunItem[];
  afdelingList: AfdelingItem[];
  // Selected filter states
  selectedPerusahaan: string;
  onSelectPerusahaan: (perusahaan: string) => void;
  selectedWilayah: string;
  onSelectWilayah: (wilayah: string) => void;
  selectedKebunId: number | null;
  onSelectKebun: (id: number | null) => void;
  selectedAfdelingId: number | null;
  onSelectAfdeling: (id: number | null) => void;
  blokOptions?: DropdownOption<string>[];
  selectedBlokValue?: string | null;
  onSelectBlok?: (value: string | null) => void;
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
  isMandorLocked?: boolean;
  lockedAfdelingName?: string;
}

export function MonitoringSidebar({
  isOpen,
  onToggle,
  isMobileOpen = false,
  onCloseMobile,
  selectedStatusFilter = 'all',
  onSelectStatusFilter,
  kebunList,
  afdelingList,
  selectedPerusahaan,
  onSelectPerusahaan,
  selectedWilayah,
  onSelectWilayah,
  selectedKebunId,
  onSelectKebun,
  selectedAfdelingId,
  onSelectAfdeling,
  blokOptions = [],
  selectedBlokValue = null,
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
  isMandorLocked = false,
  lockedAfdelingName,
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
  // State collapse untuk pengelompokan wilayah di daftar layer
  const [collapsedWilayah, setCollapsedWilayah] = useState<Record<string, boolean>>({});
  const toggleWilayahCollapse = (wil: string) => {
    setCollapsedWilayah((prev) => ({ ...prev, [wil]: !prev[wil] }));
  };

  // Pengelompokan Hirarkis Layer GIS: Lokasi (Kota/Kabupaten) -> Kebun -> Layers
  const groupedLayers = useMemo(() => {
    const result: Record<string, Record<string, LayerPeta[]>> = {};

    layers.forEach((layer) => {
      const matchKebun = kebunList.find((k) => k.id === layer.kebun_id);
      const rawWil = layer.wilayah || matchKebun?.wilayah || '';
      const lokasiName =
        resolveLokasiLabel(
          matchKebun?.kabupaten_kota || layer.kabupaten_kota,
          rawWil,
          layer.provinsi || matchKebun?.provinsi
        ) || 'Lokasi Belum Ditentukan';

      const parsed = parseWilayahHierarchy(rawWil);
      const kbnBase = (layer.nama_kebun || matchKebun?.nama_kebun || 'Kebun Umum').trim();
      const kab = (matchKebun?.kabupaten_kota || layer.kabupaten_kota || parsed.kabupatenKota || '').trim();
      const kbnLabel = kab && kab.toLowerCase() !== lokasiName.toLowerCase() ? `${kbnBase} (${kab})` : kbnBase;

      if (!result[lokasiName]) result[lokasiName] = {};
      if (!result[lokasiName][kbnLabel]) result[lokasiName][kbnLabel] = [];
      result[lokasiName][kbnLabel].push(layer);
    });

    return result;
  }, [layers, kebunList]);

  // 1. Daftar resmi 5 Puslit PT RPN + perusahaan tambahan dari DB (tanpa duplikat)
  const rawPerusahaan = kebunList
    .map((k) => normalizePerusahaanName(k.perusahaan))
    .filter((p) => p && p !== 'PT Riset Perkebunan Nusantara (PT RPN)');

  const availablePerusahaan = Array.from(
    new Set([...RPN_ENTITY_OPTIONS, ...rawPerusahaan])
  );

  // 2. Cascading Lokasi (Kota/Kabupaten, fallback provinsi/wilayah) berdasarkan Perusahaan terpilih
  const filteredByPerusahaanKebun = selectedPerusahaan
    ? kebunList.filter((k) => matchPerusahaanFilter(k.perusahaan, selectedPerusahaan))
    : kebunList;

  const sourceLayersForWilayah = allLayers ?? layers;
  const lokasiMap = new Map<string, string>();
  for (const k of filteredByPerusahaanKebun) {
    const lok = resolveLokasiLabel(k.kabupaten_kota, k.wilayah, k.provinsi);
    if (lok && !lokasiMap.has(lok.toLowerCase())) {
      lokasiMap.set(lok.toLowerCase(), lok);
    }
  }
  for (const l of sourceLayersForWilayah) {
    if (selectedPerusahaan) {
      const matchedKebun = l.kebun_id ? kebunList.find((k) => k.id === l.kebun_id) : undefined;
      if (!matchPerusahaanFilter(l.perusahaan || matchedKebun?.perusahaan, selectedPerusahaan)) {
        continue;
      }
    }
    const lok = resolveLokasiLabel(l.kabupaten_kota, l.wilayah, l.provinsi);
    if (lok && !lokasiMap.has(lok.toLowerCase())) {
      lokasiMap.set(lok.toLowerCase(), lok);
    }
  }
  const availableWilayah = Array.from(lokasiMap.values()).sort((a, b) => a.localeCompare(b, 'id'));

  // 3. Kebun berdasarkan Lokasi (Kota/Kabupaten) & Perusahaan terpilih
  const filteredKebun = selectedWilayah
    ? filteredByPerusahaanKebun.filter((k) =>
        matchWilayahFilter(k.wilayah, selectedWilayah, k.provinsi, k.kabupaten_kota)
      )
    : filteredByPerusahaanKebun;

  // 4. Afdeling berdasarkan Kebun terpilih
  const filteredAfdeling = selectedKebunId
    ? afdelingList.filter((a) => a.kebun_id === selectedKebunId)
    : (selectedWilayah || selectedPerusahaan)
    ? afdelingList.filter((a) => filteredKebun.some((k) => k.id === a.kebun_id))
    : afdelingList;

  if (!isOpen && !isMobileOpen) {
    return (
      <div className="hidden lg:flex w-10 bg-[#0D1322] border-r border-[#1E2942] flex-col items-center py-3 select-none shrink-0 z-20">
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded-lg bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors shadow-md cursor-pointer"
          title="Buka Panel Filter"
          aria-label="Buka Panel Filter"
        >
          <IconFilter className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[1190] bg-black/60 backdrop-blur-[1px] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {!isOpen && (
        <div className="hidden lg:flex w-10 bg-[#0D1322] border-r border-[#1E2942] flex-col items-center py-3 select-none shrink-0 z-20">
          <button
            type="button"
            onClick={onToggle}
            className="p-2 rounded-lg bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors shadow-md cursor-pointer"
            title="Buka Panel Filter"
            aria-label="Buka Panel Filter"
          >
            <IconFilter className="w-4 h-4" />
          </button>
        </div>
      )}

      <aside
        className={`${
          isMobileOpen
            ? 'fixed inset-y-0 left-0 z-[1200] flex w-[86vw] max-w-[320px] shadow-2xl'
            : 'hidden'
        } ${
          isOpen ? 'lg:static lg:z-20 lg:flex lg:w-64 xl:w-72 lg:shadow-none' : 'lg:hidden'
        } bg-[#0D1322] border-r border-[#1E2942] flex-col select-none shrink-0 h-full overflow-hidden text-[#F0F6FC]`}
      >
        {/* Header Panel Filter */}
        <div className="h-12 lg:h-11 px-4 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-bold text-xs text-[#F0F6FC] uppercase tracking-wider">
            <IconFilter className="w-3.5 h-3.5 text-[#00D2FF]" />
            <span>Filter Monitoring</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onResetFilters}
              className="min-h-9 lg:min-h-0 px-2 lg:p-1 rounded text-[#8B9BB4] hover:text-[#00D2FF] hover:bg-[#12192B] text-[11px] lg:text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
              title="Reset Seluruh Filter"
            >
              <IconRefresh className="w-3 h-3" />
              <span>Reset</span>
            </button>
            <button
              type="button"
              onClick={onToggle}
              className="hidden lg:inline-flex p-1 rounded text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
              title="Sembunyikan Panel Filter"
              aria-label="Sembunyikan Panel Filter"
            >
              <IconChevronRight className="w-3.5 h-3.5" />
            </button>
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="lg:hidden min-w-10 min-h-10 flex items-center justify-center rounded-lg text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
                title="Tutup Panel Filter"
                aria-label="Tutup Panel Filter"
              >
                <IconClose className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Form Cascading Filter */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
          {isMandorLocked && (
            <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-[10.5px] text-emerald-200 leading-snug">
              <div className="font-bold text-emerald-400 uppercase tracking-wider text-[9.5px] mb-0.5">
                🔒 Wilayah Tugas Mandor
              </div>
              Afdeling terkunci pada <strong>{lockedAfdelingName || 'Afdeling Tugas'}</strong>. Silakan pilih petak pada filter <strong>Blok</strong> di bawah.
            </div>
          )}

          {/* Status Pengelolaan (khusus mobile/tablet karena header tengah tersembunyi di < lg) */}
          {onSelectStatusFilter && (
            <div className="space-y-1.5 lg:hidden">
              <label className="text-[11px] font-semibold text-[#8B9BB4] block">
                Status Pengelolaan
              </label>
              <select
                value={selectedStatusFilter}
                onChange={(e) => onSelectStatusFilter(e.target.value)}
                className="w-full min-h-10 bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-2 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
              >
                <option value="all" className="bg-[#0D1322]">Semua Status Areal</option>
                <option value="ktg" className="bg-[#0D1322]">KTG (Kebun Sendiri)</option>
                <option value="ks_gpa" className="bg-[#0D1322]">KS GPA 2023 (Garapan)</option>
              </select>
            </div>
          )}
          {/* 1. Perusahaan / Puslit (Lingkup PT RPN) */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-[#8B9BB4] flex items-center justify-between gap-1">
              <span>Perusahaan / Puslit</span>
              {selectedPerusahaan && (
                <span className="text-[10px] font-mono text-[#00D2FF] tabular-nums">
                  {availableWilayah.length} Lokasi · {filteredByPerusahaanKebun.length} Kebun
                </span>
              )}
            </label>
            <select
              disabled={isMandorLocked}
              value={selectedPerusahaan}
              onChange={(e) => {
                onSelectPerusahaan(e.target.value);
              }}
              className="w-full min-h-10 lg:min-h-0 bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-2 lg:py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="" className="bg-[#0D1322]">Semua Perusahaan (PT RPN)</option>
              {availablePerusahaan.map((p) => (
                <option key={p} value={p} className="bg-[#0D1322]">
                  {p}
                </option>
              ))}
            </select>
          </div>

        {/* 2. Lokasi (Kota / Kabupaten) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-[#8B9BB4] block">
              Lokasi
            </label>
            {selectedWilayah && onDeleteWilayah && !isMandorLocked && (
              <button
                type="button"
                onClick={() =>
                  setDeleteModal({
                    type: 'wilayah',
                    name: selectedWilayah,
                  })
                }
                className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors cursor-pointer"
                title={`Hapus seluruh data lokasi "${selectedWilayah}"`}
              >
                <IconTrash className="w-2.5 h-2.5" />
                <span>Hapus Lokasi</span>
              </button>
            )}
          </div>
          <select
            disabled={isMandorLocked}
            value={selectedWilayah}
            onChange={(e) => {
              onSelectWilayah(e.target.value);
            }}
            className="w-full min-h-10 lg:min-h-0 bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-2 lg:py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="" className="bg-[#0D1322]">Semua Lokasi</option>
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
            disabled={isMandorLocked}
            value={selectedKebunId || ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null;
              onSelectKebun(val);
            }}
            className="w-full min-h-10 lg:min-h-0 bg-[#12192B] border border-[#1E2942] hover:border-[#2C3B59] focus:border-[#00D2FF] rounded-md px-2.5 py-2 lg:py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="" className="bg-[#0D1322]">Semua Kebun</option>
            {filteredKebun.map((k) => (
              <option key={k.id} value={k.id} className="bg-[#0D1322]">
                {formatKebunOptionLabel(k.nama_kebun, k.kabupaten_kota, k.provinsi, k.wilayah)}
              </option>
            ))}
          </select>
        </div>

        {/* 4. Afdeling (Cascading dari Kebun). Terkunci jika Mandor ditugaskan pada 1 Afdeling. */}
        <CustomFilterDropdown
          label="Afdeling"
          value={selectedAfdelingId}
          placeholder={
            isMandorLocked && lockedAfdelingName
              ? lockedAfdelingName
              : selectedKebunId && filteredAfdeling.length === 0
              ? '(Tanpa Afdeling)'
              : 'Semua Afdeling'
          }
          options={filteredAfdeling.map((a) => ({
            value: a.id,
            label: a.nama_afdeling,
            sublabel: a.kode_afdeling,
          }))}
          onChange={onSelectAfdeling}
          disabled={isMandorLocked || filteredAfdeling.length === 0}
        />

        {/* 5. Blok (Cascading dari Kebun / Afdeling) */}
        {onSelectBlok && (
          <CustomFilterDropdown<string>
            label="Blok"
            value={selectedBlokValue}
            placeholder={
              !selectedKebunId
                ? 'Pilih kebun terlebih dahulu'
                : blokOptions.length === 0
                  ? 'Belum ada blok'
                  : `Semua Blok (${blokOptions.length})`
            }
            options={blokOptions}
            onChange={onSelectBlok}
            disabled={!selectedKebunId || blokOptions.length === 0}
            searchable
          />
        )}

        {/* Info Ringkas Panduan Penggunaan untuk Pemula */}
        <div className="mt-4 p-3 rounded-xl bg-[#12192B]/70 border border-[#1E2942] text-[11px] text-[#8B9BB4] space-y-1.5 leading-relaxed">
          <div className="font-bold text-[#E2E8F0] text-[11px]">Panduan Singkat</div>
          <p>
            Pilih <strong className="text-[#00D2FF]">Kebun / Blok</strong> di atas atau klik langsung petak lahan di peta untuk melihat informasi detail di panel sebelah kanan.
          </p>
        </div>
      </div>

      {/* MODAL KONFIRMASI PENGHAPUSAN (WILAYAH ATAU LAYER TUNGGAL) */}
      {deleteModal && (
        <div className="fixed inset-0 z-[1300] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
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
                    ? 'Hapus Seluruh Data Lokasi?'
                    : deleteModal.isLastFile
                    ? 'Hapus File Terakhir & Lokasi?'
                    : 'Hapus File / Layer Spasial?'}
                </h3>
                <div className="mt-2 text-xs text-[#8B9BB4] leading-relaxed space-y-2">
                  {deleteModal.type === 'wilayah' ? (
                    <p>
                      Anda akan menghapus seluruh data pada lokasi{' '}
                      <strong className="text-red-400">{deleteModal.name}</strong>. Data akan dipindahkan ke{' '}
                      <strong className="text-[#00D2FF]">Backup &amp; Riwayat &gt; Tempat Sampah</strong> pada halaman profil agar dapat dihapus permanen beserta cache-nya atau dipulihkan kembali.
                    </p>
                  ) : deleteModal.isLastFile ? (
                    <>
                      <p>
                        Anda akan menghapus file/layer{' '}
                        <strong className="text-[#00D2FF]">{deleteModal.name}</strong>.
                      </p>
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] leading-normal">
                        <strong>Peringatan File Terakhir:</strong> Ini adalah satu-satunya file/layer aktif di lokasi{' '}
                        <strong>{deleteModal.parentName}</strong>. Lokasi ini akan disembunyikan dari peta dan file dipindahkan ke{' '}
                        <strong>Backup &amp; Riwayat &gt; Tempat Sampah</strong> untuk dihapus permanen.
                      </div>
                    </>
                  ) : (
                    <p>
                      Anda akan menghapus layer/file{' '}
                      <strong className="text-red-400">{deleteModal.name}</strong> dari lokasi{' '}
                      <strong className="text-[#00D2FF]">{deleteModal.parentName || 'Terkait'}</strong>.
                      File ini akan masuk ke <strong>Backup &amp; Riwayat &gt; Tempat Sampah</strong> untuk dihapus permanen atau dipulihkan.
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
    </>
  );
}
