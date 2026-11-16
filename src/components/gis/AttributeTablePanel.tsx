'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  IconChevronDown,
  IconChevronUp,
  IconTable,
  IconSearch,
  IconClearSelect,
  IconZoomTo,
} from './GisIcons';

interface AttributeRecord extends Record<string, unknown> {
  id: number;
  layer_id: number;
  _bbox?: [number, number, number, number] | null;
}

interface AttributeTablePanelProps {
  isOpen: boolean;
  onToggle: () => void;
  selectedLayerId: number | null;
  selectedLayerName: string;
  selectedFeatureId: number | null;
  onSelectFeature: (id: number | null) => void;
  onZoomToFeature?: (bbox: [number, number, number, number]) => void;
}

export function AttributeTablePanel({
  isOpen,
  onToggle,
  selectedLayerId,
  selectedLayerName,
  selectedFeatureId,
  onSelectFeature,
  onZoomToFeature,
}: AttributeTablePanelProps) {
  const [columns, setColumns] = useState<string[]>([]);
  const [records, setRecords] = useState<AttributeRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<string>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  // Reset halaman ke 1 saat layer atau pencarian berubah
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setPage(1);
  };

  const handleSortColumn = (col: string) => {
    if (sortBy === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  // Ambil atribut fitur dari PostGIS dengan pagination, pencarian, dan pengurutan kolom
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
          sortBy,
          sortDir,
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
  }, [selectedLayerId, searchQuery, sortBy, sortDir, page, pageSize]);

  // Urutkan kolom agar OBJECTID, Kode Blok, Afdeling, Luas (Ha) muncul di awal sesuai mockup
  const sortedColumns = useMemo(() => {
    const priority = ['objectid', 'kode blok', 'kode_blok', 'afdeling', 'luas (ha)', 'luas_ha'];
    return [...columns].sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aIdx = priority.findIndex((p) => aLower.includes(p));
      const bIdx = priority.findIndex((p) => bLower.includes(p));
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [columns]);

  // Export CSV
  const exportCsv = () => {
    if (records.length === 0 || columns.length === 0) return;
    const headerRow = ['id', ...sortedColumns].join(',');
    const dataRows = records.map((r) =>
      ['id', ...sortedColumns]
        .map((col) => {
          const val = r[col];
          if (val === null || val === undefined) return '';
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,' + [headerRow, ...dataRows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${selectedLayerName.replace(/\s+/g, '_')}_attributes.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const displayedRecords = showSelectedOnly
    ? records.filter((r) => r.id === selectedFeatureId)
    : records;

  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  return (
    <div className="h-full flex flex-col bg-slate-950 border-t border-slate-800 text-slate-200 select-none overflow-hidden relative">
      {/* Table Header Bar */}
      <div className="h-9 px-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-3 overflow-x-auto">
          <div className="flex items-center gap-1.5 font-bold text-slate-100 shrink-0">
            <IconTable className="w-4 h-4 text-emerald-400" />
            <span>Attribute Table</span>
          </div>

          <div className="h-3.5 w-px bg-slate-700 shrink-0" />

          {/* Selected Layer Indicator */}
          <div className="text-[11px] text-slate-400 shrink-0">
            Selected Layer:{' '}
            <span className="font-semibold text-emerald-400">
              {selectedLayerName || 'Belum ada layer'}
            </span>
          </div>

          <span className="text-[10px] text-slate-500 font-mono shrink-0">
            ({totalRecords} total · {displayedRecords.length} tampil ·{' '}
            {selectedFeatureId ? '1 dipilih' : '0 dipilih'})
          </span>
        </div>

        {/* Action Controls, Pagination & Collapse Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Quick Search */}
          <div className="relative w-40">
            <IconSearch className="w-3 h-3 text-slate-500 absolute left-2 top-1.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter atribut DBF..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded pl-6 pr-2 py-0.5 text-[10px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px]">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="bg-transparent text-slate-300 focus:outline-none cursor-pointer pr-1"
              title="Jumlah baris per halaman"
            >
              <option value={25} className="bg-slate-900">25/hal</option>
              <option value={50} className="bg-slate-900">50/hal</option>
              <option value={100} className="bg-slate-900">100/hal</option>
            </select>
            <span className="text-slate-700">|</span>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-1 text-slate-400 hover:text-emerald-400 disabled:opacity-30"
              title="Halaman Sebelumnya"
            >
              Prev
            </button>
            <span className="text-slate-400 font-mono px-1">
              {page}/{totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-1 text-slate-400 hover:text-emerald-400 disabled:opacity-30"
              title="Halaman Berikutnya"
            >
              Next
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowSelectedOnly(!showSelectedOnly)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              showSelectedOnly
                ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Show Selected
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={records.length === 0}
            className="px-2 py-0.5 rounded text-[10px] font-medium border bg-slate-950 border-slate-800 text-slate-300 hover:text-emerald-400 hover:border-emerald-700 disabled:opacity-40 transition-colors"
            title="Ekspor Atribut ke File CSV"
          >
            Export CSV
          </button>

          {selectedFeatureId && (
            <button
              type="button"
              onClick={() => onSelectFeature(null)}
              className="p-1 rounded bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
              title="Bersihkan Seleksi Baris"
            >
              <IconClearSelect className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Collapse Button (Chevron) */}
          <button
            type="button"
            onClick={onToggle}
            className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
            title={isOpen ? 'Collapse Tabel Atribut' : 'Expand Tabel Atribut'}
          >
            {isOpen ? (
              <IconChevronDown className="w-3.5 h-3.5" />
            ) : (
              <IconChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 overflow-auto text-xs">
        {loading ? (
          <div className="p-6 text-center text-slate-500">
            Memuat data atribut dari PostGIS...
          </div>
        ) : !selectedLayerId ? (
          <div className="p-6 text-center text-slate-500">
            Pilih layer pada panel Contents untuk membuka tabel atribut.
          </div>
        ) : displayedRecords.length === 0 ? (
          <div className="p-6 text-center text-slate-500">
            Tidak ada record atribut ditemukan.
          </div>
        ) : (
          <table className="w-full text-left font-mono border-collapse">
            <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold tracking-wider z-10">
              <tr>
                <th
                  onClick={() => handleSortColumn('id')}
                  className="py-2 px-2.5 w-14 text-center cursor-pointer hover:text-emerald-400 select-none"
                  title="Urutkan berdasarkan ID Fitur"
                >
                  # {sortBy === 'id' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th className="py-2 px-2 w-14 text-center">Zoom</th>
                {sortedColumns.map((col) => (
                  <th
                    key={col}
                    onClick={() => handleSortColumn(col)}
                    className="py-2 px-3 cursor-pointer hover:text-emerald-400 select-none whitespace-nowrap"
                    title={`Klik untuk mengurutkan kolom ${col}`}
                  >
                    <span>{col}</span>
                    {sortBy === col && (
                      <span className="ml-1 text-emerald-400">
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-[11px] text-slate-300">
              {displayedRecords.map((rec, idx) => {
                const isSelected = selectedFeatureId === rec.id;
                const rowNumber = (page - 1) * pageSize + idx + 1;
                return (
                  <tr
                    key={rec.id}
                    onClick={() => {
                      const nextSelected = isSelected ? null : rec.id;
                      onSelectFeature(nextSelected);
                      if (nextSelected && rec._bbox && onZoomToFeature) {
                        onZoomToFeature(rec._bbox);
                      }
                    }}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-emerald-950/70 text-emerald-200 border-l-2 border-emerald-400 font-semibold'
                        : 'hover:bg-slate-900/80'
                    }`}
                  >
                    <td className="py-1.5 px-2.5 text-center text-slate-500 font-sans text-[10px]">
                      {rowNumber}
                    </td>
                    <td className="py-1 px-2 text-center">
                      {rec._bbox && onZoomToFeature ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFeature(rec.id);
                            if (rec._bbox) onZoomToFeature(rec._bbox);
                          }}
                          className="p-1 rounded bg-slate-900 hover:bg-emerald-900/80 border border-slate-700 hover:border-emerald-500 text-slate-300 hover:text-emerald-300 transition-colors inline-flex items-center justify-center"
                          title="Zoom ke Fitur Ini di Peta"
                        >
                          <IconZoomTo className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    {sortedColumns.map((col) => {
                      const val = rec[col];
                      return (
                        <td key={col} className="py-1.5 px-3 whitespace-nowrap">
                          {val !== null && val !== undefined ? String(val) : '-'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Center Collapse Button Matching the Mockup (Circle Down Arrow) */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 pointer-events-auto">
        <button
          type="button"
          onClick={onToggle}
          className="w-6 h-6 rounded-full bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-400 hover:text-emerald-400 flex items-center justify-center shadow-md transition-all hover:scale-110"
          title="Collapse Tabel Atribut"
        >
          <IconChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
