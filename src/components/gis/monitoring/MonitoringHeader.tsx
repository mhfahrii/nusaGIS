'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { hasPermission } from '@/types/auth';
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
  activeCommodity?: string;
  onOpenUpload: () => void;
}

export function MonitoringHeader({
  kebunList = [],
  selectedKebunId = null,
  selectedStatusFilter = 'all',
  onSelectStatusFilter,
  activeCommodity,
  onOpenUpload,
}: MonitoringHeaderProps) {
  const { user } = useAuth();
  const activeKebun = selectedKebunId ? kebunList.find((k) => k.id === selectedKebunId) : null;

  return (
    <header className="min-h-12 sm:h-13 bg-[#0D1322] border-b border-[#1E2942] px-2.5 sm:px-4 py-1.5 sm:py-0 flex items-center justify-between gap-2 text-xs select-none shrink-0 z-30 shadow-md">
      {/* 1. Brand Logo & Title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-[#0E3A5D] border border-[#00D2FF]/50 flex items-center justify-center text-[#00D2FF] shadow-xs shrink-0">
          <IconTree className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="font-extrabold tracking-wider text-[#F0F6FC] text-xs sm:text-sm uppercase truncate">
              GIS Monitoring
            </span>
            <span className="hidden sm:inline-block px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#0E3A5D]/80 border border-[#00B4D8]/60 text-[#00D2FF] font-mono shrink-0">
              PostGIS
            </span>
          </div>
          <p className="hidden sm:block text-[10px] text-[#8B9BB4] leading-none truncate">
            PT Riset Perkebunan Nusantara (PT RPN) · Monitoring Spasial Kebun &amp; Blok Lahan
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
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#10B981]/20 border border-[#10B981]/50 text-[#10B981] flex items-center gap-1 max-w-[200px] truncate" title={activeCommodity || 'Semua Komoditas'}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse shrink-0"></span>
              <span className="truncate">{activeCommodity || 'Semua Komoditas'}</span>
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
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {hasPermission(user, 'upload_layer') && (
          <>
            <button
              type="button"
              onClick={onOpenUpload}
              className="min-h-9 sm:min-h-0 px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-[#00D2FF] hover:bg-[#38BDF8] active:bg-[#0EA5E9] text-[#0A0E1A] font-bold text-xs shadow-md shadow-[#00D2FF]/20 transition-all flex items-center gap-1.5 cursor-pointer"
              title="Upload File GIS (ZIP Shapefile / GeoJSON)"
              aria-label="Upload Data GIS"
            >
              <IconAddData className="w-3.5 h-3.5 shrink-0" />
              <span className="sm:hidden">Upload</span>
              <span className="hidden sm:inline">Upload Data</span>
            </button>

            <div className="h-5 w-px bg-[#1E2942] hidden sm:block" />
          </>
        )}

        {/* User Identity Pill Button -> Navigates to Dashboard Manajemen Karyawan & Pengaturan */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 pl-1 pr-3.5 py-1 rounded-full bg-[#12192B] hover:bg-[#172136] border border-[#1E2942] hover:border-[#00D2FF]/70 shadow-sm transition-all cursor-pointer group"
          title="Buka Dashboard Manajemen Karyawan, Create Account & Backup Riwayat"
        >
          <div className="w-8 h-8 rounded-full bg-[#0E3A5D] border border-[#00D2FF]/50 group-hover:border-[#00D2FF] text-[#00D2FF] font-bold text-xs flex items-center justify-center overflow-hidden shadow-xs shrink-0 transition-colors">
            {user?.foto_profil ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.foto_profil}
                alt={user.nama || 'Profil'}
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{user?.nama ? user.nama.substring(0, 2).toUpperCase() : 'FA'}</span>
            )}
          </div>
          <div className="text-left min-w-0">
            <div className="text-xs font-bold text-[#F0F6FC] group-hover:text-[#00D2FF] transition-colors leading-tight truncate max-w-[110px]">
              {user?.nama || 'fahri'}
            </div>
            <div className="text-[10px] text-[#8B9BB4] group-hover:text-[#00D2FF]/85 font-medium leading-tight">
              {user?.peran === 'admin' ? 'Admin' : 'Karyawan'}
            </div>
          </div>
        </Link>
      </div>
    </header>
  );
}

