'use client';

import React, { useState, useEffect, useRef } from 'react';
import { IconSearch, IconZoomTo } from './GisIcons';
import type { SearchResultItem } from '@/types/gis';

interface WorkspaceSearchBoxProps {
  onSelectResult: (item: SearchResultItem) => void;
}

export function WorkspaceSearchBox({ onSelectResult }: WorkspaceSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=20`);
        if (res.ok && !cancelled) {
          const json = await res.json();
          setResults(json.data || []);
          setIsOpen(true);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const badgeStyle = (type: SearchResultItem['type']) => {
    switch (type) {
      case 'kebun':
        return 'bg-emerald-950/90 text-emerald-300 border-emerald-700/60';
      case 'layer':
        return 'bg-sky-950/90 text-sky-300 border-sky-700/60';
      case 'feature':
        return 'bg-amber-950/90 text-amber-300 border-amber-700/60';
    }
  };

  const badgeLabel = (type: SearchResultItem['type']) => {
    switch (type) {
      case 'kebun':
        return 'KEBUN';
      case 'layer':
        return 'LAYER';
      case 'feature':
        return 'FITUR';
    }
  };

  return (
    <div ref={containerRef} className="relative w-72 sm:w-88 z-50">
      <div className="relative flex items-center">
        <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
        <input
          type="text"
          value={query}
          onFocus={() => {
            if (query.trim().length > 0) setIsOpen(true);
          }}
          onChange={(e) => {
            const val = e.target.value;
            setQuery(val);
            if (!val.trim()) {
              setResults([]);
              setLoading(false);
              setIsOpen(false);
            } else {
              setIsOpen(true);
            }
          }}
          placeholder="Cari kebun, layer, kode blok, afdeling..."
          className="w-full bg-slate-900/95 border border-slate-700/80 focus:border-emerald-500 rounded-md pl-8 pr-16 py-1 text-[11px] text-slate-100 placeholder-slate-400 focus:outline-none transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
            }}
            className="absolute right-2 text-[10px] text-slate-400 hover:text-slate-200 px-1"
            title="Bersihkan pencarian"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && query.trim().length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 bg-slate-950 border border-slate-700/90 rounded-lg shadow-2xl overflow-hidden max-h-96 flex flex-col">
          <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
            <span>
              Hasil Pencarian Spasial &amp; Atribut ({results.length})
            </span>
            {loading && <span className="text-emerald-400 animate-pulse">Mencari...</span>}
          </div>

          {results.length === 0 && !loading ? (
            <div className="p-4 text-center text-[11px] text-slate-400">
              Tidak ditemukan kebun, layer, atau atribut fitur untuk &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="overflow-y-auto divide-y divide-slate-800/70">
              {results.map((item) => (
                <button
                  key={`${item.type}-${item.id}-${item.layer_id || 0}`}
                  type="button"
                  onClick={() => {
                    onSelectResult(item);
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-900/90 transition-colors flex items-start justify-between gap-2 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold border shrink-0 ${badgeStyle(
                          item.type
                        )}`}
                      >
                        {badgeLabel(item.type)}
                      </span>
                      <span className="font-semibold text-[11px] text-slate-100 group-hover:text-emerald-300 truncate">
                        {item.title}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">
                      {item.subtitle}
                    </div>
                  </div>
                  {item.bbox && (
                    <span
                      className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded bg-slate-900 group-hover:bg-emerald-950 border border-slate-800 group-hover:border-emerald-700 text-[9px] text-slate-300 group-hover:text-emerald-300 flex items-center gap-1"
                      title="Klik untuk Auto-Zoom ke lokasi"
                    >
                      <IconZoomTo className="w-2.5 h-2.5" />
                      Zoom
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

