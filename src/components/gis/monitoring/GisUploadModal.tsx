'use client';

import React, { useState, useEffect } from 'react';
import {
  IconClose,
  IconAddData,
  IconLayers,
  IconTable,
} from '../GisIcons';
import { KNOWN_CRS_WKT } from '@/lib/gis/crs';
import type { DetectedDataset, LayerPeta } from '@/types/gis';

interface KebunOption {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
}

interface AfdelingOption {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
}

interface BlokOption {
  id: number;
  afdeling_id: number;
  kode_blok: string;
  nama_blok: string;
}

interface GisUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (
    newLayers: LayerPeta[],
    bbox: [number, number, number, number] | null
  ) => void;
}

const LAYER_CATEGORIES = [
  'Batas Kebun',
  'Batas Afdeling',
  'Batas Blok',
  'Jalan Kebun',
  'Sungai',
  'Infrastruktur',
  'Citra Satelit / Drone',
  'Peta Tematik NDVI',
  'Digital Elevation Model (DEM)',
  'Lainnya',
];

export function GisUploadModal({
  isOpen,
  onClose,
  onUploadSuccess,
}: GisUploadModalProps) {
  const [step, setStep] = useState<'select' | 'mapping' | 'importing'>('select');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fallbackCrs, setFallbackCrs] = useState<string>('EPSG:4326');
  const [isInspecting, setIsInspecting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inspection results
  const [tempId, setTempId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [detectedDatasets, setDetectedDatasets] = useState<DetectedDataset[]>([]);

  // Metadata kebun, afdeling, blok dari database
  const [kebunList, setKebunList] = useState<KebunOption[]>([]);
  const [afdelingList, setAfdelingList] = useState<AfdelingOption[]>([]);
  const [blokList, setBlokList] = useState<BlokOption[]>([]);

  // Mappings state per dataset
  const [mappings, setMappings] = useState<
    Array<{
      datasetIndex: number;
      nama_layer: string;
      kategori: string;
      kebun_id: number;
      afdeling_id: number | null;
      blok_id: number | null;
      fallback_crs: string;
    }>
  >([]);

  // Load master kebun, afdeling, blok
  useEffect(() => {
    if (!isOpen) return;

    let ignore = false;
    async function loadMaster() {
      try {
        const [kRes, aRes, bRes] = await Promise.all([
          fetch('/api/kebun'),
          fetch('/api/afdeling'),
          fetch('/api/blok'),
        ]);

        if (!ignore) {
          if (kRes.ok) {
            const kj = await kRes.json();
            setKebunList(kj.data || []);
          }
          if (aRes.ok) {
            const aj = await aRes.json();
            setAfdelingList(aj.data || []);
          }
          if (bRes.ok) {
            const bj = await bRes.json();
            setBlokList(bj.data || []);
          }
        }
      } catch (err) {
        console.error('Failed to load master hierarchy:', err);
      }
    }

    loadMaster();
    return () => {
      ignore = true;
    };
  }, [isOpen]);

  // Reset state when closed
  const handleClose = () => {
    setStep('select');
    setFiles([]);
    setIsDragging(false);
    setTempId(null);
    setDetectedDatasets([]);
    setMappings([]);
    setErrorMessage(null);
    setIsInspecting(false);
    setIsImporting(false);
    onClose();
  };

  const handleFilesChosen = (incoming: File[]) => {
    if (!incoming || incoming.length === 0) return;
    setFiles(incoming);
    setErrorMessage(null);
  };

  // Analisis kumpulan file yang dipilih
  const fileSummary = React.useMemo(() => {
    if (files.length === 0) return null;

    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
      return {
        type: 'zip' as const,
        primaryName: files[0].name,
        totalSize: files[0].size,
        fileCount: 1,
      };
    }

    if (
      files.length === 1 &&
      (files[0].name.toLowerCase().endsWith('.geojson') ||
        files[0].name.toLowerCase().endsWith('.json'))
    ) {
      return {
        type: 'geojson' as const,
        primaryName: files[0].name,
        totalSize: files[0].size,
        fileCount: 1,
      };
    }

    // Kumpulan file terpisah (.shp, .dbf, .shx, .prj, dll.)
    const shpFiles = files.filter((f) => f.name.toLowerCase().endsWith('.shp'));
    const dbfFiles = files.filter((f) => f.name.toLowerCase().endsWith('.dbf'));
    const prjFiles = files.filter((f) => f.name.toLowerCase().endsWith('.prj'));
    const shxFiles = files.filter((f) => f.name.toLowerCase().endsWith('.shx'));
    const otherFiles = files.filter(
      (f) =>
        !f.name.toLowerCase().endsWith('.shp') &&
        !f.name.toLowerCase().endsWith('.dbf') &&
        !f.name.toLowerCase().endsWith('.prj') &&
        !f.name.toLowerCase().endsWith('.shx')
    );

    const primaryName =
      shpFiles.length > 0
        ? shpFiles[0].name.replace(/\.shp$/i, '')
        : files[0].name.replace(/\.[^/.]+$/, '');

    const totalSize = files.reduce((acc, f) => acc + f.size, 0);

    return {
      type: 'loose_shapefile' as const,
      primaryName,
      totalSize,
      fileCount: files.length,
      shpCount: shpFiles.length,
      dbfCount: dbfFiles.length,
      prjCount: prjFiles.length,
      shxCount: shxFiles.length,
      otherCount: otherFiles.length,
      hasShp: shpFiles.length > 0,
      fileList: files.map((f) => f.name),
    };
  }, [files]);

  if (!isOpen) return null;

  // STEP 1: Kirim file ke backend untuk diperiksa
  const handleInspectFile = async () => {
    if (files.length === 0) {
      setErrorMessage('Pilih file GIS (.zip, .geojson, atau kumpulan file .shp, .dbf, .prj) terlebih dahulu.');
      return;
    }

    if (fileSummary?.type === 'loose_shapefile' && !fileSummary.hasShp) {
      setErrorMessage(
        'File geometri utama (.shp) tidak ditemukan dalam daftar file yang dipilih. Harap sertakan file .shp.'
      );
      return;
    }

    setIsInspecting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      for (const f of files) {
        formData.append('files', f);
      }
      if (files.length === 1) {
        formData.append('file', files[0]);
      }
      if (fallbackCrs) {
        formData.append('fallback_crs', fallbackCrs);
      }

      const res = await fetch('/api/gis/inspect', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Gagal memeriksa isi file GIS.');
      }

      setTempId(json.tempId);
      setFileName(json.fileName);
      setDetectedDatasets(json.datasets || []);

      // Siapkan default mapping untuk setiap dataset
      const defaultKebunId = kebunList.length > 0 ? kebunList[0].id : 0;
      const initialMappings = (json.datasets as DetectedDataset[]).map((ds, idx) => {
        let cat = 'Lainnya';
        const lowerName = ds.name.toLowerCase();
        if (lowerName.includes('kebun')) cat = 'Batas Kebun';
        else if (lowerName.includes('afd')) cat = 'Batas Afdeling';
        else if (lowerName.includes('blok')) cat = 'Batas Blok';
        else if (lowerName.includes('jalan') || lowerName.includes('road')) cat = 'Jalan Kebun';
        else if (lowerName.includes('sungai') || lowerName.includes('river')) cat = 'Sungai';

        return {
          datasetIndex: idx,
          nama_layer: ds.name,
          kategori: cat,
          kebun_id: defaultKebunId,
          afdeling_id: null,
          blok_id: null,
          fallback_crs: ds.crsAsal || fallbackCrs || 'EPSG:4326',
        };
      });

      setMappings(initialMappings);
      setStep('mapping');
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'Terjadi kesalahan saat memeriksa file.');
    } finally {
      setIsInspecting(false);
    }
  };

  // Update specific mapping for a dataset
  const updateMapping = (
    index: number,
    field: 'nama_layer' | 'kategori' | 'kebun_id' | 'afdeling_id' | 'blok_id' | 'fallback_crs',
    value: unknown
  ) => {
    setMappings((prev) =>
      prev.map((m) => {
        if (m.datasetIndex !== index) return m;

        if (field === 'kebun_id') {
          // Reset afdeling dan blok jika kebun berubah
          return {
            ...m,
            kebun_id: Number(value),
            afdeling_id: null,
            blok_id: null,
          };
        }

        if (field === 'afdeling_id') {
          // Reset blok jika afdeling berubah
          return {
            ...m,
            afdeling_id: value ? Number(value) : null,
            blok_id: null,
          };
        }

        return { ...m, [field]: value };
      })
    );
  };

  // STEP 2: Konfirmasi dan Import ke PostgreSQL/PostGIS
  const handleConfirmImport = async () => {
    if (!tempId) return;

    // Validasi mapping
    for (const m of mappings) {
      if (!m.kebun_id || m.kebun_id <= 0) {
        setErrorMessage(`Harap tentukan Kebun tujuan untuk layer "${m.nama_layer}".`);
        return;
      }
      if (!m.nama_layer.trim()) {
        setErrorMessage('Nama layer tidak boleh kosong.');
        return;
      }
    }

    setIsImporting(true);
    setErrorMessage(null);

    try {
      const payload = {
        tempId,
        nama_data: fileName.replace(/\.[^/.]+$/, ''),
        keterangan: 'Diimpor melalui NusaGIS Monitoring Dashboard',
        mappings: mappings.map((m) => ({
          datasetIndex: m.datasetIndex,
          nama_layer: m.nama_layer,
          kategori: m.kategori,
          kebun_id: m.kebun_id,
          afdeling_id: m.afdeling_id,
          blok_id: m.blok_id,
          fallback_crs: m.fallback_crs,
        })),
      };

      const res = await fetch('/api/gis/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.detail || json.message || 'Gagal mengimpor layer ke PostGIS.');
      }

      const createdLayers: LayerPeta[] = json.data?.layers || [];
      const overallBbox: [number, number, number, number] | null =
        json.data?.overall_bbox || null;

      onUploadSuccess(createdLayers, overallBbox);
      handleClose();
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'Terjadi kesalahan saat menyimpan ke PostGIS.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-[#0D1322] border border-[#1E2942] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-[#F0F6FC] animate-in fade-in zoom-in-95 duration-150">
        {/* Header Modal */}
        <div className="h-12 px-5 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0E3A5D] border border-[#00B4D8]/50 flex items-center justify-center text-[#00D2FF]">
              <IconAddData className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider">
                Import Data GIS ke PostGIS
              </h3>
              <p className="text-[10px] text-[#8B9BB4]">
                Mendukung ZIP multi-Shapefile (.shp, .shx, .dbf, .prj) dan GeoJSON (.geojson/.json)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#F0F6FC] transition-colors cursor-pointer"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-5 mt-4 p-3 bg-rose-950/80 border border-rose-800/80 rounded-lg text-rose-300 text-xs flex items-start gap-2">
            <span className="font-bold text-rose-400 shrink-0">⚠ Kesalahan:</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 'select' ? (
            <div className="space-y-4">
              {/* Dropzone Multi-Format */}
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer group ${
                  isDragging
                    ? 'border-emerald-400 bg-emerald-950/40 ring-2 ring-emerald-500/20'
                    : files.length > 0
                    ? 'border-emerald-600/80 bg-slate-950/80'
                    : 'border-slate-700 hover:border-emerald-500 bg-slate-950/60'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFilesChosen(Array.from(e.dataTransfer.files));
                  }
                }}
                onClick={() => document.getElementById('gis-file-input')?.click()}
              >
                <input
                  id="gis-file-input"
                  type="file"
                  multiple
                  accept=".zip,.shp,.dbf,.shx,.prj,.cpg,.sbn,.sbx,.xml,.geojson,.json,.tif,.tiff"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFilesChosen(Array.from(e.target.files));
                    }
                  }}
                />
                <div className="w-12 h-12 mx-auto rounded-full bg-slate-800/80 group-hover:bg-emerald-950/80 border border-slate-700 group-hover:border-emerald-600 flex items-center justify-center text-slate-400 group-hover:text-emerald-400 transition-colors mb-2.5">
                  <IconLayers className="w-6 h-6" />
                </div>

                {files.length === 0 ? (
                  <div>
                    <div className="text-xs font-semibold text-slate-200 mb-1">
                      Klik untuk memilih file GIS atau seret seluruh file ke sini
                    </div>
                    <div className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
                      Mendukung <strong>kumpulan file Shapefile</strong> (<code className="text-emerald-400 font-mono">.shp</code>, <code className="text-emerald-400 font-mono">.dbf</code>, <code className="text-emerald-400 font-mono">.prj</code>, <code className="text-emerald-400 font-mono">.shx</code>), <strong>ZIP Shapefile</strong>, <strong>GeoJSON</strong>, atau <strong>Citra GeoTIFF/COG Raster</strong> (<code className="text-amber-400 font-mono">.tif/.tiff</code>)
                    </div>
                  </div>
                ) : fileSummary?.type === 'loose_shapefile' ? (
                  <div className="space-y-2.5 text-left max-w-xl mx-auto bg-slate-900/90 border border-slate-800 rounded-lg p-3.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs font-bold text-slate-100">
                          {fileSummary.primaryName}
                        </span>
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                          {fileSummary.fileCount} file ({(fileSummary.totalSize / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-semibold">
                        {fileSummary.hasShp ? '✓ Siap Diperiksa' : '⚠ Perlu .shp'}
                      </span>
                    </div>

                    {/* Chips komponen Shapefile yang terdeteksi */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 ${
                          fileSummary.shpCount > 0
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {fileSummary.shpCount > 0 ? '✓' : '✗'} .shp ({fileSummary.shpCount})
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 ${
                          fileSummary.dbfCount > 0
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}
                      >
                        {fileSummary.dbfCount > 0 ? '✓' : '−'} .dbf ({fileSummary.dbfCount})
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 ${
                          fileSummary.prjCount > 0
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {fileSummary.prjCount > 0 ? '✓' : '−'} .prj ({fileSummary.prjCount})
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 ${
                          fileSummary.shxCount > 0
                            ? 'bg-sky-950 text-sky-300 border border-sky-800'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {fileSummary.shxCount > 0 ? '✓' : '−'} .shx ({fileSummary.shxCount})
                      </span>
                      {fileSummary.otherCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300 border border-slate-700">
                          +{fileSummary.otherCount} file pendukung (.cpg, .sbn, .sbx, .xml)
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400 pt-1 flex items-center justify-between">
                      <span>Klik di sini untuk mengganti atau menambahkan file lainnya</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFiles([]);
                        }}
                        className="text-rose-400 hover:text-rose-300 text-[10px] font-semibold underline"
                      >
                        Hapus Pilihan
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 text-center">
                    <div className="text-xs font-bold text-emerald-300">
                      {files[0].name}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Ukuran: {(files[0].size / 1024 / 1024).toFixed(2)} MB · Format:{' '}
                      {files[0].name.toLowerCase().endsWith('.tif') || files[0].name.toLowerCase().endsWith('.tiff')
                        ? 'Citra Raster GeoTIFF'
                        : files[0].name.toLowerCase().endsWith('.zip')
                        ? 'Arsip ZIP Shapefile'
                        : 'GeoJSON'}
                    </div>
                    <div className="text-[10px] text-slate-500 pt-1">
                      Klik untuk mengganti file
                    </div>
                  </div>
                )}
              </div>

              {/* Opsi Fallback CRS jika file .prj tidak disertakan */}
              <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                  <span>Sistem Koordinat Asal (CRS Fallback jika file .prj tidak ada):</span>
                  <span className="text-[10px] text-slate-500 font-mono">WGS84 / UTM</span>
                </label>
                <select
                  value={fallbackCrs}
                  onChange={(e) => setFallbackCrs(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  {Object.entries(KNOWN_CRS_WKT).map(([key, val]) => (
                    <option key={key} value={key} className="bg-slate-900">
                      {val.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400">
                  Jika file .prj tersedia dalam kumpulan file, sistem akan membaca proyeksi secara otomatis.
                </p>
              </div>
            </div>
          ) : (
            /* STEP 2: Preview & Data Mapping */
            <div className="space-y-4">
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-lg flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-400">File: </span>
                  <span className="font-semibold text-emerald-300">{fileName}</span>
                  <span className="text-slate-500 ml-2">
                    ({detectedDatasets.length} dataset spasial terdeteksi)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                >
                  Ganti File
                </button>
              </div>

              {/* Data Mapping Table */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Mapping Tujuan Penyimpanan per Layer:
                </h4>

                <div className="space-y-3">
                  {detectedDatasets.map((ds, idx) => {
                    const currentMapping = mappings.find((m) => m.datasetIndex === idx) || mappings[idx];
                    const filteredAfdeling = afdelingList.filter(
                      (a) => a.kebun_id === currentMapping?.kebun_id
                    );
                    const filteredBlok = blokList.filter(
                      (b) => b.afdeling_id === currentMapping?.afdeling_id
                    );

                    return (
                      <div
                        key={ds.index}
                        className="p-3.5 bg-slate-950/90 border border-slate-800 rounded-lg space-y-3"
                      >
                        {/* Dataset Info Header */}
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                              #{idx + 1}
                            </span>
                            <span className="font-semibold text-xs text-slate-200">
                              {ds.sourceFileName}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-950 border border-emerald-700 text-emerald-300">
                              {ds.geometryType}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({ds.featureCount} fitur)
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            CRS: {ds.crsAsal || 'Belum terdeteksi'}
                          </span>
                        </div>

                        {/* Mapping Inputs */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
                          {/* Nama Layer */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Nama Layer:
                            </label>
                            <input
                              type="text"
                              value={currentMapping?.nama_layer || ''}
                              onChange={(e) => updateMapping(idx, 'nama_layer', e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                            />
                          </div>

                          {/* Kategori */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Kategori:
                            </label>
                            <select
                              value={currentMapping?.kategori || 'Lainnya'}
                              onChange={(e) => updateMapping(idx, 'kategori', e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                            >
                              {LAYER_CATEGORIES.map((c) => (
                                <option key={c} value={c} className="bg-slate-900">
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Tujuan Kebun */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Kebun: <span className="text-emerald-400">*</span>
                            </label>
                            <select
                              value={currentMapping?.kebun_id || ''}
                              onChange={(e) => updateMapping(idx, 'kebun_id', Number(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                            >
                              <option value="" disabled>
                                Pilih Kebun
                              </option>
                              {kebunList.map((k) => (
                                <option key={k.id} value={k.id} className="bg-slate-900">
                                  {k.kode_kebun} — {k.nama_kebun}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Tujuan Afdeling (Opsional) */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Afdeling (Opsional):
                            </label>
                            <select
                              value={currentMapping?.afdeling_id || ''}
                              onChange={(e) =>
                                updateMapping(
                                  idx,
                                  'afdeling_id',
                                  e.target.value ? Number(e.target.value) : null
                                )
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                            >
                              <option value="">Semua Afdeling</option>
                              {filteredAfdeling.map((a) => (
                                <option key={a.id} value={a.id} className="bg-slate-900">
                                  {a.kode_afdeling} — {a.nama_afdeling}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Tujuan Blok (Opsional) */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Blok (Opsional):
                            </label>
                            <select
                              value={currentMapping?.blok_id || ''}
                              onChange={(e) =>
                                updateMapping(
                                  idx,
                                  'blok_id',
                                  e.target.value ? Number(e.target.value) : null
                                )
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-40"
                              disabled={!currentMapping?.afdeling_id}
                            >
                              <option value="">Semua Blok</option>
                              {filteredBlok.map((b) => (
                                <option key={b.id} value={b.id} className="bg-slate-900">
                                  {b.kode_blok} — {b.nama_blok}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Atribut Pratinjau */}
                        {ds.attributes.length > 0 && (
                          <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/60">
                            <IconTable className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span className="font-medium text-slate-300">Atribut DBF/JSON:</span>
                            <span>{ds.attributes.slice(0, 8).join(', ')}</span>
                            {ds.attributes.length > 8 && (
                              <span className="text-slate-500">
                                (+{ds.attributes.length - 8} lainnya)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="h-14 px-5 bg-[#0D1322] border-t border-[#1E2942] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-1.5 rounded-lg border border-[#1E2942] bg-[#12192B] hover:bg-[#19233A] text-xs text-[#8B9BB4] hover:text-[#F0F6FC] transition-colors cursor-pointer"
          >
            Batal
          </button>

          {step === 'select' ? (
            <button
              type="button"
              onClick={handleInspectFile}
              disabled={files.length === 0 || isInspecting}
              className="px-4 py-1.5 rounded-lg bg-[#00D2FF] hover:bg-[#38BDF8] disabled:opacity-50 text-xs font-bold text-[#0A0E1A] shadow-lg shadow-[#00D2FF]/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isInspecting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-[#0A0E1A]/30 border-t-[#0A0E1A] rounded-full animate-spin" />
                  <span>Memeriksa Spasial...</span>
                </>
              ) : (
                <>
                  <IconAddData className="w-3.5 h-3.5" />
                  <span>Periksa &amp; Deteksi Layer</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={isImporting}
              className="px-4 py-1.5 rounded-lg bg-[#00D2FF] hover:bg-[#38BDF8] disabled:opacity-50 text-xs font-bold text-[#0A0E1A] shadow-lg shadow-[#00D2FF]/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isImporting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-[#0A0E1A]/30 border-t-[#0A0E1A] rounded-full animate-spin" />
                  <span>Menyimpan ke PostGIS...</span>
                </>
              ) : (
                <>
                  <IconAddData className="w-3.5 h-3.5" />
                  <span>Konfirmasi &amp; Import ke PostGIS</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
