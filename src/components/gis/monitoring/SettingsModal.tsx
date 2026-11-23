'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  IconClose,
  IconSettings,
  IconDownload,
  IconRefresh,
  IconTrash,
  IconRotateCcw,
  IconHistory,
  IconDatabase,
  IconCheck,
  IconLayers,
} from '@/components/gis/GisIcons';

interface DeletedFeature {
  id: number;
  layer_id: number;
  nama_layer: string;
  nama_kebun: string;
  nama_afdeling: string;
  atribut: Record<string, unknown>;
  geometry_type: string;
  luas_ha: number | null;
  dihapus_pada: string;
  dibuat_pada: string;
}

interface DeletedLayerItem {
  id: number;
  item_type: 'layer' | 'orphan_upload';
  unggahan_id: number | null;
  nama_layer: string;
  nama_file: string | null;
  tipe_geometri: string;
  jumlah_fitur: number;
  nama_kebun: string;
  wilayah: string;
  luas_ha: number | null;
  ukuran_bytes: number;
  dihapus_pada: string;
}

interface ActivityLog {
  id: number;
  aktivitas: string;
  keterangan: string | null;
  dibuat_pada: string;
  nama_pengguna: string;
  role: string;
}

interface HistoryResponse {
  deleted_layers: DeletedLayerItem[];
  deleted_features: DeletedFeature[];
  activity_logs: ActivityLog[];
  counts: {
    total_deleted: number;
    total_deleted_layers?: number;
    total_deleted_features?: number;
    total_active: number;
    total_logs: number;
    cache_bytes?: number;
    temp_cache_files?: number;
  };
}

type ConfirmTarget =
  | { kind: 'all' }
  | { kind: 'feature'; id: number; name: string }
  | { kind: 'layer'; id: number; name: string }
  | { kind: 'orphan_upload'; id: number; name: string };

interface SettingsModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onDataChanged?: () => void;
  initialTab?: 'backup' | 'history';
  embedded?: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function SettingsModal({
  isOpen,
  onClose,
  onDataChanged,
  initialTab = 'backup',
  embedded = false,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'backup' | 'history'>(initialTab);
  const [loading, setLoading] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [showConfirmPermanent, setShowConfirmPermanent] = useState<ConfirmTarget | null>(null);
  const [viewAuditLog, setViewAuditLog] = useState<boolean>(false);

  // Load data history & trash
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gis/history');
      const json = await res.json();
      if (json.status === 'success') {
        setData(json.data);
      } else {
        setActionMessage({ type: 'error', text: json.message || 'Gagal memuat data riwayat.' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Koneksi ke server gagal.';
      setActionMessage({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      setActiveTab(initialTab);
      setActionMessage(null);
      fetchHistory();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, initialTab, fetchHistory]);

  // Flash message auto clear
  useEffect(() => {
    if (actionMessage) {
      const timer = setTimeout(() => setActionMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionMessage]);

  if (!isOpen) return null;

  // Handler: Pulihkan Layer / File
  const handleRestoreLayer = async (layerId: number) => {
    setProcessingKey(`layer-${layerId}`);
    try {
      const res = await fetch('/api/gis/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore_layer', layer_id: layerId }),
      });
      const json = await res.json();
      if (json.status === 'success') {
        setActionMessage({ type: 'success', text: json.message });
        await fetchHistory();
        onDataChanged?.();
      } else {
        setActionMessage({ type: 'error', text: json.message || 'Gagal memulihkan file/layer.' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Gagal memulihkan file/layer karena kesalahan jaringan.' });
    } finally {
      setProcessingKey(null);
    }
  };

  // Handler: Pulihkan Fitur (Restore)
  const handleRestoreFeature = async (id: number) => {
    setProcessingKey(`feat-${id}`);
    try {
      const res = await fetch('/api/gis/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', id }),
      });
      const json = await res.json();
      if (json.status === 'success') {
        setActionMessage({ type: 'success', text: json.message });
        await fetchHistory();
        onDataChanged?.();
      } else {
        setActionMessage({ type: 'error', text: json.message || 'Gagal memulihkan fitur.' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Gagal memulihkan data karena kesalahan jaringan.' });
    } finally {
      setProcessingKey(null);
    }
  };

  // Handler: Pulihkan Semua
  const handleRestoreAll = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gis/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore_all' }),
      });
      const json = await res.json();
      if (json.status === 'success') {
        setActionMessage({ type: 'success', text: json.message });
        await fetchHistory();
        onDataChanged?.();
      } else {
        setActionMessage({ type: 'error', text: json.message || 'Gagal memulihkan data.' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Gagal memulihkan data karena kesalahan jaringan.' });
    } finally {
      setLoading(false);
    }
  };

  // Handler: Hapus Permanen Single Item (Layer, Orphan Upload, atau Feature)
  const handlePermanentDeleteItem = async (target: Exclude<ConfirmTarget, { kind: 'all' }>) => {
    const key = `${target.kind}-${target.id}`;
    setProcessingKey(key);
    try {
      const queryParam =
        target.kind === 'layer'
          ? `layer_id=${target.id}`
          : target.kind === 'orphan_upload'
          ? `upload_id=${target.id}`
          : `id=${target.id}`;
      const res = await fetch(`/api/gis/history?${queryParam}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.status === 'success') {
        setActionMessage({ type: 'success', text: json.message });
        setShowConfirmPermanent(null);
        await fetchHistory();
        onDataChanged?.();
      } else {
        setActionMessage({ type: 'error', text: json.message || 'Gagal menghapus permanen.' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Gagal menghapus permanen karena kesalahan jaringan.' });
    } finally {
      setProcessingKey(null);
    }
  };

  // Handler: Kosongkan Tempat Sampah & Bersihkan Cache
  const handleEmptyTrash = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gis/history?empty_trash=true', {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.status === 'success') {
        setActionMessage({ type: 'success', text: json.message });
        setShowConfirmPermanent(null);
        await fetchHistory();
        onDataChanged?.();
      } else {
        setActionMessage({ type: 'error', text: json.message || 'Gagal mengosongkan tempat sampah.' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Gagal mengosongkan tempat sampah.' });
    } finally {
      setLoading(false);
    }
  };

  // Handler: Download Backup
  const handleDownloadBackup = () => {
    setIsExporting(true);
    const link = document.createElement('a');
    link.href = '/api/gis/backup?download=true';
    link.download = `nusagis-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setIsExporting(false);
      setActionMessage({
        type: 'success',
        text: 'File cadangan basis data spasial (.json) berhasil diunduh.',
      });
      fetchHistory();
    }, 1200);
  };

  // Filter deleted layers / archives
  const filteredDeletedLayers = (data?.deleted_layers || []).filter((item) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (item.nama_layer || '').toLowerCase().includes(term) ||
      (item.nama_file || '').toLowerCase().includes(term) ||
      (item.nama_kebun || '').toLowerCase().includes(term) ||
      (item.wilayah || '').toLowerCase().includes(term)
    );
  });

  // Filter deleted individual features
  const filteredDeletedFeatures = (data?.deleted_features || []).filter((item) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const name = String(
      item.atribut?.Name || item.atribut?.nama_blok || item.atribut?.nama_unit || item.atribut?.KODE_BLOK || ''
    ).toLowerCase();
    const layer = (item.nama_layer || '').toLowerCase();
    const kebun = (item.nama_kebun || '').toLowerCase();
    const afd = (item.nama_afdeling || '').toLowerCase();
    return name.includes(term) || layer.includes(term) || kebun.includes(term) || afd.includes(term);
  });

  const deletedCount = data?.counts.total_deleted || 0;
  const restorableCount =
    (data?.deleted_layers || []).filter((l) => l.item_type === 'layer').length +
    (data?.deleted_features || []).length;
  const activeCount = data?.counts.total_active || 0;
  const cacheBytes = data?.counts.cache_bytes || 0;
  const hasTrashOrCache = deletedCount > 0 || cacheBytes > 0 || (data?.counts.temp_cache_files || 0) > 0;

  return (
    <div
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : 'true'}
      aria-label="Backup dan Riwayat Data GIS"
      className={
        embedded
          ? 'w-full'
          : 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4 animate-fadeIn'
      }
    >
      <div
        className={
          embedded
            ? 'relative w-full bg-[#0D1322] border border-[#1E2942] rounded-2xl shadow-xl flex flex-col overflow-hidden text-[#E2E8F0]'
            : 'relative w-full max-w-4xl max-h-[92dvh] bg-[#0D1322] border border-[#1E2942] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#E2E8F0]'
        }
      >
        {/* Modal Header */}
        <div className="p-3.5 sm:p-5 bg-[#090D18] border-b border-[#1E2942] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#00D2FF]/10 border border-[#00D2FF]/30 flex items-center justify-center text-[#00D2FF] shadow-sm shrink-0">
              <IconSettings className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-lg font-bold text-white tracking-wide truncate">
                  Backup &amp; Riwayat Data GIS
                </h2>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#12192B] text-[#00D2FF] border border-[#1E2942]">
                  PostGIS Engine
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-[#8B9BB4] mt-0.5 line-clamp-1">
                Pusat cadangan dataset spasial, pemulihan file/folder terhapus, dan pembersihan permanen cache server.
              </p>
            </div>
          </div>

          {!embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup dialog settings"
              className="min-w-9 min-h-9 flex items-center justify-center rounded-lg bg-[#12192B] hover:bg-[#1E2942] text-[#8B9BB4] hover:text-white transition-colors cursor-pointer shrink-0"
              title="Tutup dialog"
            >
              <IconClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="px-3 sm:px-5 pt-2.5 sm:pt-3 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('backup')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all cursor-pointer border-b-2 ${
                activeTab === 'backup'
                  ? 'border-[#00D2FF] text-[#00D2FF] bg-[#12192B]'
                  : 'border-transparent text-[#8B9BB4] hover:text-white hover:bg-[#12192B]/50'
              }`}
            >
              <IconDownload className="w-4 h-4" />
              <span>Back Up Data</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all cursor-pointer border-b-2 ${
                activeTab === 'history'
                  ? 'border-[#00D2FF] text-[#00D2FF] bg-[#12192B]'
                  : 'border-transparent text-[#8B9BB4] hover:text-white hover:bg-[#12192B]/50'
              }`}
            >
              <IconHistory className="w-4 h-4" />
              <span>History &amp; Tempat Sampah</span>
              {deletedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#EF4444] text-white">
                  {deletedCount}
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={fetchHistory}
            disabled={loading}
            className="text-xs text-[#8B9BB4] hover:text-[#00D2FF] flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#12192B] border border-[#1E2942] transition-colors cursor-pointer"
            title="Segarkan data"
          >
            <IconRefresh className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#00D2FF]' : ''}`} />
            <span className="hidden sm:inline">Segarkan</span>
          </button>
        </div>

        {/* Action Message Banner */}
        {actionMessage && (
          <div
            className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all ${
              actionMessage.type === 'success'
                ? 'bg-[#10B981]/15 border border-[#10B981]/40 text-[#10B981]'
                : 'bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444]'
            }`}
          >
            <div className="flex items-center gap-2">
              {actionMessage.type === 'success' ? (
                <IconCheck className="w-4 h-4 shrink-0" />
              ) : (
                <IconTrash className="w-4 h-4 shrink-0" />
              )}
              <span>{actionMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionMessage(null)}
              className="text-current opacity-70 hover:opacity-100 cursor-pointer text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {/* TAB 1: BACK UP DATA */}
          {activeTab === 'backup' && (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 bg-[#12192B] border border-[#1E2942] rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#00D2FF]/10 text-[#00D2FF] flex items-center justify-center">
                    <IconDatabase className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] text-[#8B9BB4]">Total Fitur Aktif</div>
                    <div className="text-lg font-bold text-white font-mono">{activeCount} Poligon</div>
                  </div>
                </div>

                <div className="p-3.5 bg-[#12192B] border border-[#1E2942] rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#10B981]/10 text-[#10B981] flex items-center justify-center">
                    <IconDownload className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] text-[#8B9BB4]">Format Cadangan</div>
                    <div className="text-sm font-bold text-[#10B981]">GeoJSON &amp; DB JSON</div>
                  </div>
                </div>

                <div className="p-3.5 bg-[#12192B] border border-[#1E2942] rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] flex items-center justify-center">
                    <IconHistory className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] text-[#8B9BB4]">Item di Tempat Sampah</div>
                    <div className="text-lg font-bold text-[#F59E0B] font-mono">
                      {deletedCount} Item ({formatBytes(cacheBytes)})
                    </div>
                  </div>
                </div>
              </div>

              {/* Download Card */}
              <div className="p-5 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-4">
                <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#00D2FF]"></span>
                      Cadangan Basis Data Spasial Penuh (Full Snapshot)
                    </h3>
                    <p className="text-xs text-[#8B9BB4] mt-1 max-w-xl leading-relaxed">
                      Mengunduh seluruh konfigurasi layer aktif, batas koordinat polygon asli (PostGIS WGS84
                      EPSG:4326), perhitungan luas geodesik Hektar, dan atribut lengkap DBF ke dalam berkas standar
                      GeoJSON / JSON yang dapat diimpor kembali atau dibuka di QGIS/ArcGIS Pro.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    disabled={isExporting}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#00A3FF] to-[#00D2FF] hover:from-[#0090E0] hover:to-[#00BDE6] text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#00D2FF]/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <IconDownload className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
                    <span>{isExporting ? 'Mengemas Cadangan...' : 'Unduh Cadangan (.json)'}</span>
                  </button>
                </div>

                <div className="pt-3 border-t border-[#1E2942] grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[#8B9BB4]">
                  <div className="flex items-center gap-2">
                    <span className="text-[#00D2FF]">✓</span> Kompatibel dengan ArcGIS Pro &amp; QGIS GeoJSON
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#00D2FF]">✓</span> Mencakup seluruh histori atribut &amp; luas legal
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#00D2FF]">✓</span> Dilengkapi stempel waktu ekspor ISO 8601
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#00D2FF]">✓</span> Tidak memotong poligon yang sedang aktif
                  </div>
                </div>
              </div>

              {/* Info Panduan Keamanan Data */}
              <div className="p-4 bg-[#090D18] border border-[#1E2942] rounded-xl text-xs text-[#8B9BB4] space-y-2">
                <div className="font-semibold text-white flex items-center gap-2">
                  <span className="text-[#10B981]">●</span> Protokol Tempat Sampah &amp; Hapus Permanen:
                </div>
                <p className="leading-relaxed text-[11px]">
                  Setiap file/layer, folder wilayah, maupun poligon lahan yang dihapus dari panel kiri akan masuk ke tab{' '}
                  <strong>History &amp; Tempat Sampah</strong>. Anda dapat memulihkannya kembali ke peta atau menekan{' '}
                  <strong>Hapus Permanen / Kosongkan Sampah</strong> untuk menghapus data PostGIS beserta arsip fisik
                  ZIP dan cache server sampai bersih.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: HISTORY & TEMPAT SAMPAH (RECYCLE BIN & AUDIT) */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {/* Header Toolbar History */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#12192B] p-3 rounded-xl border border-[#1E2942]">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Cari file/folder layer, arsip ZIP, atau lahan terhapus..."
                    className="w-full bg-[#0D1322] border border-[#1E2942] rounded-lg pl-3 pr-8 py-1.5 text-xs text-white placeholder-[#566680] focus:outline-none focus:border-[#00D2FF]"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#8B9BB4] hover:text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                  <button
                    type="button"
                    onClick={() => setViewAuditLog(!viewAuditLog)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                      viewAuditLog
                        ? 'bg-[#00D2FF]/10 border-[#00D2FF] text-[#00D2FF]'
                        : 'bg-[#0D1322] border-[#1E2942] text-[#8B9BB4] hover:text-white'
                    }`}
                  >
                    <IconHistory className="w-3.5 h-3.5" />
                    <span>{viewAuditLog ? 'Lihat Tempat Sampah' : 'Lihat Log Aktivitas'}</span>
                  </button>

                  {!viewAuditLog && restorableCount > 0 && (
                    <button
                      type="button"
                      onClick={handleRestoreAll}
                      disabled={loading}
                      className="px-3 py-1.5 rounded-lg bg-[#10B981]/20 hover:bg-[#10B981]/30 border border-[#10B981]/50 text-[#10B981] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Pulihkan seluruh layer dan poligon terhapus kembali ke peta"
                    >
                      <IconRotateCcw className="w-3.5 h-3.5" />
                      <span>Pulihkan Semua</span>
                    </button>
                  )}

                  {!viewAuditLog && hasTrashOrCache && (
                    <button
                      type="button"
                      onClick={() => setShowConfirmPermanent({ kind: 'all' })}
                      disabled={loading}
                      className="px-3 py-1.5 rounded-lg bg-[#EF4444]/20 hover:bg-[#EF4444]/30 border border-[#EF4444]/50 text-[#EF4444] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Hapus permanen semua item dari database dan bersihkan file arsip/cache"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                      <span>Kosongkan Sampah &amp; Cache ({formatBytes(cacheBytes)})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* View 1: DAFTAR TEMPAT SAMPAH (LAYER/FILE + POLIGON LAHAN) */}
              {!viewAuditLog && (
                <div className="space-y-4">
                  {filteredDeletedLayers.length === 0 && filteredDeletedFeatures.length === 0 ? (
                    <div className="py-12 px-4 text-center bg-[#12192B]/50 border border-dashed border-[#1E2942] rounded-xl">
                      <div className="w-12 h-12 mx-auto rounded-full bg-[#10B981]/10 text-[#10B981] flex items-center justify-center mb-3">
                        <IconCheck className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">Tempat Sampah &amp; Cache Spasial Bersih</h4>
                      <p className="text-xs text-[#8B9BB4] mt-1 max-w-sm mx-auto">
                        {searchTerm
                          ? 'Tidak ada data terhapus yang cocok dengan kata kunci pencarian Anda.'
                          : 'Tidak ada file/folder layer, arsip sisa, maupun poligon yang berada di tempat sampah.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* SEKSI A: FILE / LAYER & FOLDER ATAU ARSIP SISA TERHAPUS */}
                      {filteredDeletedLayers.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-[#F0F6FC] px-1">
                            <div className="flex items-center gap-2">
                              <IconLayers className="w-4 h-4 text-[#00D2FF]" />
                              <span>File / Folder Layer &amp; Arsip Terhapus ({filteredDeletedLayers.length})</span>
                            </div>
                            <span className="text-[11px] font-mono text-[#8B9BB4]">
                              Total Ukuran File: {formatBytes(cacheBytes)}
                            </span>
                          </div>

                          <div className="overflow-x-auto border border-[#1E2942] rounded-xl bg-[#090D18]">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-[#12192B] text-[#8B9BB4] border-b border-[#1E2942]">
                                  <th className="py-2.5 px-3 font-semibold">Nama File / Layer</th>
                                  <th className="py-2.5 px-3 font-semibold">Kebun &amp; Wilayah</th>
                                  <th className="py-2.5 px-3 font-semibold">Poligon / File</th>
                                  <th className="py-2.5 px-3 font-semibold">Waktu</th>
                                  <th className="py-2.5 px-3 font-semibold text-right">Tindakan</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#1E2942]">
                                {filteredDeletedLayers.map((item) => {
                                  const itemKey = `${item.item_type}-${item.id}`;
                                  const isProcessing = processingKey === itemKey;
                                  const deleteDate = item.dihapus_pada
                                    ? new Date(item.dihapus_pada).toLocaleString('id-ID', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : '-';

                                  return (
                                    <tr key={itemKey} className="hover:bg-[#12192B]/60 transition-colors">
                                      <td className="py-2.5 px-3 font-medium text-white">
                                        <div className="flex items-center gap-2">
                                          <span
                                            className={`w-2 h-2 rounded-full shrink-0 ${
                                              item.item_type === 'layer' ? 'bg-[#F59E0B]' : 'bg-[#EF4444]'
                                            }`}
                                          />
                                          <div>
                                            <div className="font-semibold text-white">{item.nama_layer}</div>
                                            {item.nama_file && (
                                              <div className="text-[10px] text-[#8B9BB4] font-mono">
                                                {item.nama_file}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-2.5 px-3 text-[#8B9BB4]">
                                        <div className="text-white text-[11px]">{item.nama_kebun}</div>
                                        <div className="text-[10px] text-[#566680]">{item.wilayah}</div>
                                      </td>
                                      <td className="py-2.5 px-3 font-mono">
                                        {item.item_type === 'layer' ? (
                                          <div>
                                            <span className="text-[#00D2FF]">{item.jumlah_fitur} Poligon</span>
                                            {item.luas_ha ? (
                                              <span className="text-[#8B9BB4] text-[10px] block">
                                                {item.luas_ha.toFixed(2)} Ha • {formatBytes(item.ukuran_bytes)}
                                              </span>
                                            ) : (
                                              <span className="text-[#8B9BB4] text-[10px] block">
                                                {formatBytes(item.ukuran_bytes)}
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <div>
                                            <span className="text-amber-400">File Sisa / Cache</span>
                                            <span className="text-[#8B9BB4] text-[10px] block">
                                              {formatBytes(item.ukuran_bytes)}
                                            </span>
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-2.5 px-3 text-[#8B9BB4] text-[11px] font-mono">
                                        {deleteDate}
                                      </td>
                                      <td className="py-2.5 px-3 text-right">
                                        <div className="flex items-center justify-end gap-1.5">
                                          {item.item_type === 'layer' && (
                                            <button
                                              type="button"
                                              onClick={() => handleRestoreLayer(item.id)}
                                              disabled={isProcessing}
                                              className="px-2.5 py-1 rounded bg-[#10B981]/15 hover:bg-[#10B981]/25 border border-[#10B981]/40 text-[#10B981] hover:text-[#34D399] transition-all cursor-pointer font-medium flex items-center gap-1"
                                              title="Pulihkan file/layer beserta seluruh poligonnya ke peta"
                                            >
                                              <IconRotateCcw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                                              <span>Pulihkan</span>
                                            </button>
                                          )}

                                          <button
                                            type="button"
                                            onClick={() =>
                                              setShowConfirmPermanent({
                                                kind: item.item_type,
                                                id: item.id,
                                                name: item.nama_layer,
                                              })
                                            }
                                            disabled={isProcessing}
                                            className="px-2.5 py-1 rounded bg-[#EF4444]/15 hover:bg-[#EF4444]/25 border border-[#EF4444]/40 text-[#EF4444] hover:text-[#F87171] transition-all cursor-pointer font-medium flex items-center gap-1"
                                            title="Hapus permanen dari database dan hapus file fisik ZIP dari server"
                                          >
                                            <IconTrash className="w-3 h-3" />
                                            <span>Hapus Permanen</span>
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* SEKSI B: POLIGON LAHAN INDIVIDUAL TERHAPUS */}
                      {filteredDeletedFeatures.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-bold text-[#F0F6FC] px-1">
                            Poligon Petak Lahan Terhapus ({filteredDeletedFeatures.length})
                          </div>
                          <div className="overflow-x-auto border border-[#1E2942] rounded-xl bg-[#090D18]">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-[#12192B] text-[#8B9BB4] border-b border-[#1E2942]">
                                  <th className="py-2.5 px-3 font-semibold">Nama Lahan / Blok</th>
                                  <th className="py-2.5 px-3 font-semibold">Layer &amp; Kebun</th>
                                  <th className="py-2.5 px-3 font-semibold">Luas GIS</th>
                                  <th className="py-2.5 px-3 font-semibold">Waktu Dihapus</th>
                                  <th className="py-2.5 px-3 font-semibold text-right">Tindakan</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#1E2942]">
                                {filteredDeletedFeatures.map((item) => {
                                  const name = String(
                                    item.atribut?.Name ||
                                      item.atribut?.nama_blok ||
                                      item.atribut?.nama_unit ||
                                      item.atribut?.KODE_BLOK ||
                                      `Fitur #${item.id}`
                                  );
                                  const isProcessing = processingKey === `feat-${item.id}`;
                                  const deleteDate = item.dihapus_pada
                                    ? new Date(item.dihapus_pada).toLocaleString('id-ID', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : '-';

                                  return (
                                    <tr
                                      key={item.id}
                                      className="hover:bg-[#12192B]/60 transition-colors group"
                                    >
                                      <td className="py-2.5 px-3 font-medium text-white">
                                        <div className="flex items-center gap-2">
                                          <span className="w-2 h-2 rounded-full bg-[#EF4444]"></span>
                                          <span>{name}</span>
                                        </div>
                                      </td>
                                      <td className="py-2.5 px-3 text-[#8B9BB4]">
                                        <div className="text-white text-[11px] font-mono">{item.nama_layer}</div>
                                        <div className="text-[10px] text-[#566680]">
                                          {item.nama_kebun} • {item.nama_afdeling}
                                        </div>
                                      </td>
                                      <td className="py-2.5 px-3 font-mono text-[#00D2FF]">
                                        {item.luas_ha ? `${item.luas_ha.toFixed(2)} Ha` : '-'}
                                      </td>
                                      <td className="py-2.5 px-3 text-[#8B9BB4] text-[11px] font-mono">
                                        {deleteDate}
                                      </td>
                                      <td className="py-2.5 px-3 text-right">
                                        <div className="flex items-center justify-end gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => handleRestoreFeature(item.id)}
                                            disabled={isProcessing}
                                            className="px-2.5 py-1 rounded bg-[#10B981]/15 hover:bg-[#10B981]/25 border border-[#10B981]/40 text-[#10B981] hover:text-[#34D399] transition-all cursor-pointer font-medium flex items-center gap-1"
                                            title="Pulihkan kembali ke peta aktif"
                                          >
                                            <IconRotateCcw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                                            <span>Pulihkan</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              setShowConfirmPermanent({
                                                kind: 'feature',
                                                id: item.id,
                                                name,
                                              })
                                            }
                                            disabled={isProcessing}
                                            className="px-2.5 py-1 rounded bg-[#EF4444]/15 hover:bg-[#EF4444]/25 border border-[#EF4444]/40 text-[#EF4444] hover:text-[#F87171] transition-all cursor-pointer font-medium flex items-center gap-1"
                                            title="Hapus permanen dari basis data"
                                          >
                                            <IconTrash className="w-3 h-3" />
                                            <span>Hapus Permanen</span>
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* View 2: AUDIT LOG RIWAYAT AKTIVITAS */}
              {viewAuditLog && (
                <div className="space-y-3">
                  <div className="text-xs text-[#8B9BB4] flex items-center justify-between">
                    <span>Daftar 100 aktivitas pengguna terbaru dalam sistem:</span>
                    <span className="font-mono text-[#00D2FF]">Total: {data?.activity_logs.length || 0} Log</span>
                  </div>

                  <div className="border border-[#1E2942] rounded-xl bg-[#090D18] overflow-hidden">
                    <div className="max-h-[360px] overflow-y-auto divide-y divide-[#1E2942] custom-scrollbar">
                      {(data?.activity_logs || []).length === 0 ? (
                        <div className="p-6 text-center text-xs text-[#8B9BB4]">
                          Belum ada catatan aktivitas riwayat pengguna di sistem.
                        </div>
                      ) : (
                        (data?.activity_logs || []).map((log) => {
                          const logDate = new Date(log.dibuat_pada).toLocaleString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          });

                          return (
                            <div
                              key={log.id}
                              className="p-3 hover:bg-[#12192B]/50 transition-colors text-xs flex items-start justify-between gap-4"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#12192B] text-[#00D2FF] border border-[#1E2942]">
                                    {log.aktivitas}
                                  </span>
                                  <span className="font-medium text-white">{log.nama_pengguna}</span>
                                  <span className="text-[10px] text-[#566680]">({log.role})</span>
                                </div>
                                <p className="text-[#8B9BB4] text-[11px] leading-relaxed">
                                  {log.keterangan || '-'}
                                </p>
                              </div>
                              <span className="text-[10px] text-[#566680] font-mono whitespace-nowrap">
                                {logDate}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Confirmation Modal for Permanent Delete */}
        {showConfirmPermanent !== null && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-fadeIn">
            <div className="w-full max-w-md bg-[#12192B] border border-[#EF4444]/50 rounded-2xl p-5 shadow-2xl text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-[#EF4444]/15 border border-[#EF4444]/40 flex items-center justify-center text-[#EF4444]">
                <IconTrash className="w-6 h-6" />
              </div>

              <div>
                <h3 className="text-base font-bold text-white">Konfirmasi Hapus Permanen</h3>
                <p className="text-xs text-[#8B9BB4] mt-1.5 leading-relaxed">
                  {showConfirmPermanent.kind === 'all'
                    ? 'Apakah Anda yakin ingin MENGOSONGKAN seluruh tempat sampah & cache? Seluruh file/layer terhapus, poligon, dan berkas arsip ZIP sisa di server akan dimusnahkan permanen dan TIDAK DAPAT DIPULIHKAN.'
                    : `Apakah Anda yakin ingin menghapus permanen "${showConfirmPermanent.name}" dari server database & menghapus file fisiknya? Tindakan ini tidak dapat dibatalkan.`}
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmPermanent(null)}
                  className="px-4 py-2 rounded-xl bg-[#0D1322] hover:bg-[#1E2942] border border-[#1E2942] text-xs font-semibold text-[#8B9BB4] hover:text-white transition-colors cursor-pointer"
                >
                  Batal
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (showConfirmPermanent.kind === 'all') {
                      handleEmptyTrash();
                    } else {
                      handlePermanentDeleteItem(showConfirmPermanent);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-bold shadow-lg shadow-[#EF4444]/30 transition-all cursor-pointer"
                >
                  Ya, Hapus Permanen
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="p-3 bg-[#090D18] border-t border-[#1E2942] flex items-center justify-between text-[11px] text-[#8B9BB4]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10B981]"></span>
            <span>GIS Monitoring Spatial Manager</span>
          </div>
          {!embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-[#12192B] hover:bg-[#1E2942] text-xs text-white transition-colors cursor-pointer"
            >
              Tutup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
