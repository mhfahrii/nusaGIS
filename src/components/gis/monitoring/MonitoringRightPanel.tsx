'use client';

import React from 'react';
import { IconChevronRight, IconClose } from '../GisIcons';
import type { MonitoringStats } from '@/types/gis';

interface MonitoringRightPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  stats: MonitoringStats | null;
  periodMonth: string;
  periodYear: string;
  activeKebunName?: string;
  activeAfdelingName?: string;
}

const fmt = (val: number | undefined | null, digits = 2) =>
  Number(val || 0).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export function MonitoringRightPanel({
  isOpen,
  onToggle,
  isMobileOpen = false,
  onCloseMobile,
  stats,
  periodMonth,
  periodYear,
  activeKebunName,
  activeAfdelingName,
}: MonitoringRightPanelProps) {
  if (!isOpen && !isMobileOpen) {
    return (
      <div className="hidden lg:flex w-10 bg-[#0D1322] border-l border-[#1E2942] flex-col items-center py-3 select-none shrink-0 z-20">
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded-lg bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors shadow-md cursor-pointer"
          title="Buka Panel Ringkasan Spasial & Produksi"
          aria-label="Buka Panel Ringkasan Spasial dan Produksi"
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
  const isSingleBoundary = Boolean(stats?.is_single_boundary);

  const ksGpaLuas = stats?.ks_gpa_luas_ha ?? 0;
  const ksGpaCount = stats?.ks_gpa_count ?? 0;
  const ktgLuas = stats?.ktg_luas_ha ?? 0;
  const ktgCount = stats?.ktg_count ?? 0;

  const ksGpaPct = luasUkurHa > 0 ? Math.round((ksGpaLuas / luasUkurHa) * 1000) / 10 : 0;
  const ktgPct = luasUkurHa > 0 ? Math.round((ktgLuas / luasUkurHa) * 1000) / 10 : 0;

  const selisihHa = stats?.selisih_luas_ha;
  const selisihPct = stats?.selisih_luas_pct;
  const auditStatus = stats?.audit_status;

  const cp = stats?.commodity_profile;
  const estPanenTon = stats?.estimasi_panen_ton ?? 0;
  const estOlahanTon = stats?.estimasi_olahan_ton;
  const afdBreakdown = stats?.afdeling_breakdown || [];

  const auditColor =
    auditStatus === 'sesuai'
      ? '#10B981'
      : auditStatus === 'lebih'
      ? '#00D2FF'
      : '#F59E0B';
  const auditLabel =
    auditStatus === 'sesuai'
      ? 'Sesuai Baku'
      : auditStatus === 'lebih'
      ? 'Fisik Lebih Luas'
      : 'Fisik Lebih Kecil';

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
        <div className="hidden lg:flex w-10 bg-[#0D1322] border-l border-[#1E2942] flex-col items-center py-3 select-none shrink-0 z-20">
          <button
            type="button"
            onClick={onToggle}
            className="p-2 rounded-lg bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors shadow-md cursor-pointer"
            title="Buka Panel Ringkasan Spasial & Produksi"
            aria-label="Buka Panel Ringkasan Spasial dan Produksi"
          >
            <span className="text-[10px] font-bold text-[#00D2FF] font-mono">GIS</span>
          </button>
        </div>
      )}

      <aside
        className={`${
          isMobileOpen
            ? 'fixed inset-y-0 right-0 z-[1200] flex w-[88vw] max-w-[340px] shadow-2xl'
            : 'hidden'
        } ${
          isOpen ? 'lg:static lg:z-20 lg:flex lg:w-64 xl:w-72 lg:shadow-none' : 'lg:hidden'
        } bg-[#0D1322] border-l border-[#1E2942] flex-col select-none shrink-0 h-full overflow-hidden text-[#F0F6FC]`}
      >
        {/* 1. Header Panel */}
        <div className="h-12 px-4 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between shrink-0">
          <div>
            <div className="text-sm font-bold text-[#F0F6FC] font-mono tracking-tight tabular-nums">
              {periodMonth} {periodYear}
            </div>
            <div className="text-[10px] text-[#00D2FF] font-medium">
              {isSingleBoundary ? 'Profil Batas Konsesi (ArcGIS)' : 'KPI Spasial & Produksi (ArcGIS)'}
            </div>
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="hidden lg:inline-flex p-1 rounded text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
            title="Sembunyikan Panel Informasi"
            aria-label="Sembunyikan Panel Informasi"
          >
            <IconChevronRight className="w-3.5 h-3.5" />
          </button>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden min-w-10 min-h-10 flex items-center justify-center rounded-lg text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
              title="Tutup Panel KPI"
              aria-label="Tutup Panel KPI"
            >
              <IconClose className="w-4 h-4" />
            </button>
          )}
        </div>

      {/* 2. Body Panel — 100% Ekstraksi Data Shapefile & PostGIS */}
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
                {stats?.total_layer ?? 0}{' '}
                <span className="text-[10px] font-normal text-[#8B9BB4]">SHP</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#1E2942]/60 space-y-1 text-[10px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#8B9BB4] shrink-0">Komoditas:</span>
              <span
                className="font-bold text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/40 px-1.5 py-0.5 rounded truncate max-w-[155px]"
                title={komoditas}
              >
                {komoditas}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#8B9BB4] shrink-0">CRS:</span>
              <span className="font-mono text-[#F0F6FC] truncate max-w-[155px]" title={crsAsal}>
                {crsAsal}
              </span>
            </div>
          </div>
        </div>

        {/* CARD B: Rekapitulasi Luas Spasial & Audit Selisih Lahan */}
        <div className="p-3 bg-[#0E3A5D] border border-[#00B4D8] rounded-xl space-y-2 shadow-md shadow-[#00B4D8]/10">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-[#FFFFFF]">
              {isSingleBoundary ? 'Luas Konsesi Kebun (Ha)' : 'Luas Wilayah Kelola (Ha)'}
            </div>
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
              <div className="text-[9.5px] text-[#7DD3FC]/80 mt-0.5">
                {isSingleBoundary && stats?.luas_m2
                  ? `${stats.luas_m2.toLocaleString('id-ID')} m²`
                  : 'Geodesik / DBF'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#7DD3FC] font-medium">
                {luasBakuHa
                  ? 'Luas Baku'
                  : isSingleBoundary
                  ? 'Areal Efektif'
                  : 'Jumlah Blok'}
              </div>
              <div className="text-2xl font-extrabold text-[#00D2FF] font-mono leading-none mt-1 tabular-nums">
                {luasBakuHa
                  ? fmt(luasBakuHa)
                  : isSingleBoundary
                  ? fmt(stats?.potensi_tanam_efektif_ha)
                  : totalBlok}
              </div>
              <div className="text-[9.5px] text-[#7DD3FC]/80 mt-0.5">
                {luasBakuHa
                  ? 'Dokumen Legal'
                  : isSingleBoundary
                  ? 'Potensi 85% Tanam'
                  : 'Poligon terpetakan'}
              </div>
            </div>
          </div>

          {/* Audit Selisih Ukur vs Baku */}
          {selisihHa !== undefined && selisihPct !== undefined && (
            <div
              className="p-2 rounded-lg border flex items-center justify-between text-[10px]"
              style={{
                background: `${auditColor}14`,
                borderColor: `${auditColor}50`,
              }}
            >
              <div>
                <div className="text-[#CBD5E1] font-semibold">Audit Selisih Lahan</div>
                <div className="text-[9px]" style={{ color: auditColor }}>
                  {auditLabel}
                </div>
              </div>
              <div className="text-right font-mono font-extrabold tabular-nums" style={{ color: auditColor }}>
                <div>
                  {selisihHa >= 0 ? '+' : ''}
                  {fmt(selisihHa)} Ha
                </div>
                <div className="text-[9.5px]">
                  ({selisihPct >= 0 ? '+' : ''}
                  {fmt(selisihPct, 1)}%)
                </div>
              </div>
            </div>
          )}

          <div className="pt-1.5 border-t border-[#00B4D8]/40 flex items-center justify-between text-[10px]">
            <span className="text-[#7DD3FC]">
              {isSingleBoundary ? 'Tipe Layer:' : 'Total Poligon Blok:'}
            </span>
            <span className="font-mono font-bold text-[#10B981] tabular-nums">
              {isSingleBoundary ? 'Batas Luar (Perimeter)' : `${totalBlok} Blok`}
            </span>
          </div>
        </div>

        {/* CARD C: Estimasi Produksi & Panen Otomatis */}
        {estPanenTon > 0 && cp && (
          <div className="p-3 bg-gradient-to-br from-[#0F241F] to-[#12192B] border border-[#10B981]/40 rounded-xl space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#ECFDF5] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                <span>Estimasi Produksi</span>
              </span>
              <span className="text-[9px] font-mono text-[#10B981] bg-[#10B981]/15 px-1.5 py-0.5 rounded border border-[#10B981]/30">
                {cp.yieldPerHa} Ton/Ha
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#10B981]/20">
              <div>
                <div className="text-[9.5px] text-[#94A3B8]">Est. Hasil Panen</div>
                <div className="text-base font-black text-[#10B981] font-mono leading-tight mt-0.5 tabular-nums">
                  {fmt(estPanenTon, 1)}
                </div>
                <div className="text-[9px] text-[#6EE7B7]">{cp.yieldUnit}</div>
              </div>
              {estOlahanTon !== null && estOlahanTon !== undefined && cp.processedUnit && (
                <div>
                  <div className="text-[9.5px] text-[#94A3B8]">
                    {cp.processedLabel || 'Hasil Olahan'}
                  </div>
                  <div className="text-base font-black text-[#00D2FF] font-mono leading-tight mt-0.5 tabular-nums">
                    {fmt(estOlahanTon, 2)}
                  </div>
                  <div className="text-[9px] text-[#7DD3FC]">{cp.processedUnit}</div>
                </div>
              )}
            </div>

            <div className="text-[9px] text-[#8B9BB4] pt-1 border-t border-[#1E2942]/80 leading-snug">
              {cp.standardSource}
            </div>
          </div>
        )}

        {/* CARD D: Rekapitulasi Afdeling / Klaster Blok (Otomatis dari DBF) */}
        {afdBreakdown.length > 0 && !isSingleBoundary && (
          <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
            <div className="flex items-center justify-between text-xs font-bold text-[#F0F6FC]">
              <span>Klaster Afdeling</span>
              <span className="text-[9.5px] font-mono text-[#00D2FF]">
                {afdBreakdown.length} Grup
              </span>
            </div>

            <div className="h-2 w-full bg-[#0A0E1A] rounded-full overflow-hidden flex border border-[#1E2942]">
              {afdBreakdown.map((a) => (
                <div
                  key={a.name}
                  style={{
                    width: `${luasUkurHa > 0 ? (a.luas_ukur_ha / luasUkurHa) * 100 : 0}%`,
                    background: a.color,
                  }}
                  title={`${a.name}: ${fmt(a.luas_ukur_ha)} Ha (${a.count} blok)`}
                />
              ))}
            </div>

            <div className="space-y-1.5 pt-0.5 text-[10.5px]">
              {afdBreakdown.map((a) => (
                <div key={a.name} className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-[#CBD5E1] min-w-0">
                    <span
                      className="w-2 h-2 rounded-xs shrink-0"
                      style={{ background: a.color }}
                    />
                    <span className="truncate font-medium" title={a.name}>
                      {a.name}
                    </span>
                    <span className="text-[9.5px] text-[#64748B] shrink-0">({a.count})</span>
                  </span>
                  <span className="font-mono font-bold text-[#F0F6FC] tabular-nums shrink-0">
                    {fmt(a.luas_ukur_ha)} Ha
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CARD E: Komposisi Status Pengelolaan Areal (KS GPA vs KTG) */}
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
                  {fmt(ksGpaLuas)} Ha{' '}
                  <span className="text-[10px] text-[#00D2FF]">({ksGpaPct}%)</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[#8B9BB4]">
                  <span className="w-2 h-2 rounded-xs bg-[#10B981]" />
                  <span>KTG Tebu ({ktgCount} blok)</span>
                </span>
                <span className="font-mono font-bold text-[#F0F6FC] tabular-nums">
                  {fmt(ktgLuas)} Ha{' '}
                  <span className="text-[10px] text-[#10B981]">({ktgPct}%)</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* CARD F: Dimensi Geometri — Adaptif (Batas Konsesi Tunggal vs Multi-Blok) */}
        {isSingleBoundary ? (
          <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
            <div className="flex items-center justify-between text-xs font-bold text-[#F0F6FC]">
              <span>Dimensi Batas Konsesi</span>
              <span className="text-[9.5px] font-mono text-[#00D2FF]">PostGIS</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#1E2942]/60 text-[11px]">
              <div>
                <div className="text-[10px] text-[#8B9BB4]">Keliling Batas</div>
                <div className="text-sm font-extrabold text-[#F0F6FC] font-mono tabular-nums">
                  {stats?.total_keliling_km ? `${fmt(stats.total_keliling_km)} km` : '-'}
                </div>
                <div className="text-[9.5px] text-[#566680]">
                  {stats?.keliling_meter
                    ? `${stats.keliling_meter.toLocaleString('id-ID')} meter`
                    : 'Perimeter luar'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#8B9BB4]">Potensi Tanam</div>
                <div className="text-sm font-extrabold text-[#10B981] font-mono tabular-nums">
                  {stats?.potensi_tanam_efektif_ha
                    ? `${fmt(stats.potensi_tanam_efektif_ha)} Ha`
                    : '-'}
                </div>
                <div className="text-[9.5px] text-[#566680]">85% Areal Efektif</div>
              </div>
            </div>
          </div>
        ) : (
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
        )}

        {/* CARD G: Info Budidaya & Varietas (hanya jika tercatat di atribut) */}
        {(stats?.varietas_dominan || stats?.masa_tanam || (stats?.luas_tanam_ha ?? 0) > 0) && (
          <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-1.5 text-center shadow-xs">
            <div className="text-xs font-bold text-[#8B9BB4] flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF]" />
              <span>Atribut Budidaya &amp; Tanam</span>
            </div>
            <div className="pt-0.5">
              <div className="text-xl font-black text-[#00D2FF] font-mono tracking-tight leading-none tabular-nums">
                {stats?.varietas_dominan || komoditas}
              </div>
              {stats?.masa_tanam && (
                <div className="text-[11px] text-[#F0F6FC] font-semibold mt-1">
                  Masa Tanam (MT): {stats.masa_tanam}
                </div>
              )}
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
        )}
      </div>

      {/* Footer Info */}
      <div className="p-2.5 bg-[#0D1322] border-t border-[#1E2942] text-[10px] text-[#8B9BB4] flex items-center justify-between shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#10B981]" />
          <span>100% Ekstraksi Multi-Kolom</span>
        </span>
        <span className="text-[#8B9BB4] font-mono">PostGIS</span>
      </div>
    </aside>
    </>
  );
}
