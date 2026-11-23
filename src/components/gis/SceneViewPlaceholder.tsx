'use client';

import React from 'react';
import { IconGlobe3D, IconDatabase } from './GisIcons';

export function SceneViewPlaceholder() {
  return (
    <div className="h-full w-full bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-300 select-none relative overflow-hidden">
      {/* Background 3D grid line aesthetics */}
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:24px_24px]" />

      <div className="relative z-10 max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-2xl backdrop-blur-xs text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-950/80 border border-blue-600/40 text-blue-400 mx-auto flex items-center justify-center shadow-lg shadow-blue-900/20">
          <IconGlobe3D className="w-8 h-8" />
        </div>

        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-950 border border-blue-800/60 text-blue-300 text-caption font-semibold mb-2">
            <span>3D GIS Engine</span>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          </div>
          <h3 className="text-base font-bold text-slate-100">
            Scene View 3D Module (CesiumJS)
          </h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Arsitektur modul 3D telah disiapkan untuk rendering terrain kontur perkebunan
            dan elevasi blok menggunakan CesiumJS.
          </p>
        </div>

        <div className="bg-slate-950/80 rounded-lg p-3 text-left border border-slate-800/80 space-y-2 text-caption">
          <div className="font-semibold text-slate-300 flex items-center gap-2">
            <IconDatabase className="w-3.5 h-3.5 text-emerald-400" />
            <span>Kebutuhan Data Spasial 3D:</span>
          </div>
          <ul className="space-y-1.5 text-slate-400 pl-4 list-disc">
            <li>
              <strong className="text-slate-300">Digital Elevation Model (DEM):</strong> Data raster ketinggian (GeoTIFF / SRTM / LiDAR) untuk kontur lereng perkebunan.
            </li>
            <li>
              <strong className="text-slate-300">Extruded Block Features:</strong> Ekstrusi batas blok berdasarkan ketinggian dpl (meter).
            </li>
            <li>
              <strong className="text-slate-300">Integrasi CesiumJS:</strong> Diimplementasikan secara bertahap pada <span className="text-blue-400 font-medium">Tahap J</span> setelah layer 2D dan PostGIS stabil.
            </li>
          </ul>
        </div>

        <div className="text-caption text-slate-500 italic">
          *Sesuai panduan arsitektur: Tidak menampilkan visual 3D palsu tanpa sumber data elevasi nyata.
        </div>
      </div>
    </div>
  );
}
