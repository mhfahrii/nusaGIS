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
    <header
      data-nusa-chrome
      className="h-13 bg-bg-nav border-b border-border-subtle px-3 sm:px-4 flex items-center justify-between gap-2 text-xs select-none shrink-0 z-30 shadow-md min-w-0"
    >
      {/* 1. Brand Logo & Title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
        <div className="w-8 h-8 rounded-lg bg-bg-surface border border-border-subtle flex items-center justify-center text-status-success">
          <IconTree className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-wider text-text-primary text-xs sm:text-sm uppercase truncate">
              NusaGIS Monitoring
            </span>
          </div>
          <p className="text-2xs text-text-secondary leading-none hidden md:block truncate">
            Monitoring Spasial Kebun &amp; Blok Lahan (Tebu / Agribisnis)
          </p>
        </div>
      </div>

      {/* 2. Middle Period & Quick Filter Indicators */}
      <div className="hidden lg:flex items-center gap-6 text-caption text-text-secondary">
        <div className="flex flex-col">
          <span className="text-2xs text-text-secondary font-semibold">Status pengelolaan lahan</span>
          <select
            value={selectedStatusFilter}
            onChange={(e) => onSelectStatusFilter?.(e.target.value)}
            className="bg-bg-surface border border-border-subtle rounded px-2.5 py-0.5 text-text-primary font-semibold nusa-focus focus:border-border-active cursor-pointer text-xs mt-0.5"
          >
            <option value="all" className="bg-bg-nav">Semua Status Areal</option>
            <option value="ktg" className="bg-bg-nav">KTG (Kebun Sendiri)</option>
            <option value="ks_gpa" className="bg-bg-nav">KS GPA 2023 (Garapan)</option>
          </select>
        </div>

        {/* Indikator Komoditas Aktif */}
        <div className="flex flex-col justify-center">
          <span className="text-2xs text-text-secondary font-semibold">Komoditas Lahan</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="px-2 py-0.5 rounded text-2xs font-bold bg-status-success/20 border border-status-success/50 text-status-success flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse"></span>
              <span>Tebu (PSKA 942)</span>
            </span>
          </div>
        </div>

        {/* Indikator Unit Kebun Terpilih (Sinkron Otomatis dari Sidebar Filter) */}
        {activeKebun && (
          <div className="flex flex-col justify-center animate-in fade-in duration-200">
            <span className="text-2xs text-text-secondary font-semibold">Fokus Unit Terpilih</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="px-2 py-0.5 rounded text-2xs font-bold bg-bg-accent-surface/70 border border-border-active/40 text-accent-primary flex items-center gap-1.5 shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-primary"></span>
                <span>{activeKebun.nama_kebun} ({activeKebun.kode_kebun})</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 3. Action Buttons & User Profile */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Tombol Upload Data GIS */}
        <button
          type="button"
          onClick={onOpenUpload}
          className="min-h-11 px-3 sm:px-4 py-2 rounded-lg bg-accent-primary hover:brightness-110 text-background font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer nusa-focus"
          title="Upload File GIS (ZIP Shapefile / GeoJSON)"
        >
          <IconAddData className="w-3.5 h-3.5 shrink-0" />
          <span className="sm:hidden">Upload</span>
          <span className="hidden sm:inline">Upload Data</span>
        </button>

        <div className="h-5 w-px bg-border-subtle hidden sm:block" />

        {/* User Identity */}
        <div className="flex items-center gap-2">
          <div className="text-right hidden md:block">
            <div className="text-caption font-semibold text-text-primary leading-tight">
              {user?.nama || 'Administrator'}
            </div>
            <div className="text-2xs text-accent-primary font-medium capitalize">
              {user?.peran || 'admin'}
            </div>
          </div>
          <div className="w-7 h-7 rounded-full bg-bg-surface border border-border-subtle text-accent-primary font-bold text-xs flex items-center justify-center shadow-xs">
            {user?.nama ? user.nama.substring(0, 2).toUpperCase() : 'AD'}
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="text-caption text-text-secondary hover:text-status-danger px-1.5 py-0.5 rounded hover:bg-bg-surface transition-colors cursor-pointer"
            title="Keluar dari sesi"
          >
            Keluar
          </button>
        </div>
      </div>
    </header>
  );
}

