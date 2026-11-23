'use client';

import React from 'react';

interface GisStatusBarProps {
  crs?: string;
  lat: number;
  lng: number;
  scale?: string;
  zoomLevel?: number;
  selectedCount: number;
  totalFeatures: number;
  dbStatus?: string;
}

export function GisStatusBar({
  crs = 'EPSG:4326',
  lat,
  lng,
  scale = '1:25,000',
  zoomLevel = 14.5,
  selectedCount,
  totalFeatures,
  dbStatus = 'PostGIS 3.6 Active (nusaGis)',
}: GisStatusBarProps) {
  // Format coordinate to DMS (Degrees, Minutes, Seconds)
  const formatCoord = (deg: number, isLat: boolean) => {
    const dir = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
    const absDeg = Math.abs(deg);
    const d = Math.floor(absDeg);
    const m = Math.floor((absDeg - d) * 60);
    const s = (((absDeg - d) * 60 - m) * 60).toFixed(1);
    return `${d}°${m}'${s}"${dir}`;
  };

  return (
    <footer className="h-6 bg-slate-950 border-t border-slate-800 px-3 flex items-center justify-between text-caption text-slate-400 select-none shrink-0 z-30 font-mono">
      {/* Left side: CRS & DB */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500 font-sans text-2xs">CRS:</span>
          <span className="font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 px-1.5 py-0.2 rounded text-2xs">
            {crs}
          </span>
        </div>

        <div className="h-3 w-px bg-slate-800" />

        <div className="flex items-center gap-1.5 text-2xs text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>{dbStatus}</span>
        </div>
      </div>

      {/* Right side: Scale, Coordinates, Selection */}
      <div className="flex items-center gap-4 text-2xs">
        <div>
          <span className="text-slate-500 font-sans">Scale:</span>{' '}
          <span className="text-slate-300">{scale}</span>
        </div>

        <div className="h-3 w-px bg-slate-800" />

        <div>
          <span className="text-slate-500 font-sans">Zoom:</span>{' '}
          <span className="text-slate-300">{zoomLevel.toFixed(1)}</span>
        </div>

        <div className="h-3 w-px bg-slate-800" />

        <div>
          <span className="text-slate-500 font-sans">Coordinates:</span>{' '}
          <span className="text-emerald-300 font-semibold">
            {formatCoord(lat, true)} {formatCoord(lng, false)}
          </span>
        </div>

        <div className="h-3 w-px bg-slate-800" />

        <div>
          <span className="text-slate-500 font-sans">Selection:</span>{' '}
          <span className={selectedCount > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
            {selectedCount} of {totalFeatures} selected
          </span>
        </div>
      </div>
    </footer>
  );
}

