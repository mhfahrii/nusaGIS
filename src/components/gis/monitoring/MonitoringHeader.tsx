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
  kebunList: KebunItem[];
  selectedKebunId: number | null;
  onSelectKebun: (id: number | null) => void;
  selectedYear: string;
  onSelectYear: (year: string) => void;
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  onOpenUpload: () => void;
}

export function MonitoringHeader({
  kebunList,
  selectedKebunId,
  onSelectKebun,
  selectedYear,
  onSelectYear,
  selectedMonth,
  onSelectMonth,
  onOpenUpload,
}: MonitoringHeaderProps) {
  const { user, logout } = useAuth();

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
            Monitoring Spasial Kebun, Afdeling, &amp; Blok Kelapa Sawit
          </p>
        </div>
      </div>

      {/* 2. Middle Period & Quick Filter Indicators */}
      <div className="hidden lg:flex items-center gap-6 text-[11px] text-[#8B9BB4]">
        {/* Tahun Produksi */}
        <div className="flex flex-col">
          <span className="text-[10px] text-[#8B9BB4]">Tahun Produksi</span>
          <select
            value={selectedYear}
            onChange={(e) => onSelectYear(e.target.value)}
            className="bg-[#12192B] border border-[#1E2942] rounded px-2 py-0.5 text-[#F0F6FC] font-semibold focus:outline-none focus:border-[#00D2FF] cursor-pointer text-xs"
          >
            <option value="2026" className="bg-[#0D1322]">2026</option>
            <option value="2025" className="bg-[#0D1322]">2025</option>
            <option value="2024" className="bg-[#0D1322]">2024</option>
          </select>
        </div>

        {/* Bulan Produksi */}
        <div className="flex flex-col">
          <span className="text-[10px] text-[#8B9BB4]">Bulan Produksi</span>
          <select
            value={selectedMonth}
            onChange={(e) => onSelectMonth(e.target.value)}
            className="bg-[#12192B] border border-[#1E2942] rounded px-2 py-0.5 text-[#F0F6FC] font-semibold focus:outline-none focus:border-[#00D2FF] cursor-pointer text-xs"
          >
            <option value="Semua" className="bg-[#0D1322]">Semua Bulan</option>
            <option value="Januari" className="bg-[#0D1322]">Januari</option>
            <option value="Februari" className="bg-[#0D1322]">Februari</option>
            <option value="Maret" className="bg-[#0D1322]">Maret</option>
            <option value="April" className="bg-[#0D1322]">April</option>
            <option value="Mei" className="bg-[#0D1322]">Mei</option>
            <option value="Juni" className="bg-[#0D1322]">Juni</option>
            <option value="Juli" className="bg-[#0D1322]">Juli</option>
            <option value="Agustus" className="bg-[#0D1322]">Agustus</option>
            <option value="September" className="bg-[#0D1322]">September</option>
            <option value="Oktober" className="bg-[#0D1322]">Oktober</option>
            <option value="November" className="bg-[#0D1322]">November</option>
            <option value="Desember" className="bg-[#0D1322]">Desember</option>
          </select>
        </div>

        {/* Pilihan Kebun Utama */}
        <div className="flex flex-col">
          <span className="text-[10px] text-[#8B9BB4]">Pilihan Kebun</span>
          <select
            value={selectedKebunId || ''}
            onChange={(e) =>
              onSelectKebun(e.target.value ? Number(e.target.value) : null)
            }
            className="bg-[#12192B] border border-[#1E2942] rounded px-2 py-0.5 text-[#00D2FF] font-bold focus:outline-none focus:border-[#00D2FF] cursor-pointer text-xs"
          >
            <option value="" className="bg-[#0D1322]">Semua Kebun</option>
            {kebunList.map((k) => (
              <option key={k.id} value={k.id} className="bg-[#0D1322]">
                {k.nama_kebun} ({k.kode_kebun})
              </option>
            ))}
          </select>
        </div>
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

