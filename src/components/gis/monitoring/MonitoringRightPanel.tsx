'use client';

import React from 'react';
import { IconChevronRight } from '../GisIcons';
import type { MonitoringStats } from '@/types/gis';

interface MonitoringRightPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  stats: MonitoringStats | null;
  periodMonth: string;
  periodYear: string;
  activeKebunName?: string;
  activeAfdelingName?: string;
}

const fmt = (val: number | undefined, digits = 2) =>
  Number(val || 0).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export function MonitoringRightPanel({
  isOpen,
  onToggle,
  stats,
  periodMonth,
  periodYear,
  activeKebunName,
  activeAfdelingName,
}: MonitoringRightPanelProps) {
  if (!isOpen) {
    return (
      <div className="w-10 bg-[#0D1322] border-l border-[#1E2942] flex flex-col items-center py-3 select-none shrink-0 z-20">
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded-lg bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors shadow-md cursor-pointer"
          title="Buka Panel Ringkasan Spasial & Atribut Shapefile"
        >
          <span className="text-[10px] font-bold text-[#00D2FF] font-mono">GIS</span>
        </button>
      </div>
    );
  }

  const luasUkurHa = stats?.total_luas_ha ?? 0;
  const luasBakuHa = stats?.total_luas_baku_ha;
  const totalBlok = stats?.total_fitur || stats?.total_blok || 0;
  const komoditas = stats?.komoditas || 'Belum ditentukan';
  const crsAsal = stats?.crs_asal || 'GCS_WGS_1984 (EPSG:4326)';

  const ksGpaLuas = stats?.ks_gpa_luas_ha ?? 0;
  const ksGpaCount = stats?.ks_gpa_count ?? 0;
  const ktgLuas = stats?.ktg_luas_ha ?? 0;
  const ktgCount = stats?.ktg_count ?? 0;

  const ksGpaPct = luasUkurHa > 0 ? Math.round((ksGpaLuas / luasUkurHa) * 1000) / 10 : 0;
  const ktgPct = luasUkurHa > 0 ? Math.round((ktgLuas / luasUkurHa) * 1000) / 10 : 0;

  const akurasiSpasial =
    luasBakuHa && luasBakuHa > 0
      ? Math.min(100, Math.round((1 - Math.abs(luasUkurHa - luasBakuHa) / luasBakuHa) * 1000) / 10)
      : null;

  return (
    <aside className="w-64 sm:w-72 bg-[#0D1322] border-l border-[#1E2942] flex flex-col select-none shrink-0 z-20 h-full overflow-hidden text-[#F0F6FC]">
      {/* 1. Header Panel */}
      <div className="h-12 px-4 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between shrink-0">
        <div>
          <div className="text-sm font-bold text-[#F0F6FC] font-mono tracking-tight tabular-nums">
            {periodMonth} {periodYear}
          </div>
          <div className="text-[10px] text-[#00D2FF] font-medium">
            Ringkasan Atribut Shapefile (ArcGIS)
          </div>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="p-1 rounded text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
          title="Sembunyikan Panel Informasi"
        >
          <IconChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 2. Body Panel — 100% Data Riil dari Shapefile & PostGIS */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* CARD A: Unit Administrasi & Sistem Koordinat (CRS) */}
        <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between text-[11px] text-[#8B9BB4] font-medium">
            <span>Unit &amp; Proyeksi Peta</span>
            <span className="text-[10px] text-[#00D2FF] font-mono font-semibold">Metadata .PRJ</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#1E2942]/60">
            <div>
              <div className="text-[10px] text-[#8B9BB4] uppercase">Kebun</div>
              <div
                className="text-lg font-black text-[#F0F6FC] font-mono leading-none mt-1 truncate tabular-nums"
                title={activeKebunName || 'Semua Kebun'}
              >
                {activeKebunName ? (
                  <span className="text-xs font-bold text-[#00D2FF]">{activeKebunName}</span>
                ) : (
                  stats?.total_kebun ?? 0
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#8B9BB4] uppercase">Layer Aktif</div>
              <div
                className="text-lg font-black text-[#F0F6FC] font-mono leading-none mt-1 truncate tabular-nums"
                title={activeAfdelingName || 'Layer Vektor'}
              >
                {stats?.total_layer ?? 0} <span className="text-[10px] font-normal text-[#8B9BB4]">SHP</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#1E2942]/60 space-y-1 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-[#8B9BB4]">Komoditas:</span>
              <span className="font-bold text-[#00D2FF] bg-[#0E3A5D]/60 border border-[#00B4D8]/50 px-1.5 py-0.5 rounded truncate max-w-[145px]">
                {komoditas}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8B9BB4]">CRS:</span>
              <span className="font-mono text-[#F0F6FC] truncate max-w-[155px]" title={crsAsal}>
                {crsAsal}
              </span>
            </div>
          </div>
        </div>

        {/* CARD B: Rekapitulasi Luas Spasial (Signature Highlighted KPI Panel) */}
        <div className="p-3 bg-[#0E3A5D] border border-[#00B4D8] rounded-xl space-y-2 shadow-md shadow-[#00B4D8]/10">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-[#FFFFFF]">Luas Wilayah Kelola (Ha)</div>
            <span className="text-[9px] font-semibold text-[#7DD3FC] uppercase tracking-wider bg-[#0284C7]/40 px-1.5 py-0.5 rounded">
              DBF + PostGIS
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-[10px] text-[#7DD3FC] font-medium">Luas Ukur GIS</div>
              <div className="text-2xl font-extrabold text-[#FFFFFF] font-mono leading-none mt-1 tabular-nums">
                {fmt(luasUkurHa)}
              </div>
              <div className="text-[9.5px] text-[#7DD3FC]/80 mt-0.5">Kolom luas (.dbf)</div>
            </div>
            <div>
              <div className="text-[10px] text-[#7DD3FC] font-medium">
                {luasBakuHa ? 'Luas Baku' : 'Jumlah Blok'}
              </div>
              <div className="text-2xl font-extrabold text-[#00D2FF] font-mono leading-none mt-1 tabular-nums">
                {luasBakuHa ? fmt(luasBakuHa) : totalBlok}
              </div>
              <div className="text-[9.5px] text-[#7DD3FC]/80 mt-0.5">
                {luasBakuHa ? 'Catatan PopupInfo' : 'Poligon terpetakan'}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#00B4D8]/40 flex items-center justify-between text-[10px]">
            <span className="text-[#7DD3FC]">Total Poligon Blok:</span>
            <span className="font-mono font-bold text-[#10B981] tabular-nums">
              {totalBlok} Blok {akurasiSpasial ? `· ${akurasiSpasial}% Sesuai Baku` : ''}
            </span>
          </div>
        </div>

        {/* CARD C: Komposisi Status Pengelolaan Areal (KS GPA vs KTG) */}
        {(ksGpaCount > 0 || ktgCount > 0) && (
          <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
            <div className="flex items-center justify-between text-xs font-bold text-[#F0F6FC]">
              <span>Status Pengelolaan Areal</span>
              <span className="text-[9.5px] font-mono text-[#8B9BB4]">PopupInfo</span>
            </div>

            <div className="h-2 w-full bg-[#0A0E1A] rounded-full overflow-hidden flex border border-[#1E2942]">
              <div
                style={{ width: `${ksGpaPct}%` }}
                className="bg-[#00D2FF] h-full"
                title={`KS GPA 2023: ${fmt(ksGpaLuas)} Ha (${ksGpaPct}%)`}
              />
              <div
                style={{ width: `${ktgPct}%` }}
                className="bg-[#10B981] h-full"
                title={`KTG: ${fmt(ktgLuas)} Ha (${ktgPct}%)`}
              />
            </div>

            <div className="space-y-1.5 pt-0.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[#8B9BB4]">
                  <span className="w-2 h-2 rounded-xs bg-[#00D2FF]" />
                  <span>KS GPA 2023 ({ksGpaCount} blok)</span>
                </span>
                <span className="font-mono font-bold text-[#F0F6FC] tabular-nums">
                  {fmt(ksGpaLuas)} Ha <span className="text-[10px] text-[#00D2FF]">({ksGpaPct}%)</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[#8B9BB4]">
                  <span className="w-2 h-2 rounded-xs bg-[#10B981]" />
                  <span>KTG Tebu ({ktgCount} blok)</span>
                </span>
                <span className="font-mono font-bold text-[#F0F6FC] tabular-nums">
                  {fmt(ktgLuas)} Ha <span className="text-[10px] text-[#10B981]">({ktgPct}%)</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* CARD D: Statistik Dimensi Poligon Blok */}
        <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-[#F0F6FC]">
            <span>Dimensi Geometri Blok</span>
            <span className="text-[9.5px] font-mono text-[#00D2FF]">PostGIS</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#1E2942]/60 text-[11px]">
            <div>
              <div className="text-[10px] text-[#8B9BB4]">Blok Terluas</div>
              <div className="text-sm font-extrabold text-[#F0F6FC] font-mono tabular-nums">
                {stats?.max_blok_luas_ha ? `${fmt(stats.max_blok_luas_ha)} Ha` : '-'}
              </div>
              <div className="text-[9.5px] text-[#566680] truncate" title={stats?.max_blok_name}>
                {stats?.max_blok_name || '-'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#8B9BB4]">Blok Terkecil</div>
              <div className="text-sm font-extrabold text-[#00D2FF] font-mono tabular-nums">
                {stats?.min_blok_luas_ha ? `${fmt(stats.min_blok_luas_ha)} Ha` : '-'}
              </div>
              <div className="text-[9.5px] text-[#566680] truncate" title={stats?.min_blok_name}>
                {stats?.min_blok_name || '-'}
              </div>
            </div>
          </div>

          <div className="pt-1.5 border-t border-[#1E2942]/60 flex items-center justify-between text-[10px] text-[#8B9BB4]">
            <span>Rata-rata / Keliling:</span>
            <span className="font-mono text-[#F0F6FC] font-semibold tabular-nums">
              {stats?.avg_blok_luas_ha ? `${fmt(stats.avg_blok_luas_ha)} Ha` : '-'} ·{' '}
              {stats?.total_keliling_km ? `${fmt(stats.total_keliling_km)} km` : '-'}
            </span>
          </div>
        </div>

        {/* CARD E: Info Budidaya & Tanam dari PopupInfo Shapefile */}
        <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-1.5 text-center shadow-xs">
          <div className="text-xs font-bold text-[#8B9BB4] flex items-center justify-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF]" />
            <span>Atribut Budidaya &amp; Tanam</span>
          </div>
          <div className="pt-0.5">
            <div className="text-xl font-black text-[#00D2FF] font-mono tracking-tight leading-none tabular-nums">
              {stats?.varietas_dominan || 'Belum Diisi'}
            </div>
            <div className="text-[11px] text-[#F0F6FC] font-semibold mt-1">
              {stats?.masa_tanam ? `Masa Tanam (MT): ${stats.masa_tanam}` : 'MT belum diisi di DBF'}
            </div>
          </div>
          {stats?.luas_tanam_ha !== undefined && stats.luas_tanam_ha > 0 && (
            <div className="text-[10px] text-[#8B9BB4] pt-1 border-t border-[#1E2942]/60 flex items-center justify-between">
              <span>Luas Tanam Tercatat:</span>
              <span className="text-[#10B981] font-mono font-bold tabular-nums">
                {fmt(stats.luas_tanam_ha)} Ha
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="p-2.5 bg-[#0D1322] border-t border-[#1E2942] text-[10px] text-[#8B9BB4] flex items-center justify-between shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
          <span>100% Data Asli Shapefile</span>
        </span>
        <span className="text-[#566680] font-mono">PostGIS</span>
      </div>
    </aside>
  );
}
