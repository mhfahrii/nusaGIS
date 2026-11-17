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
} from '@/components/gis/GisIcons';
import type { MonitoringUiTheme } from '@/lib/monitoring/uiTheme';

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

interface ActivityLog {
  id: number;
  aktivitas: string;
  keterangan: string | null;
  dibuat_pada: string;
  nama_pengguna: string;
  role: string;
}

interface HistoryResponse {
  deleted_features: DeletedFeature[];
  activity_logs: ActivityLog[];
  counts: {
    total_deleted: number;
    total_active: number;
    total_logs: number;
  };
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataChanged?: () => void;
  initialTab?: 'backup' | 'history';
  uiTheme?: MonitoringUiTheme;
  onUiThemeChange?: (theme: MonitoringUiTheme) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  onDataChanged,
  initialTab = 'backup',
  uiTheme = 'dark',
  onUiThemeChange,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'backup' | 'history'>(initialTab);
  const [loading, setLoading] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [showConfirmPermanent, setShowConfirmPermanent] = useState<number | 'all' | null>(null);
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
    if (isOpen) {
      setActiveTab(initialTab);
      setActionMessage(null);
      fetchHistory();
    }
  }, [isOpen, initialTab, fetchHistory]);

  // Flash message auto clear
  useEffect(() => {
    if (actionMessage) {
      const timer = setTimeout(() => setActionMessage(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [actionMessage]);

  if (!isOpen) return null;

  // Handler: Pulihkan Fitur (Restore)
  const handleRestore = async (id: number) => {
    setProcessingId(id);
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
      setProcessingId(null);
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

  // Handler: Hapus Permanen Single
  const handlePermanentDelete = async (id: number) => {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/gis/history?id=${id}`, {
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
      setProcessingId(null);
    }
  };

  // Handler: Kosongkan Tempat Sampah (Empty Trash)
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
    // Langsung trigger unduhan dari API route
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

  // Filtered deleted items
  const filteredDeleted = (data?.deleted_features || []).filter((item) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const name = String(item.atribut?.Name || item.atribut?.nama_blok || item.atribut?.KODE_BLOK || '').toLowerCase();
    const layer = (item.nama_layer || '').toLowerCase();
    const kebun = (item.nama_kebun || '').toLowerCase();
    const afd = (item.nama_afdeling || '').toLowerCase();
    return name.includes(term) || layer.includes(term) || kebun.includes(term) || afd.includes(term);
  });

  const deletedCount = data?.counts.total_deleted || 0;
  const activeCount = data?.counts.total_active || 0;

  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/75 p-4 overflow-hidden animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-modal bg-bg-nav border border-border-subtle rounded-2xl shadow-2xl flex flex-col min-h-0 overflow-hidden text-text-primary">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-bg-ground border-b border-border-subtle flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-primary/10 border border-border-active/30 flex items-center justify-center text-accent-primary shadow-sm">
              <IconSettings className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  Pengaturan & pemeliharaan data GIS
                </h2>
              </div>
              <p className="text-xs text-text-secondary mt-0.5">
                Pusat cadangan dataset spasial, pemulihan lahan terhapus, dan audit riwayat aktivitas.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-bg-surface hover:bg-bg-surface-hover text-text-secondary hover:text-white transition-colors cursor-pointer"
            title="Tutup dialog"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {onUiThemeChange && (
          <div className="px-5 py-3 bg-bg-nav border-b border-border-subtle flex flex-wrap items-center gap-3 text-xs">
            <label className="text-text-secondary font-semibold" htmlFor="nusa-ui-theme">
              Tema panel kerja
            </label>
            <select
              id="nusa-ui-theme"
              value={uiTheme}
              onChange={(e) => onUiThemeChange(e.target.value as MonitoringUiTheme)}
              className="bg-bg-surface border border-border-subtle rounded-lg px-3 py-2 text-text-primary nusa-focus min-h-11"
            >
              <option value="dark" className="bg-bg-nav">
                Gelap (peta)
              </option>
              <option value="light" className="bg-bg-nav">
                Terang (ruang terang)
              </option>
            </select>
            <p className="text-2xs text-text-muted">
              Hanya mengubah sidebar, header, dan panel atribut. Peta tetap gelap.
            </p>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="px-5 pt-3 bg-bg-nav border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('backup')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all cursor-pointer border-b-2 ${
                activeTab === 'backup'
                  ? 'border-border-active text-accent-primary bg-bg-surface'
                  : 'border-transparent text-text-secondary hover:text-white hover:bg-bg-surface/50'
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
                  ? 'border-border-active text-accent-primary bg-bg-surface'
                  : 'border-transparent text-text-secondary hover:text-white hover:bg-bg-surface/50'
              }`}
            >
              <IconHistory className="w-4 h-4" />
              <span>History & Tempat Sampah</span>
              {deletedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-2xs font-bold bg-status-danger text-white">
                  {deletedCount}
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={fetchHistory}
            disabled={loading}
            className="text-xs text-text-secondary hover:text-accent-primary flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-bg-surface border border-border-subtle transition-colors cursor-pointer"
            title="Segarkan data"
          >
            <IconRefresh className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-accent-primary' : ''}`} />
            <span className="hidden sm:inline">Segarkan</span>
          </button>
        </div>

        {/* Action Message Banner */}
        {actionMessage && (
          <div
            className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all ${
              actionMessage.type === 'success'
                ? 'bg-status-success/15 border border-status-success/40 text-status-success'
                : 'bg-status-danger/15 border border-status-danger/40 text-status-danger'
            }`}
          >
            <div className="flex items-center gap-2">
              {actionMessage.type === 'success' ? (
                <IconCheck className="w-4 h-4 flex-shrink-0" />
              ) : (
                <IconTrash className="w-4 h-4 flex-shrink-0" />
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
        <div className="flex-1 min-h-0 overflow-y-auto p-5 nusa-scroll">
          {/* TAB 1: BACK UP DATA */}
          {activeTab === 'backup' && (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 bg-bg-surface border border-border-subtle rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent-primary/10 text-accent-primary flex items-center justify-center">
                    <IconDatabase className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-caption text-text-secondary">Total Fitur Aktif</div>
                    <div className="text-lg font-bold text-white font-mono">{activeCount} Poligon</div>
                  </div>
                </div>

                <div className="p-3.5 bg-bg-surface border border-border-subtle rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-status-success/10 text-status-success flex items-center justify-center">
                    <IconDownload className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-caption text-text-secondary">Format Cadangan</div>
                    <div className="text-sm font-bold text-status-success">GeoJSON & DB JSON</div>
                  </div>
                </div>

                <div className="p-3.5 bg-bg-surface border border-border-subtle rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-status-warning/10 text-status-warning flex items-center justify-center">
                    <IconHistory className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-caption text-text-secondary">Data Terhapus (Trash)</div>
                    <div className="text-lg font-bold text-status-warning font-mono">{deletedCount} Poligon</div>
                  </div>
                </div>
              </div>

              {/* Download Card */}
              <div className="p-5 bg-bg-surface border border-border-subtle rounded-xl space-y-4">
                <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-accent-primary"></span>
                      Cadangan Basis Data Spasial Penuh (Full Snapshot)
                    </h3>
                    <p className="text-xs text-text-secondary mt-1 max-w-xl leading-relaxed">
                      Mengunduh seluruh konfigurasi layer aktif, batas koordinat polygon asli (PostGIS WGS84
                      EPSG:4326), perhitungan luas geodesik Hektar, dan atribut lengkap DBF ke dalam berkas standar
                      GeoJSON / JSON yang dapat diimpor kembali atau dibuka di QGIS/ArcGIS Pro.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    disabled={isExporting}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-accent-primary to-accent-secondary hover:brightness-110 text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-accent-primary/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <IconDownload className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
                    <span>{isExporting ? 'Mengemas Cadangan...' : 'Unduh Cadangan (.json)'}</span>
                  </button>
                </div>

                <div className="pt-3 border-t border-border-subtle grid grid-cols-1 sm:grid-cols-2 gap-2 text-caption text-text-secondary">
                  <div className="flex items-center gap-2">
                    <span className="text-accent-primary">✓</span> Kompatibel dengan ArcGIS Pro & QGIS GeoJSON
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-accent-primary">✓</span> Mencakup seluruh histori atribut & luas legal
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-accent-primary">✓</span> Dilengkapi stempel waktu ekspor ISO 8601
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-accent-primary">✓</span> Tidak memotong poligon yang sedang aktif
                  </div>
                </div>
              </div>

              {/* Info Panduan Keamanan Data */}
              <div className="p-4 bg-bg-ground border border-border-subtle rounded-xl text-xs text-text-secondary space-y-2">
                <div className="font-semibold text-white flex items-center gap-2">
                  <span className="text-status-success">●</span> Protokol Perlindungan Data Spasial:
                </div>
                <p className="leading-relaxed text-caption">
                  Setiap penghapusan lahan dari peta menggunakan mekanisme <strong>Soft Delete</strong> (penghapusan
                  logis). Data geometri fisik di server PostgreSQL tetap tersimpan aman di tempat sampah dan dapat
                  dipulihkan sewaktu-waktu melalui tab <strong>History & Tempat Sampah</strong>.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: HISTORY & TEMPAT SAMPAH (RECYCLE BIN & AUDIT) */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {/* Header Toolbar History */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-bg-surface p-3 rounded-xl border border-border-subtle">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Cari lahan terhapus berdasarkan nama blok, afdeling, kebun..."
                    className="w-full bg-bg-nav border border-border-subtle rounded-lg pl-3 pr-8 py-1.5 text-xs text-white placeholder:text-text-muted nusa-focus focus:border-border-active"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-secondary hover:text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setViewAuditLog(!viewAuditLog)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                      viewAuditLog
                        ? 'bg-accent-primary/10 border-border-active text-accent-primary'
                        : 'bg-bg-nav border-border-subtle text-text-secondary hover:text-white'
                    }`}
                  >
                    <IconHistory className="w-3.5 h-3.5" />
                    <span>{viewAuditLog ? 'Lihat Tempat Sampah' : 'Lihat Log Aktivitas'}</span>
                  </button>

                  {!viewAuditLog && deletedCount > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={handleRestoreAll}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg bg-status-success/20 hover:bg-status-success/30 border border-status-success/50 text-status-success text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Pulihkan seluruh data terhapus kembali ke peta"
                      >
                        <IconRotateCcw className="w-3.5 h-3.5" />
                        <span>Pulihkan Semua</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowConfirmPermanent('all')}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg bg-status-danger/20 hover:bg-status-danger/30 border border-status-danger/50 text-status-danger text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Hapus permanen semua item dari database"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                        <span>Kosongkan Sampah</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* View 1: DAFTAR TEMPAT SAMPAH (RECYCLE BIN) */}
              {!viewAuditLog && (
                <div className="space-y-3">
                  {filteredDeleted.length === 0 ? (
                    <div className="py-12 px-4 text-center bg-bg-surface/50 border border-dashed border-border-subtle rounded-xl">
                      <div className="w-12 h-12 mx-auto rounded-full bg-status-success/10 text-status-success flex items-center justify-center mb-3">
                        <IconCheck className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">Tempat Sampah Spasial Bersih</h4>
                      <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto">
                        {searchTerm
                          ? 'Tidak ada data terhapus yang cocok dengan kata kunci pencarian Anda.'
                          : 'Tidak ada lahan yang sedang terhapus. Semua data lahan aktif dan aman ditampilkan di peta.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-border-subtle rounded-xl bg-bg-ground">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-bg-surface text-text-secondary border-b border-border-subtle">
                            <th className="py-2.5 px-3 font-semibold">Nama Lahan / Blok</th>
                            <th className="py-2.5 px-3 font-semibold">Layer & Kebun</th>
                            <th className="py-2.5 px-3 font-semibold">Luas GIS</th>
                            <th className="py-2.5 px-3 font-semibold">Waktu Dihapus</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Tindakan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                          {filteredDeleted.map((item) => {
                            const name = String(
                              item.atribut?.Name ||
                              item.atribut?.nama_blok ||
                              item.atribut?.KODE_BLOK ||
                              `Fitur #${item.id}`
                            );
                            const isProcessing = processingId === item.id;
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
                                className="hover:bg-bg-surface/60 transition-colors group"
                              >
                                <td className="py-2.5 px-3 font-medium text-white">
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-status-danger"></span>
                                    <span>{name}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-text-secondary">
                                  <div className="text-white text-caption font-mono">{item.nama_layer}</div>
                                  <div className="text-2xs text-text-muted">
                                    {item.nama_kebun} • {item.nama_afdeling}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-accent-primary">
                                  {item.luas_ha ? `${item.luas_ha.toFixed(2)} Ha` : '-'}
                                </td>
                                <td className="py-2.5 px-3 text-text-secondary text-caption font-mono">
                                  {deleteDate}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleRestore(item.id)}
                                      disabled={isProcessing}
                                      className="px-2.5 py-1 rounded bg-status-success/15 hover:bg-status-success/25 border border-status-success/40 text-status-success hover:text-emerald-400 transition-all cursor-pointer font-medium flex items-center gap-1"
                                      title="Pulihkan kembali ke peta aktif"
                                    >
                                      <IconRotateCcw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                                      <span>Pulihkan</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => setShowConfirmPermanent(item.id)}
                                      disabled={isProcessing}
                                      className="px-2.5 py-1 rounded bg-status-danger/15 hover:bg-status-danger/25 border border-status-danger/40 text-status-danger hover:text-red-400 transition-all cursor-pointer font-medium flex items-center gap-1"
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
                  )}
                </div>
              )}

              {/* View 2: AUDIT LOG RIWAYAT AKTIVITAS */}
              {viewAuditLog && (
                <div className="space-y-3">
                  <div className="text-xs text-text-secondary flex items-center justify-between">
                    <span>Daftar 100 aktivitas pengguna terbaru dalam sistem:</span>
                    <span className="font-mono text-accent-primary">Total: {data?.activity_logs.length || 0} Log</span>
                  </div>

                  <div className="border border-border-subtle rounded-xl bg-bg-ground overflow-hidden">
                    <div className="divide-y divide-border-subtle">
                      {(data?.activity_logs || []).length === 0 ? (
                        <div className="p-6 text-center text-xs text-text-secondary">
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
                            <div key={log.id} className="p-3 hover:bg-bg-surface/50 transition-colors text-xs flex items-start justify-between gap-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="px-1.5 py-0.5 rounded text-2xs font-mono font-semibold bg-bg-surface text-accent-primary border border-border-subtle">
                                    {log.aktivitas}
                                  </span>
                                  <span className="font-medium text-white">{log.nama_pengguna}</span>
                                  <span className="text-2xs text-text-muted">({log.role})</span>
                                </div>
                                <p className="text-text-secondary text-caption leading-relaxed">
                                  {log.keterangan || '-'}
                                </p>
                              </div>
                              <span className="text-2xs text-text-muted font-mono whitespace-nowrap">
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
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fadeIn">
            <div className="w-full max-w-md bg-bg-surface border border-status-danger/50 rounded-2xl p-5 shadow-2xl text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-status-danger/15 border border-status-danger/40 flex items-center justify-center text-status-danger">
                <IconTrash className="w-6 h-6" />
              </div>

              <div>
                <h3 className="text-base font-bold text-white">Konfirmasi Hapus Permanen</h3>
                <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
                  {showConfirmPermanent === 'all'
                    ? 'Apakah Anda yakin ingin MENGOSONGKAN seluruh tempat sampah? Seluruh poligon terhapus akan dimusnahkan secara permanen dari server database PostGIS dan TIDAK DAPAT DIPULIHKAN KEMBALI.'
                    : 'Apakah Anda yakin ingin menghapus permanen lahan ini dari basis data? Poligon fisik spasial akan dimusnahkan selamanya dan tidak dapat dipulihkan.'}
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmPermanent(null)}
                  className="px-4 py-2 rounded-xl bg-bg-nav hover:bg-bg-surface-hover border border-border-subtle text-xs font-semibold text-text-secondary hover:text-white transition-colors cursor-pointer"
                >
                  Batal
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (showConfirmPermanent === 'all') {
                      handleEmptyTrash();
                    } else if (typeof showConfirmPermanent === 'number') {
                      handlePermanentDelete(showConfirmPermanent);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-status-danger hover:bg-red-700 text-white text-xs font-bold shadow-lg shadow-status-danger/30 transition-all cursor-pointer"
                >
                  Ya, Hapus Permanen
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="p-3 bg-bg-ground border-t border-border-subtle flex items-center justify-between text-caption text-text-secondary">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-success"></span>
            <span>NusaGIS Enterprise Spatial Manager</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-bg-surface hover:bg-bg-surface-hover text-xs text-white transition-colors cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

