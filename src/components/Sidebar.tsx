'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconDashboard,
  IconKebun,
  IconAfdeling,
  IconBlok,
  IconUpload,
  IconLayer,
  IconMap,
  IconHistory,
  IconSettings,
  IconTree,
} from '@/components/icons';

interface MenuItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isReady: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { name: 'GIS Workspace', href: '/', icon: IconMap, isReady: true },
  { name: 'Data Kebun', href: '/kebun', icon: IconKebun, isReady: true },
  { name: 'Data Afdeling', href: '/afdeling', icon: IconAfdeling, isReady: true },
  { name: 'Data Blok', href: '/blok', icon: IconBlok, isReady: true },
  { name: 'Upload Data GIS', href: '/upload', icon: IconUpload, isReady: true },
  { name: 'Layer & Peta Interaktif', href: '/', icon: IconLayer, isReady: true },
  { name: 'Dashboard Ringkasan', href: '/kebun', icon: IconDashboard, isReady: true },
  { name: 'Riwayat Aktivitas', href: '/riwayat', icon: IconHistory, isReady: false },
  { name: 'Pengaturan', href: '/pengaturan', icon: IconSettings, isReady: false },
];

interface SidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({ isMobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`${
          isMobileOpen
            ? 'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shadow-2xl'
            : 'hidden'
        } lg:static lg:z-auto lg:flex lg:w-64 lg:shadow-none bg-slate-900 text-slate-300 flex-col shrink-0 border-r border-slate-800 min-h-dvh`}
      >
        {/* Brand & Logo */}
        <div className="h-16 flex items-center justify-between gap-2 px-5 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-xs shadow-emerald-500/20 shrink-0">
              <IconTree className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white tracking-wide truncate">GIS MONITORING</h1>
              <p className="text-[11px] text-emerald-400 font-medium truncate">Web GIS Perkebunan</p>
            </div>
          </div>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Tutup menu navigasi"
              className="lg:hidden min-w-10 min-h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

      {/* Navigasi Menu */}
      <div className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Menu Utama
        </div>
        {MENU_ITEMS.slice(0, 4).map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              className={`min-h-11 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}

        <div className="pt-5 px-3 pb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          GIS & Pemetaan
        </div>
        {MENU_ITEMS.slice(4, 7).map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.isReady ? item.href : '#'}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-600 text-white'
                  : item.isReady
                  ? 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  : 'text-slate-500 hover:bg-slate-800/40 cursor-not-allowed opacity-75'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5 text-slate-500" />
                <span>{item.name}</span>
              </div>
              {!item.isReady && (
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-400">
                  Soon
                </span>
              )}
            </Link>
          );
        })}

        <div className="pt-5 px-3 pb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Sistem & Audit
        </div>
        {MENU_ITEMS.slice(7).map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.isReady ? item.href : '#'}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-600 text-white'
                  : item.isReady
                  ? 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  : 'text-slate-500 hover:bg-slate-800/40 cursor-not-allowed opacity-75'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5 text-slate-500" />
                <span>{item.name}</span>
              </div>
              {!item.isReady && (
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-400">
                  Soon
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Footer Info Database Status */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/30">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
          <span className="text-xs font-semibold text-slate-300">PostGIS 3.6 Active</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5">Database: nusaGis</p>
      </div>
    </aside>
    </>
  );
}

