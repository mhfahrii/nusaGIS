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
}

export default function SettingsModal({
  isOpen,
  onClose,
  onDataChanged,
  initialTab = 'backup',
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#0D1322] border border-[#1E2942] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#E2E8F0]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-[#090D18] border-b border-[#1E2942] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#00D2FF]/10 border border-[#00D2FF]/30 flex items-center justify-center text-[#00D2FF] shadow-sm">
              <IconSettings className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  Settings & Pemeliharaan Data GIS
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#12192B] text-[#00D2FF] border border-[#1E2942]">
                  PostGIS Engine
                </span>
              </div>
              <p className="text-xs text-[#8B9BB4] mt-0.5">
                Pusat cadangan dataset spasial, pemulihan lahan terhapus, dan audit riwayat aktivitas.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-[#12192B] hover:bg-[#1E2942] text-[#8B9BB4] hover:text-white transition-colors cursor-pointer"
            title="Tutup dialog"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between">
          <div className="flex items-center gap-2">
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
              <span>History & Tempat Sampah</span>
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
                    <div className="text-sm font-bold text-[#10B981]">GeoJSON & DB JSON</div>
                  </div>
                </div>

                <div className="p-3.5 bg-[#12192B] border border-[#1E2942] rounded-xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] flex items-center justify-center">
                    <IconHistory className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] text-[#8B9BB4]">Data Terhapus (Trash)</div>
                    <div className="text-lg font-bold text-[#F59E0B] font-mono">{deletedCount} Poligon</div>
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
                    <span className="text-[#00D2FF]">✓</span> Kompatibel dengan ArcGIS Pro & QGIS GeoJSON
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#00D2FF]">✓</span> Mencakup seluruh histori atribut & luas legal
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
                  <span className="text-[#10B981]">●</span> Protokol Perlindungan Data Spasial:
                </div>
                <p className="leading-relaxed text-[11px]">
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
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#12192B] p-3 rounded-xl border border-[#1E2942]">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Cari lahan terhapus berdasarkan nama blok, afdeling, kebun..."
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

                <div className="flex items-center gap-2 self-end sm:self-auto">
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

                  {!viewAuditLog && deletedCount > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={handleRestoreAll}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg bg-[#10B981]/20 hover:bg-[#10B981]/30 border border-[#10B981]/50 text-[#10B981] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Pulihkan seluruh data terhapus kembali ke peta"
                      >
                        <IconRotateCcw className="w-3.5 h-3.5" />
                        <span>Pulihkan Semua</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowConfirmPermanent('all')}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-lg bg-[#EF4444]/20 hover:bg-[#EF4444]/30 border border-[#EF4444]/50 text-[#EF4444] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
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
                    <div className="py-12 px-4 text-center bg-[#12192B]/50 border border-dashed border-[#1E2942] rounded-xl">
                      <div className="w-12 h-12 mx-auto rounded-full bg-[#10B981]/10 text-[#10B981] flex items-center justify-center mb-3">
                        <IconCheck className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">Tempat Sampah Spasial Bersih</h4>
                      <p className="text-xs text-[#8B9BB4] mt-1 max-w-sm mx-auto">
                        {searchTerm
                          ? 'Tidak ada data terhapus yang cocok dengan kata kunci pencarian Anda.'
                          : 'Tidak ada lahan yang sedang terhapus. Semua data lahan aktif dan aman ditampilkan di peta.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[#1E2942] rounded-xl bg-[#090D18]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-[#12192B] text-[#8B9BB4] border-b border-[#1E2942]">
                            <th className="py-2.5 px-3 font-semibold">Nama Lahan / Blok</th>
                            <th className="py-2.5 px-3 font-semibold">Layer & Kebun</th>
                            <th className="py-2.5 px-3 font-semibold">Luas GIS</th>
                            <th className="py-2.5 px-3 font-semibold">Waktu Dihapus</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Tindakan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1E2942]">
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
                                      onClick={() => handleRestore(item.id)}
                                      disabled={isProcessing}
                                      className="px-2.5 py-1 rounded bg-[#10B981]/15 hover:bg-[#10B981]/25 border border-[#10B981]/40 text-[#10B981] hover:text-[#34D399] transition-all cursor-pointer font-medium flex items-center gap-1"
                                      title="Pulihkan kembali ke peta aktif"
                                    >
                                      <IconRotateCcw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                                      <span>Pulihkan</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => setShowConfirmPermanent(item.id)}
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
                            <div key={log.id} className="p-3 hover:bg-[#12192B]/50 transition-colors text-xs flex items-start justify-between gap-4">
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
                  {showConfirmPermanent === 'all'
                    ? 'Apakah Anda yakin ingin MENGOSONGKAN seluruh tempat sampah? Seluruh poligon terhapus akan dimusnahkan secara permanen dari server database PostGIS dan TIDAK DAPAT DIPULIHKAN KEMBALI.'
                    : 'Apakah Anda yakin ingin menghapus permanen lahan ini dari basis data? Poligon fisik spasial akan dimusnahkan selamanya dan tidak dapat dipulihkan.'}
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
                    if (showConfirmPermanent === 'all') {
                      handleEmptyTrash();
                    } else if (typeof showConfirmPermanent === 'number') {
                      handlePermanentDelete(showConfirmPermanent);
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
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#12192B] hover:bg-[#1E2942] text-xs text-white transition-colors cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

