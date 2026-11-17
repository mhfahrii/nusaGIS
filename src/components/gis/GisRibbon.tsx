'use client';

import React from 'react';
import Link from 'next/link';
import {
  IconPan,
  IconZoomIn,
  IconZoomOut,
  IconFullExtent,
  IconPrevExtent,
  IconNextExtent,
  IconSelect,
  IconClearSelect,
  IconMeasure,
  IconBasemap,
  IconAddData,
  IconLayers,
  IconTable,
  IconBuffer,
  IconClip,
  IconIntersect,
  IconDissolve,
  IconArea,
  IconGlobe3D,
  IconSave,
  IconFolder,
  IconDatabase,
} from './GisIcons';

export type RibbonTab =
  | 'Project'
  | 'Map'
  | 'Insert'
  | 'Analysis'
  | 'View'
  | 'Edit'
  | 'Imagery'
  | 'Share';

export type ActiveTool = 'pan' | 'select' | 'measure' | 'identify';

interface GisRibbonProps {
  activeTab: RibbonTab;
  onTabChange: (tab: RibbonTab) => void;
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
  onToggleTable: () => void;
  onToggleProperties: () => void;
  onClearSelection: () => void;
  selectedCount: number;
  onOpenAddData?: () => void;
}

export function GisRibbon({
  activeTab,
  onTabChange,
  activeTool,
  onToolChange,
  onToggleTable,
  onToggleProperties,
  onClearSelection,
  selectedCount,
  onOpenAddData,
}: GisRibbonProps) {
  const tabs: RibbonTab[] = [
    'Project',
    'Map',
    'Insert',
    'Analysis',
    'View',
    'Edit',
    'Imagery',
    'Share',
  ];

  return (
    <div className="bg-slate-900 border-b border-slate-800 text-slate-300 select-none shrink-0 z-20">
      {/* Ribbon Tabs Header */}
      <div className="flex items-center gap-1 px-2 pt-1 border-b border-slate-800/80 bg-slate-950/60">
        {tabs.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={`px-3 py-1 text-xs font-semibold rounded-t transition-colors ${
                isActive
                  ? 'bg-slate-900 text-emerald-400 border-t-2 border-emerald-500 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Ribbon Command Groups Area */}
      <div className="h-18 px-3 py-1 flex items-center gap-4 overflow-x-auto text-caption">
        {activeTab === 'Map' && (
          <>
            {/* Group: Navigate */}
            <div className="flex flex-col items-center border-r border-slate-800/80 pr-3">
              <div className="flex items-center gap-1 mb-1">
                <button
                  type="button"
                  onClick={() => onToolChange('pan')}
                  className={`flex flex-col items-center justify-center p-1.5 rounded transition-colors w-12 h-11 ${
                    activeTool === 'pan'
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                      : 'hover:bg-slate-800 text-slate-300'
                  }`}
                  title="Explore / Pan Peta"
                >
                  <IconPan className="w-4 h-4 mb-0.5" />
                  <span className="text-2xs leading-tight">Pan</span>
                </button>

                <button
                  type="button"
                  onClick={() => onToolChange('pan')}
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-300 transition-colors w-12 h-11"
                  title="Zoom In (Scroll Mouse ke depan)"
                >
                  <IconZoomIn className="w-4 h-4 mb-0.5" />
                  <span className="text-2xs leading-tight">Zoom In</span>
                </button>

                <button
                  type="button"
                  onClick={() => onToolChange('pan')}
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-300 transition-colors w-12 h-11"
                  title="Zoom Out (Scroll Mouse ke belakang)"
                >
                  <IconZoomOut className="w-4 h-4 mb-0.5" />
                  <span className="text-2xs leading-tight">Zoom Out</span>
                </button>

                <button
                  type="button"
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-300 transition-colors w-14 h-11"
                  title="Full Extent (Zoom ke seluruh wilayah perkebunan)"
                >
                  <IconFullExtent className="w-4 h-4 mb-0.5" />
                  <span className="text-2xs leading-tight">Full Extent</span>
                </button>

                <div className="flex flex-col gap-1 ml-0.5">
                  <button
                    type="button"
                    disabled
                    className="p-1 rounded text-slate-600 hover:text-slate-400 disabled:opacity-40 cursor-not-allowed"
                    title="Previous Extent (Fitur belum tersedia)"
                  >
                    <IconPrevExtent className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled
                    className="p-1 rounded text-slate-600 hover:text-slate-400 disabled:opacity-40 cursor-not-allowed"
                    title="Next Extent (Fitur belum tersedia)"
                  >
                    <IconNextExtent className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <span className="text-3xs uppercase tracking-wider font-semibold text-slate-400">
                Navigate
              </span>
            </div>

            {/* Group: Layer & Data */}
            <div className="flex flex-col items-center border-r border-slate-800/80 pr-3">
              <div className="flex items-center gap-1 mb-1">
                <button
                  type="button"
                  onClick={onOpenAddData}
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-200 transition-colors w-14 h-11 cursor-pointer"
                  title="Add Data / Unggah Shapefile ZIP ke PostGIS"
                >
                  <IconAddData className="w-4 h-4 mb-0.5 text-emerald-400" />
                  <span className="text-2xs leading-tight">Add Data</span>
                </button>

                <button
                  type="button"
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-300 transition-colors w-14 h-11"
                  title="Pilih Basemap (Satelit / OpenStreetMap / Positron)"
                >
                  <IconBasemap className="w-4 h-4 mb-0.5 text-emerald-400" />
                  <span className="text-2xs leading-tight">Basemap</span>
                </button>
              </div>
              <span className="text-3xs uppercase tracking-wider font-semibold text-slate-400">
                Layer & Data
              </span>
            </div>

            {/* Group: Selection */}
            <div className="flex flex-col items-center border-r border-slate-800/80 pr-3">
              <div className="flex items-center gap-1 mb-1">
                <button
                  type="button"
                  onClick={() => onToolChange('select')}
                  className={`flex flex-col items-center justify-center p-1.5 rounded transition-colors w-14 h-11 ${
                    activeTool === 'select'
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                      : 'hover:bg-slate-800 text-slate-300'
                  }`}
                  title="Select Features (Klik fitur pada peta)"
                >
                  <IconSelect className="w-4 h-4 mb-0.5" />
                  <span className="text-2xs leading-tight">Select</span>
                </button>

                <button
                  type="button"
                  onClick={onClearSelection}
                  disabled={selectedCount === 0}
                  className={`flex flex-col items-center justify-center p-1.5 rounded transition-colors w-16 h-11 ${
                    selectedCount > 0
                      ? 'hover:bg-rose-950/60 text-rose-300 border border-rose-800/40'
                      : 'text-slate-600 cursor-not-allowed opacity-40'
                  }`}
                  title="Bersihkan Seleksi Fitur"
                >
                  <IconClearSelect className="w-4 h-4 mb-0.5" />
                  <span className="text-2xs leading-tight">Clear ({selectedCount})</span>
                </button>
              </div>
              <span className="text-3xs uppercase tracking-wider font-semibold text-slate-400">
                Selection
              </span>
            </div>

            {/* Group: Inquire / Measure */}
            <div className="flex flex-col items-center border-r border-slate-800/80 pr-3">
              <div className="flex items-center gap-1 mb-1">
                <button
                  type="button"
                  onClick={() => onToolChange('measure')}
                  className={`flex flex-col items-center justify-center p-1.5 rounded transition-colors w-14 h-11 ${
                    activeTool === 'measure'
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                      : 'hover:bg-slate-800 text-slate-300'
                  }`}
                  title="Ukur Jarak dan Luas Geodesik"
                >
                  <IconMeasure className="w-4 h-4 mb-0.5" />
                  <span className="text-2xs leading-tight">Measure</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleTable}
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-300 transition-colors w-14 h-11"
                  title="Buka / Tutup Tabel Atribut Layer Terpilih"
                >
                  <IconTable className="w-4 h-4 mb-0.5 text-emerald-400" />
                  <span className="text-2xs leading-tight">Attribute</span>
                </button>
              </div>
              <span className="text-3xs uppercase tracking-wider font-semibold text-slate-400">
                Inquire
              </span>
            </div>

            {/* Group: Master Administrasi & Upload */}
            <div className="flex flex-col items-center border-r border-slate-800/80 pr-3">
              <div className="flex items-center gap-1 mb-1">
                <Link
                  href="/kebun"
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-200 transition-colors w-16 h-11"
                  title="Kelola Data Master Kebun (public.kebun)"
                >
                  <IconDatabase className="w-4 h-4 mb-0.5 text-emerald-400" />
                  <span className="text-2xs leading-tight">Data Kebun</span>
                </Link>

                <Link
                  href="/afdeling"
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-200 transition-colors w-14 h-11"
                  title="Kelola Data Master Afdeling"
                >
                  <IconFolder className="w-4 h-4 mb-0.5 text-blue-400" />
                  <span className="text-2xs leading-tight">Afdeling</span>
                </Link>

                <Link
                  href="/blok"
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-200 transition-colors w-12 h-11"
                  title="Kelola Data Master Blok"
                >
                  <IconLayers className="w-4 h-4 mb-0.5 text-amber-400" />
                  <span className="text-2xs leading-tight">Blok</span>
                </Link>

                <Link
                  href="/upload"
                  className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-200 transition-colors w-16 h-11"
                  title="Halaman Upload Data Spasial GIS (Shapefile ZIP)"
                >
                  <IconAddData className="w-4 h-4 mb-0.5 text-emerald-400" />
                  <span className="text-2xs leading-tight">Upload GIS</span>
                </Link>
              </div>
              <span className="text-3xs uppercase tracking-wider font-semibold text-slate-400">
                Administrasi & Impor
              </span>
            </div>
          </>
        )}

        {activeTab === 'Analysis' && (
          <div className="flex items-center gap-1">
            {[
              { name: 'Select By Attr', icon: IconSelect },
              { name: 'Select By Loc', icon: IconLayers },
              { name: 'Buffer', icon: IconBuffer },
              { name: 'Clip', icon: IconClip },
              { name: 'Intersect', icon: IconIntersect },
              { name: 'Dissolve', icon: IconDissolve },
              { name: 'Calculate Area', icon: IconArea },
            ].map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.name}
                  type="button"
                  disabled
                  className="flex flex-col items-center justify-center p-1.5 rounded text-slate-500 hover:bg-slate-800/30 cursor-not-allowed w-20 h-11"
                  title={`${tool.name} (Modul Geoprocessing disiapkan pada Tahap I)`}
                >
                  <Icon className="w-4 h-4 mb-0.5 text-slate-500" />
                  <span className="text-2xs leading-tight text-center truncate w-full">
                    {tool.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'Project' && (
          <div className="flex items-center gap-2 text-slate-400">
            <button
              type="button"
              className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-300 w-16 h-11"
              title="Simpan Workspace Perkebunan Saat Ini"
            >
              <IconSave className="w-4 h-4 mb-0.5 text-emerald-400" />
              <span className="text-2xs">Save</span>
            </button>
            <button
              type="button"
              disabled
              className="flex flex-col items-center justify-center p-1.5 rounded text-slate-600 cursor-not-allowed w-16 h-11"
              title="Fitur belum tersedia"
            >
              <IconFolder className="w-4 h-4 mb-0.5" />
              <span className="text-2xs">Open Project</span>
            </button>
          </div>
        )}

        {activeTab === 'Insert' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              className="flex flex-col items-center justify-center p-1.5 rounded text-slate-600 cursor-not-allowed w-20 h-11"
              title="Fitur belum tersedia"
            >
              <IconGlobe3D className="w-4 h-4 mb-0.5" />
              <span className="text-2xs">New Map View</span>
            </button>
          </div>
        )}

        {activeTab === 'View' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleTable}
              className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-300 w-20 h-11"
            >
              <IconTable className="w-4 h-4 mb-0.5 text-emerald-400" />
              <span className="text-2xs">Attribute Table</span>
            </button>
            <button
              type="button"
              onClick={onToggleProperties}
              className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-slate-800 text-slate-300 w-20 h-11"
            >
              <IconLayers className="w-4 h-4 mb-0.5 text-emerald-400" />
              <span className="text-2xs">Properties Panel</span>
            </button>
          </div>
        )}

        {['Edit', 'Imagery', 'Share'].includes(activeTab) && (
          <div className="flex items-center gap-2 text-slate-500 italic text-xs">
            <span>Tab {activeTab}: modul disiapkan bertahap sesuai spesifikasi.</span>
          </div>
        )}
      </div>
    </div>
  );
}

