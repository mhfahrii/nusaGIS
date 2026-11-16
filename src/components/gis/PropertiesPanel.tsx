'use client';

import React, { useState } from 'react';
import { IconLayers, IconClose, IconDatabase } from './GisIcons';
import type { LayerPeta } from '@/types/gis';

interface PropertiesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLayer: LayerPeta | undefined;
  onUpdateLayer?: (id: number, updates: Partial<LayerPeta>) => void;
}

export function PropertiesPanel({
  isOpen,
  onClose,
  selectedLayer,
  onUpdateLayer,
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<'properties' | 'symbology' | 'labels' | 'geoprocessing'>('properties');
  const [color, setColor] = useState(selectedLayer?.warna || '#10b981');
  const [opacity, setOpacity] = useState(Math.round((selectedLayer?.transparansi || 0.25) * 100));

  if (!isOpen) return null;

  const handleColorChange = async (newColor: string) => {
    setColor(newColor);
    if (selectedLayer && onUpdateLayer) {
      onUpdateLayer(selectedLayer.id, { warna: newColor });
      try {
        await fetch('/api/gis/layers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedLayer.id, warna: newColor }),
        });
      } catch (e) {
        console.error('Update layer color error:', e);
      }
    }
  };

  const handleOpacityChange = async (newOpacityVal: number) => {
    setOpacity(newOpacityVal);
    const trans = newOpacityVal / 100;
    if (selectedLayer && onUpdateLayer) {
      onUpdateLayer(selectedLayer.id, { transparansi: trans });
      try {
        await fetch('/api/gis/layers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedLayer.id, transparansi: trans }),
        });
      } catch (e) {
        console.error('Update layer opacity error:', e);
      }
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-slate-950 border-l border-slate-800 text-slate-200 select-none overflow-hidden">
      {/* Header */}
      <div className="h-9 px-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2 font-bold text-slate-100">
          <IconLayers className="w-4 h-4 text-emerald-400" />
          <span>Layer Properties</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
          title="Tutup Panel Properties"
        >
          <IconClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-800/80 bg-slate-950/40 text-[11px] px-2 pt-1 shrink-0">
        {[
          { id: 'properties', label: 'General' },
          { id: 'symbology', label: 'Symbology' },
          { id: 'labels', label: 'Labels' },
          { id: 'geoprocessing', label: 'Toolbox' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-2.5 py-1 font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-emerald-400 border-emerald-500 font-semibold'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 p-3 overflow-y-auto text-xs space-y-4">
        {selectedLayer ? (
          <>
            {activeTab === 'properties' && (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase font-semibold text-slate-500 block">
                    Nama Layer
                  </label>
                  <div className="text-sm font-bold text-slate-100 mt-0.5">
                    {selectedLayer.nama_layer}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/80 space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Data Source:</span>
                    <span className="font-mono text-emerald-400">PostGIS 3.6</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Tipe Geometri:</span>
                    <span className="font-mono text-slate-200">{selectedLayer.tipe_geometri}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Spatial Reference:</span>
                    <span className="font-mono text-slate-200">EPSG:4326 (WGS 84)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">SRID:</span>
                    <span className="font-mono text-slate-200">4326</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Jumlah Fitur:</span>
                    <span className="font-mono text-slate-200">{selectedLayer.jumlah_fitur} fitur</span>
                  </div>
                  {selectedLayer.nama_file_shp && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">File Shapefile:</span>
                      <span className="font-mono text-slate-300">{selectedLayer.nama_file_shp}</span>
                    </div>
                  )}
                </div>

                {selectedLayer.bbox && (
                  <div className="space-y-1 text-[11px]">
                    <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                      Bounding Box Extent (BBOX)
                    </span>
                    <div className="p-2 bg-slate-900/40 rounded border border-slate-800 font-mono text-[10px] text-slate-400 leading-relaxed">
                      MinX: {selectedLayer.bbox[0].toFixed(5)}, MinY: {selectedLayer.bbox[1].toFixed(5)}<br />
                      MaxX: {selectedLayer.bbox[2].toFixed(5)}, MaxY: {selectedLayer.bbox[3].toFixed(5)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'symbology' && (
              <div className="space-y-4">
                <div className="text-[11px] font-semibold text-slate-300">
                  Vector Symbology
                </div>

                <div>
                  <label className="text-[10px] uppercase font-semibold text-slate-500 block mb-1">
                    Layer Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => handleColorChange(e.target.value)}
                      className="w-8 h-8 rounded border border-slate-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => handleColorChange(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-300 w-24"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <label className="text-[10px] uppercase font-semibold text-slate-500">
                      Fill Opacity
                    </label>
                    <span className="font-mono text-slate-300">{opacity}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    value={opacity}
                    onChange={(e) => handleOpacityChange(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {activeTab === 'labels' && (
              <div className="space-y-3 text-[11px]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-emerald-600 accent-emerald-500"
                  />
                  <span className="font-semibold text-slate-200">Aktifkan Label Spasial</span>
                </label>
              </div>
            )}

            {activeTab === 'geoprocessing' && (
              <div className="space-y-3 text-[11px]">
                <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-2">
                  <IconDatabase className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Geoprocessing Tools</span>
                </div>
                <div className="space-y-1.5">
                  {[
                    'Buffer (Jarak Penyangga)',
                    'Clip (Pemotongan Batas)',
                    'Intersect (Irisan Spasial)',
                    'Dissolve (Penggabungan Geometri)',
                    'Calculate Area (Hitung Luas Ha)',
                  ].map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      disabled
                      className="w-full text-left p-2 rounded bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed hover:bg-slate-900/60 transition-colors"
                      title="Fitur belum tersedia (Tahap I)"
                    >
                      {tool}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-slate-500">
            Pilih layer pada panel Contents untuk melihat properties.
          </div>
        )}
      </div>
    </div>
  );
}
