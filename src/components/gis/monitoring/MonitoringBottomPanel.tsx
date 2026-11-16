'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  IconChevronDown,
  IconChevronUp,
  IconTable,
  IconSearch,
  IconZoomTo,
  IconDownload,
} from '../GisIcons';
import type { LayerPeta, MonitoringStats } from '@/types/gis';
import { ShapefileInsightPanel } from './ShapefileInsightPanel';

interface AttributeRecord extends Record<string, unknown> {
  id: number;
  layer_id: number;
  _bbox?: [number, number, number, number] | null;
  _luas_geodesik_ha?: number;
}

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

interface MonitoringBottomPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  layers: LayerPeta[];
  selectedLayerId: number | null;
  onSelectLayer: (id: number) => void;
  selectedFeatureId: number | null;
  onSelectFeature: (id: number | null) => void;
  onZoomToFeature?: (bbox: [number, number, number, number]) => void;
  selectedKebunId?: number | null;
  selectedAfdelingId?: number | null;
  selectedBlokId?: number | null;
  kebunList?: KebunItem[];
  afdelingList?: AfdelingItem[];
  blokList?: BlokItem[];
  stats?: MonitoringStats | null;
  periodYear?: string;
  periodMonth?: string;
  onFeatureDeleted?: (featureId: number, layerId: number) => void;
  dataRevision?: number;
}

type MetricCategory =
  | 'produksi'
  | 'produktivitas'
  | 'tandan'
  | 'pemupukan'
  | 'pemeliharaan'
  | 'hama';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/**
 * Menghitung angka skala (ticks) sumbu Y yang rapi dan teratur (0, 25%, 50%, 75%, 100%)
 */
function getNiceTicks(maxVal: number, count = 4): { max: number; ticks: number[] } {
  if (maxVal <= 0) return { max: 10, ticks: [0, 2.5, 5, 7.5, 10] };
  const rawStep = maxVal / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 0.0001))));
  const residual = rawStep / magnitude;
  let niceStep = magnitude;
  if (residual > 5) niceStep = 10 * magnitude;
  else if (residual > 2) niceStep = 5 * magnitude;
  else if (residual > 1) niceStep = 2 * magnitude;

  const niceMax = Math.max(niceStep * count, maxVal);
  const actualStep = niceMax / count;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) {
    ticks.push(Number((actualStep * i).toFixed(actualStep < 1 ? 2 : 1)));
  }
  return { max: niceMax, ticks };
}

/**
 * Format angka pada label sumbu agar ringkas dan elegan (misal: 1k, 1.5k, 500, dsb)
 */
function formatAxisLabel(val: number): string {
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`.replace('.0M', 'M');
  if (val >= 10000) return `${Math.round(val / 1000)}k`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`.replace('.0k', 'k');
  if (Number.isInteger(val)) return String(val);
  return val.toFixed(1);
}

export function MonitoringBottomPanel({
  isOpen,
  onToggle,
  layers,
  selectedLayerId,
  selectedFeatureId,
  onSelectFeature,
  onZoomToFeature,
  selectedKebunId = null,
  selectedAfdelingId = null,
  selectedBlokId = null,
  kebunList = [],
  afdelingList = [],
  stats = null,
  periodYear = '2026',
  onFeatureDeleted,
  dataRevision,
}: MonitoringBottomPanelProps) {
  // Mode tampilan: 'chart' (Visualisasi Grafik Utama RPN) atau 'table' (Tabel Atribut)
  const [panelView, setPanelView] = useState<'chart' | 'table'>('chart');

  // Attribute Table state
  const [columns, setColumns] = useState<string[]>([]);
  const [records, setRecords] = useState<AttributeRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);

  // Ambil record fitur yang sedang dipilih
  const selectedRecord = records.find((r) => r.id === selectedFeatureId);

  // Fetch atribut saat layer dipilih
  useEffect(() => {
    let ignore = false;
    async function loadAttributes() {
      if (!selectedLayerId) {
        if (!ignore) {
          setRecords([]);
          setColumns([]);
          setTotalRecords(0);
        }
        return;
      }

      setLoading(true);
      try {
        const offset = (page - 1) * pageSize;
        const params = new URLSearchParams({
          layer_id: String(selectedLayerId),
          limit: String(pageSize),
          offset: String(offset),
        });
        if (searchQuery.trim()) {
          params.set('search', searchQuery.trim());
        }

        const res = await fetch(`/api/gis/features?${params.toString()}`);
        if (res.ok && !ignore) {
          const json = await res.json();
          setColumns(json.columns || []);
          setRecords(json.data || []);
          setTotalRecords(Number(json.total || 0));
        }
      } catch (err) {
        console.error('Fetch attributes error:', err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadAttributes();
    return () => {
      ignore = true;
    };
  }, [selectedLayerId, page, pageSize, searchQuery, dataRevision]);

  // 1. Identifikasi Entitas / Wilayah yang Aktif (1 Blok vs 1 Afdeling vs Semua Wilayah)
  const activeScope = useMemo(() => {
    // A. Jika ada 1 fitur / poligon blok lahan yang diklik di peta
    if (selectedFeatureId && selectedRecord) {
      const nameVal =
        selectedRecord.Name ||
        selectedRecord.nama_blok ||
        selectedRecord.KODE_BLOK ||
        selectedRecord.kode_blok ||
        `Blok #${selectedFeatureId}`;

      const luasRaw =
        selectedRecord._luas_geodesik_ha ||
        selectedRecord.luas ||
        selectedRecord['Luas (Ha)'] ||
        1.5;
      const luasHa = Number(Number(luasRaw).toFixed(2));

      return {
        type: 'blok' as const,
        title: `Blok: ${String(nameVal)}`,
        subtitle: `1 Blok Spesifik (${luasHa} Ha)`,
        luasHa,
        label: String(nameVal),
      };
    }

    // B. Jika ada 1 Afdeling yang dipilih di filter
    if (selectedAfdelingId) {
      const afd = afdelingList.find((a) => a.id === selectedAfdelingId);
      const afdName = afd ? afd.nama_afdeling : `Afdeling #${selectedAfdelingId}`;
      const luasHa = stats?.total_luas_ha ? Math.round((stats.total_luas_ha / 2) * 10) / 10 : 8.0;

      return {
        type: 'afdeling' as const,
        title: `Afdeling: ${afdName}`,
        subtitle: `Wilayah 1 Afdeling (${luasHa} Ha)`,
        luasHa,
        label: afdName,
      };
    }

    // C. Jika ada 1 Kebun yang dipilih
    if (selectedKebunId) {
      const kbn = kebunList.find((k) => k.id === selectedKebunId);
      const kbnName = kbn ? kbn.nama_kebun : `Kebun #${selectedKebunId}`;
      const luasHa = stats?.total_luas_ha || 14.14;

      return {
        type: 'kebun' as const,
        title: `Kebun: ${kbnName}`,
        subtitle: `Total Akumulasi Seluruh Afdeling Kebun (${luasHa} Ha)`,
        luasHa,
        label: kbnName,
      };
    }

    // D. Default: Total Akumulasi Seluruh Wilayah & Afdeling
    const totalLuas = stats?.total_luas_ha || 4352.7;
    return {
      type: 'all' as const,
      title: 'Semua Afdeling & Wilayah',
      subtitle: `Total Akumulasi Seluruh Wilayah Perkebunan (${totalLuas} Ha)`,
      luasHa: totalLuas,
      label: 'Total Wilayah',
    };
  }, [selectedFeatureId, selectedRecord, selectedAfdelingId, selectedKebunId, afdelingList, kebunList, stats]);

  // Ekspor CSV Atribut
  const exportCsv = () => {
    if (records.length === 0) return;
    const cleanCols = columns.filter((c) => !c.startsWith('_'));
    const headerRow = cleanCols.join(',');
    const rows = records.map((r) =>
      cleanCols
        .map((c) => {
          const val = r[c] ?? '';
          const str = String(val).replace(/"/g, '""');
          return `"${str}"`;
        })
        .join(',')
    );
    const csvContent = [headerRow, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atribut_layer_${selectedLayerId || 'data'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // State tertutup (Collapsible Bar di bawah layar)
  if (!isOpen) {
    return (
      <div className="h-9 bg-[#0D1322] border-t border-[#1E2942] flex items-center justify-between px-4 select-none shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1.5 text-xs font-bold text-[#F0F6FC] hover:text-[#00D2FF] transition-colors cursor-pointer"
          >
            <IconChevronUp className="w-4 h-4 text-[#00D2FF]" />
            <span>Analisis Atribut Shapefile ({activeScope.label})</span>
          </button>
          <span className="text-[10px] text-[#8B9BB4] font-mono hidden sm:inline tabular-nums">
            Luas Ukur GIS: <strong className="text-[#00D2FF]">{activeScope.luasHa} Ha</strong>
          </span>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="p-1 rounded text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
          title="Buka Panel Visualisasi"
        >
          <IconChevronUp className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="h-64 sm:h-72 bg-[#0D1322] border-t border-[#1E2942] flex flex-col select-none shrink-0 z-20 shadow-2xl overflow-hidden text-[#F0F6FC]">
      {/* 1. TOP HEADER PANEL BAWAH: Judul Analitik & Scope Wilayah */}
      <div className="h-9 px-4 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00D2FF] animate-pulse" />
            <h4 className="text-xs font-bold text-[#F0F6FC] tracking-tight">
              Analisis Atribut Shapefile: {layers.find((l) => l.id === selectedLayerId)?.nama_layer || 'Semua Layer Aktif'}
            </h4>
          </div>

          {/* Badge Indikator Wilayah Aktif */}
          <div className="flex items-center gap-1.5 bg-[#0A0E1A] border border-[#1E2942] px-2.5 py-0.5 rounded-full text-[10px]">
            <span className="text-[#00D2FF] font-bold">
              {activeScope.type === 'blok' ? '📍' : activeScope.type === 'afdeling' ? '🏢' : '🌐'}
            </span>
            <span className="font-semibold text-[#F0F6FC] truncate max-w-[200px]">
              {activeScope.title}
            </span>
            {selectedFeatureId && (
              <button
                type="button"
                onClick={() => onSelectFeature(null)}
                className="ml-1 text-[10px] text-[#00D2FF] hover:underline cursor-pointer"
                title="Batalkan pilihan blok & tampilkan semua afdeling"
              >
                (Reset ke Semua)
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher: Grafik vs Tabel Atribut & Tombol Tutup */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md bg-[#0A0E1A] border border-[#1E2942] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setPanelView('chart')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                panelView === 'chart'
                  ? 'bg-[#00D2FF] text-[#0A0E1A] shadow-xs'
                  : 'text-[#8B9BB4] hover:text-[#F0F6FC]'
              }`}
            >
              Visualisasi Grafik
            </button>
            <button
              type="button"
              onClick={() => setPanelView('table')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                panelView === 'table'
                  ? 'bg-[#00D2FF] text-[#0A0E1A] shadow-xs'
                  : 'text-[#8B9BB4] hover:text-[#F0F6FC]'
              }`}
            >
              <IconTable className="w-3 h-3" />
              <span>Tabel Atribut</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
            title="Kecilkan Panel Bawah"
          >
            <IconChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. BODY CONTENT: ANALISIS ATRIBUT SHAPEFILE (Luas, Status Lahan, Varietas & MT) */}
      {panelView === 'chart' ? (
        <ShapefileInsightPanel
          layers={layers}
          selectedLayerId={selectedLayerId}
          selectedFeatureId={selectedFeatureId}
          onSelectFeature={onSelectFeature}
          onZoomToFeature={onZoomToFeature}
          selectedAfdelingId={selectedAfdelingId}
          afdelingList={afdelingList}
          dataRevision={dataRevision}
        />
      ) : (
        /* 4. TAMPILAN TABEL ATRIBUT (Bila Pengguna Memilih Tab Tabel) */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="h-9 px-4 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#F0F6FC]">
                Layer: {layers.find((l) => l.id === selectedLayerId)?.nama_layer || 'Pilih Layer'}
              </span>
              <span className="text-[10px] text-[#8B9BB4] font-mono tabular-nums">
                ({totalRecords} baris fitur)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-36">
                <IconSearch className="w-3 h-3 text-[#566680] absolute left-2 top-1.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Cari atribut..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#0A0E1A] border border-[#1E2942] rounded pl-6 pr-2 py-0.5 text-[10px] text-[#F0F6FC] placeholder-[#566680] focus:outline-none focus:border-[#00D2FF]"
                />
              </div>

              <button
                type="button"
                onClick={exportCsv}
                disabled={records.length === 0}
                className="px-2.5 py-0.5 rounded text-[10px] font-bold border bg-[#12192B] border-[#1E2942] text-[#00D2FF] hover:bg-[#19233A] transition-colors flex items-center gap-1 cursor-pointer"
              >
                <IconDownload className="w-3 h-3" />
                <span>Export CSV</span>
              </button>

              {selectedFeatureId && (
                <button
                  type="button"
                  onClick={async () => {
                    const name =
                      selectedRecord?.Name ||
                      selectedRecord?.nama_blok ||
                      `Fitur #${selectedFeatureId}`;
                    if (
                      !window.confirm(
                        `Yakin ingin menghapus lahan "${name}" ini dari database?`
                      )
                    )
                      return;
                    try {
                      const res = await fetch(`/api/gis/features?id=${selectedFeatureId}`, {
                        method: 'DELETE',
                      });
                      if (res.ok) {
                        setRecords((prev) => prev.filter((r) => r.id !== selectedFeatureId));
                        setTotalRecords((prev) => Math.max(0, prev - 1));
                        onSelectFeature(null);
                        if (selectedLayerId && onFeatureDeleted) {
                          onFeatureDeleted(selectedFeatureId, selectedLayerId);
                        }
                      } else {
                        const err = await res.json();
                        alert(err.message || 'Gagal menghapus lahan.');
                      }
                    } catch (err) {
                      console.error('Delete error:', err);
                      alert('Gagal menghubungi server.');
                    }
                  }}
                  className="px-2.5 py-0.5 rounded text-[10px] font-bold border border-rose-800 bg-rose-950/70 text-rose-300 hover:bg-rose-900 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Hapus baris lahan terpilih dari database"
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                    />
                  </svg>
                  <span>Hapus Lahan</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-[#0A0E1A]">
            {records.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#566680] italic">
                {loading ? 'Memuat data atribut...' : 'Tidak ada data atribut pada layer ini.'}
              </div>
            ) : (
              <table className="w-full text-left text-[11px] border-collapse font-sans">
                <thead className="bg-[#0D1322] sticky top-0 z-10 text-[#8B9BB4] font-semibold border-b border-[#1E2942] text-[10px] uppercase">
                  <tr>
                    <th className="py-1.5 px-3 w-8">#</th>
                    {columns
                      .filter((c) => !c.startsWith('_'))
                      .map((col) => (
                        <th key={col} className="py-1.5 px-3 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2942]/60 font-mono text-[10px] tabular-nums">
                  {records.map((r, idx) => {
                    const isSelected = r.id === selectedFeatureId;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => {
                          onSelectFeature(r.id);
                          if (r._bbox && onZoomToFeature) {
                            onZoomToFeature(r._bbox);
                          }
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#132238] text-[#00D2FF] font-bold'
                            : idx % 2 === 0
                            ? 'bg-[#0A0E1A] hover:bg-[#19233A]'
                            : 'bg-[#12192B]/50 hover:bg-[#19233A]'
                        }`}
                      >
                        <td className="py-1.5 px-3 text-[#566680] font-sans">{idx + 1}</td>
                        {columns
                          .filter((c) => !c.startsWith('_'))
                          .map((col) => (
                            <td key={col} className="py-1.5 px-3 whitespace-nowrap text-[#F0F6FC]">
                              {String(r[col] ?? '-')}
                            </td>
                          ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
