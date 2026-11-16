'use client';

import React, { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

function initials(nama: string): string {
  const parts = nama.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function Header({ title, subtitle }: HeaderProps) {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0 sticky top-0 z-20">
      <div>
        <h2 className="text-lg font-bold text-slate-800 leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>

      {/* User Information */}
      <div className="flex items-center gap-4">
        {loading ? (
          <div className="h-9 w-40 rounded-lg bg-slate-100 animate-pulse" aria-label="Memuat pengguna" />
        ) : user ? (
          <>
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs font-semibold text-slate-800">{user.nama}</span>
              <span className="text-[11px] text-slate-400">
                {user.email} ·{' '}
                <span className={user.peran === 'admin' ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                  {user.peran === 'admin' ? 'Admin' : 'Pengguna'}
                </span>
              </span>
            </div>

            <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-xs ring-2 ring-emerald-100 shadow-xs">
              {initials(user.nama)}
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-red-600 hover:border-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60"
            >
              {loggingOut ? 'Keluar...' : 'Keluar'}
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
