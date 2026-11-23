'use client';

import React from 'react';
import { IconGlobe3D, IconMap, IconSplit } from './GisIcons';

export type ViewMode = '2D' | '3D' | 'SPLIT';

interface MapViewTabsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function MapViewTabs({ viewMode, onViewModeChange }: MapViewTabsProps) {
  return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-3 text-xs select-none shrink-0 z-10">
      {/* Tabs */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onViewModeChange('2D')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
            viewMode === '2D'
              ? 'bg-slate-900 text-emerald-400 border border-slate-800 shadow-xs'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <IconMap className="w-3.5 h-3.5" />
          <span>Map View (2D GIS)</span>
        </button>

        <button
          type="button"
          onClick={() => onViewModeChange('3D')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
            viewMode === '3D'
              ? 'bg-slate-900 text-emerald-400 border border-slate-800 shadow-xs'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <IconGlobe3D className="w-3.5 h-3.5 text-blue-400" />
          <span>Scene View (3D GIS)</span>
        </button>
      </div>

      {/* Split View Toggle */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onViewModeChange(viewMode === 'SPLIT' ? '2D' : 'SPLIT')}
          className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-caption font-medium border transition-colors ${
            viewMode === 'SPLIT'
              ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title="Tampilkan Map View 2D dan Scene View 3D Berdampingan"
        >
          <IconSplit className="w-3.5 h-3.5" />
          <span>{viewMode === 'SPLIT' ? 'Single View' : 'Side-by-Side (2D/3D)'}</span>
        </button>
      </div>
    </div>
  );
}

