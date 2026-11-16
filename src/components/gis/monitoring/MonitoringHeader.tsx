'use client';

import React from 'react';
import { useAuth } from '@/components/AuthProvider';
import { IconTree } from '@/components/icons';
import { IconAddData } from '../GisIcons';

interface KebunItem {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
}

interface MonitoringHeaderProps {
  kebunList?: KebunItem[];
  selectedKebunId?: number | null;
  onSelectKebun?: (id: number | null) => void;
  selectedStatusFilter?: string;
  onSelectStatusFilter?: (status: string) => void;
  selectedYear?: string;
  onSelectYear?: (year: string) => void;
  selectedMonth?: string;
  onSelectMonth?: (month: string) => void;
  onOpenUpload: () => void;
}

export function MonitoringHeader({
  kebunList = [],
  selectedKebunId = null,
  selectedStatusFilter = 'all',
  onSelectStatusFilter,
  onOpenUpload,
}: MonitoringHeaderProps) {
  const { user, logout } = useAuth();
  const activeKebun = selectedKebunId ? kebunList.find((k) => k.id === selectedKebunId) : null;

  return (
    <header className="h-13 bg-[#0D1322] border-b border-[#1E2942] px-4 flex items-center justify-between text-xs select-none shrink-0 z-30 shadow-md">
      {/* 1. Brand Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#0E3A5D] border border-[#00D2FF]/50 flex items-center justify-center text-[#00D2FF] shadow-xs">
          <IconTree className="w-4.5 h-4.5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-wider text-[#F0F6FC] text-sm uppercase">
              NusaGIS Monitoring
            </span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#0E3A5D]/80 border border-[#00B4D8]/60 text-[#00D2FF] font-mono">
              PostGIS
            </span>
          </div>
          <p className="text-[10px] text-[#8B9BB4] leading-none">
            Monitoring Spasial Kebun &amp; Blok Lahan (Tebu / Agribisnis)
          </p>
        </div>
      </div>

      {/* 2. Middle Period & Quick Filter Indicators */}
      <div className="hidden lg:flex items-center gap-6 text-[11px] text-[#8B9BB4]">
        {/* Filter Status Pengelolaan Areal (Standar ArcGIS Pro) */}
        <div className="flex flex-col">
          <span className="text-[10px] text-[#8B9BB4] flex items-center gap-1 font-semibold">
            <span>Status Pengelolaan</span>
            <span className="text-[9px] text-[#00D2FF] font-mono px-1 bg-[#0E3A5D]/60 rounded">ArcGIS</span>
          </span>
          <select
            value={selectedStatusFilter}
            onChange={(e) => onSelectStatusFilter?.(e.target.value)}
            className="bg-[#12192B] border border-[#1E2942] rounded px-2.5 py-0.5 text-[#F0F6FC] font-semibold focus:outline-none focus:border-[#00D2FF] cursor-pointer text-xs mt-0.5"
          >
            <option value="all" className="bg-[#0D1322]">Semua Status Areal</option>
            <option value="ktg" className="bg-[#0D1322]">🟢 KTG (Kebun Sendiri)</option>
            <option value="ks_gpa" className="bg-[#0D1322]">🔵 KS GPA 2023 (Garapan)</option>
          </select>
        </div>

        {/* Indikator Komoditas Aktif */}
        <div className="flex flex-col justify-center">
          <span className="text-[10px] text-[#8B9BB4] font-semibold">Komoditas Lahan</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#10B981]/20 border border-[#10B981]/50 text-[#10B981] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></span>
              <span>Tebu (PSKA 942)</span>
            </span>
          </div>
        </div>

        {/* Indikator Unit Kebun Terpilih (Sinkron Otomatis dari Sidebar Filter) */}
        {activeKebun && (
          <div className="flex flex-col justify-center animate-in fade-in duration-200">
            <span className="text-[10px] text-[#8B9BB4] font-semibold">Fokus Unit Terpilih</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#0E3A5D]/70 border border-[#00D2FF]/40 text-[#00D2FF] flex items-center gap-1.5 shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00D2FF]"></span>
                <span>{activeKebun.nama_kebun} ({activeKebun.kode_kebun})</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 3. Action Buttons & User Profile */}
      <div className="flex items-center gap-3">
        {/* Tombol Upload Data GIS */}
        <button
          type="button"
          onClick={onOpenUpload}
          className="px-3.5 py-1.5 rounded-lg bg-[#00D2FF] hover:bg-[#38BDF8] text-[#0A0E1A] font-bold text-xs shadow-md shadow-[#00D2FF]/20 transition-all flex items-center gap-1.5 cursor-pointer"
          title="Upload File GIS (ZIP Shapefile / GeoJSON)"
        >
          <IconAddData className="w-3.5 h-3.5" />
          <span>Upload Data</span>
        </button>

        <div className="h-5 w-px bg-[#1E2942] hidden sm:block" />

        {/* User Identity */}
        <div className="flex items-center gap-2">
          <div className="text-right hidden md:block">
            <div className="text-[11px] font-semibold text-[#F0F6FC] leading-tight">
              {user?.nama || 'Administrator'}
            </div>
            <div className="text-[10px] text-[#00D2FF] font-medium capitalize">
              {user?.peran || 'admin'}
            </div>
          </div>
          <div className="w-7 h-7 rounded-full bg-[#12192B] border border-[#1E2942] text-[#00D2FF] font-bold text-xs flex items-center justify-center shadow-xs">
            {user?.nama ? user.nama.substring(0, 2).toUpperCase() : 'AD'}
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="text-[11px] text-[#8B9BB4] hover:text-[#EF4444] px-1.5 py-0.5 rounded hover:bg-[#12192B] transition-colors cursor-pointer"
            title="Keluar dari sesi"
          >
            Keluar
          </button>
        </div>
      </div>
    </header>
  );
}

