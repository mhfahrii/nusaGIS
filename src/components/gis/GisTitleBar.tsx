'use client';

import React from 'react';
import { useAuth } from '@/components/AuthProvider';
import { IconTree } from '@/components/icons';
import { IconSave, IconUndo, IconRedo } from './GisIcons';
import { WorkspaceSearchBox } from './WorkspaceSearchBox';
import type { SearchResultItem } from '@/types/gis';

interface GisTitleBarProps {
  projectName?: string;
  isPropertiesOpen: boolean;
  onToggleProperties: () => void;
  isTableOpen: boolean;
  onToggleTable: () => void;
  onSelectSearchResult?: (item: SearchResultItem) => void;
}

export function GisTitleBar({
  projectName = 'Perkebunan',
  isPropertiesOpen,
  onToggleProperties,
  isTableOpen,
  onToggleTable,
  onSelectSearchResult,
}: GisTitleBarProps) {
  const { user, logout } = useAuth();

  return (
    <header className="h-10 bg-slate-950 border-b border-slate-800/80 px-3 flex items-center justify-between text-xs select-none shrink-0 z-40">
      {/* Brand & Project Info */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-emerald-600 flex items-center justify-center text-white shadow-xs">
            <IconTree className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold tracking-wider text-slate-100 text-xs uppercase">
            Web GIS Perkebunan
          </span>
        </div>

        <div className="h-4 w-px bg-slate-800" />

        {/* Project Name & Status */}
        <div className="hidden md:flex items-center gap-2">
          <span className="text-slate-400">Project:</span>
          <span className="font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded text-caption">
            {projectName}
          </span>
          <span className="flex items-center gap-1.5 text-caption text-slate-400 ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            PostGIS Aktif
          </span>
        </div>

        {/* Quick Save / Undo / Redo */}
        <div className="hidden lg:flex items-center gap-1 ml-1 text-slate-400">
          <button
            type="button"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Simpan Workspace (Ctrl+S)"
          >
            <IconSave className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled
            className="p-1 rounded text-slate-600 cursor-not-allowed"
            title="Undo"
          >
            <IconUndo className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled
            className="p-1 rounded text-slate-600 cursor-not-allowed"
            title="Redo"
          >
            <IconRedo className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center Search Box (Kebun, Layer, & Atribut Fitur + Auto Zoom) */}
      {onSelectSearchResult && (
        <WorkspaceSearchBox onSelectResult={onSelectSearchResult} />
      )}

      {/* Right Controls: Workspace Views & User */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleTable}
          className={`px-2 py-1 rounded text-caption font-medium border transition-colors ${
            isTableOpen
              ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Buka/Tutup Tabel Atribut"
        >
          Tabel Atribut
        </button>

        <button
          type="button"
          onClick={onToggleProperties}
          className={`px-2 py-1 rounded text-caption font-medium border transition-colors ${
            isPropertiesOpen
              ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Buka/Tutup Panel Properties"
        >
          Properties
        </button>

        <div className="h-4 w-px bg-slate-800" />

        {/* User Identity */}
        <div className="flex items-center gap-2">
          <div className="text-right hidden sm:block">
            <div className="text-caption font-semibold text-slate-200 leading-tight">
              {user?.nama || 'Administrator'}
            </div>
            <div className="text-2xs text-emerald-400 capitalize">
              {user?.peran || 'admin'}
            </div>
          </div>
          <div className="w-6 h-6 rounded-full bg-emerald-700 text-white font-bold text-2xs flex items-center justify-center ring-1 ring-emerald-500/40">
            {user?.nama ? user.nama.substring(0, 2).toUpperCase() : 'AD'}
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="text-caption text-slate-400 hover:text-rose-400 px-1.5 py-0.5 rounded hover:bg-slate-900 transition-colors"
            title="Keluar dari sesi"
          >
            Keluar
          </button>
        </div>
      </div>
    </header>
  );
}
