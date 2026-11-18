'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  IconClose,
  IconAddData,
  IconLayers,
  IconFolder,
} from '../GisIcons';
import { KNOWN_CRS_WKT } from '@/lib/gis/crs';
import type { DetectedDataset, LayerPeta, LayerMappingInput } from '@/types/gis';

interface KebunOption {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  wilayah?: string | null;
  perusahaan?: string | null;
}

interface AfdelingOption {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
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

interface FileSystemFileEntryCustom {
  isFile: true;
  isDirectory: false;
  name: string;
  fullPath?: string;
  file: (successCallback: (file: File) => void, errorCallback?: (error: unknown) => void) => void;
}

interface FileSystemDirectoryEntryCustom {
  isFile: false;
  isDirectory: true;
  name: string;
  fullPath?: string;
  createReader: () => {
    readEntries: (
      successCallback: (entries: (FileSystemFileEntryCustom | FileSystemDirectoryEntryCustom)[]) => void,
      errorCallback?: (error: unknown) => void
    ) => void;
  };
}

type FileSystemEntryCustom = FileSystemFileEntryCustom | FileSystemDirectoryEntryCustom;

async function readEntryRecursively(entry: FileSystemEntryCustom): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (f: File) => {
          if (!f.webkitRelativePath && entry.fullPath) {
            try {
              Object.defineProperty(f, 'webkitRelativePath', {
                value: entry.fullPath.replace(/^\/+/, ''),
                writable: false,
                configurable: true,
              });
            } catch {
              // fallback ignore
            }
          }
          resolve([f]);
        },
        () => resolve([])
      );
    });
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    const readBatch = (): Promise<FileSystemEntryCustom[]> => {
      return new Promise((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries || []),
          () => resolve([])
        );
      });
    };

    const all: File[] = [];
    let batch = await readBatch();
    while (batch.length > 0) {
      for (const child of batch) {
        const childFiles = await readEntryRecursively(child);
        all.push(...childFiles);
      }
      batch = await readBatch();
    }
    return all;
  }

  return [];
}

export function GisUploadModal({
  isOpen,
  onClose,
  onUploadSuccess,
}: GisUploadModalProps) {
  const [step, setStep] = useState<'select' | 'mapping' | 'importing'>('select');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fallbackCrs, setFallbackCrs] = useState<string>('EPSG:4326');
  const [showManualCrs, setShowManualCrs] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inspection results
  const [tempId, setTempId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [detectedDatasets, setDetectedDatasets] = useState<DetectedDataset[]>([]);

  // Metadata kebun & afdeling dari database
  const [kebunList, setKebunList] = useState<KebunOption[]>([]);
  const [afdelingList, setAfdelingList] = useState<AfdelingOption[]>([]);

  // State Target Geodatabase Induk (ArcGIS Pro Best Practice: Set 1 Kali untuk Seluruh Folder)
  const [targetMode, setTargetMode] = useState<'existing' | 'new'>('existing');
  const [selectedKebunId, setSelectedKebunId] = useState<number>(0);
  const [newKebunNama, setNewKebunNama] = useState<string>('');
  const [newKebunWilayah, setNewKebunWilayah] = useState<string>('');
  const [newKebunPerusahaan, setNewKebunPerusahaan] = useState<string>(
    'PT Perkebunan Nusantara I (Regional 4)'
  );
  const [isNewPerusahaan, setIsNewPerusahaan] = useState<boolean>(false);

  // Daftar unik perusahaan yang sudah ada di DB + standar PTPN/P3GI (bisa dipilih atau ketik baru)
  const availablePerusahaan = useMemo(() => {
    const map = new Map<string, string>();
    const defaults = [
      'PT Perkebunan Nusantara I (Regional 4)',
      'Pusat Penelitian Perkebunan Gula Indonesia (P3GI)',
    ];
    for (const k of kebunList) {
      const p = k.perusahaan?.trim();
      if (p && !map.has(p.toLowerCase())) {
        map.set(p.toLowerCase(), p);
      }
    }
    for (const d of defaults) {
      if (!map.has(d.toLowerCase())) {
        map.set(d.toLowerCase(), d);
      }
    }
    return Array.from(map.values());
  }, [kebunList]);

  // Mappings state per dataset
  const [mappings, setMappings] = useState<LayerMappingInput[]>([]);

  // Load master kebun & afdeling
  useEffect(() => {
    if (!isOpen) return;

    let ignore = false;
    async function loadMaster() {
      try {
        const [kRes, aRes] = await Promise.all([
          fetch('/api/kebun'),
          fetch('/api/afdeling'),
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
    setTargetMode('existing');
    setSelectedKebunId(0);
    setNewKebunNama('');
    setNewKebunWilayah('');
    setNewKebunPerusahaan('PT Perkebunan Nusantara I (Regional 4)');
    setIsNewPerusahaan(false);
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

    // Kumpulan file terpisah (.shp, .dbf, .shx, .prj, dll.) atau folder
    const isFromFolder = files.some(
      (f) => Boolean(f.webkitRelativePath && f.webkitRelativePath.includes('/'))
    );
    const folderName = isFromFolder
      ? files.find((f) => f.webkitRelativePath)?.webkitRelativePath.split('/')[0] || 'Folder Terpilih'
      : null;

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
      folderName ||
      (shpFiles.length > 0
        ? shpFiles[0].name.replace(/\.shp$/i, '')
        : files[0].name.replace(/\.[^/.]+$/, ''));

    const totalSize = files.reduce((acc, f) => acc + f.size, 0);

    return {
      type: 'loose_shapefile' as const,
      isFromFolder,
      folderName,
      primaryName,
      totalSize,
      fileCount: files.length,
      shpCount: shpFiles.length,
      dbfCount: dbfFiles.length,
      prjCount: prjFiles.length,
      shxCount: shxFiles.length,
      otherCount: otherFiles.length,
      hasShp: shpFiles.length > 0,
      shpList: shpFiles.map((s) => s.name),
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
        const rel = f.webkitRelativePath || f.name;
        formData.append('files', f, rel);
      }
      if (files.length === 1) {
        const rel = files[0].webkitRelativePath || files[0].name;
        formData.append('file', files[0], rel);
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

      // Inisialisasi Target Kebun Global dari dataset pertama / deteksi folder
      const firstDs = (json.datasets as DetectedDataset[])[0];
      const defaultKebunId = kebunList.length > 0 ? kebunList[0].id : 0;
      let initialTargetMode: 'existing' | 'new' = 'existing';
      let initialKebunId = defaultKebunId;
      let initialNama = '';
      let initialWilayah = '';
      let initialPerusahaan =
        (kebunList[0]?.perusahaan?.trim()) || 'PT Perkebunan Nusantara I (Regional 4)';

      if (firstDs?.suggestedKebunName) {
        const lowerSug = firstDs.suggestedKebunName.toLowerCase();
        const found = kebunList.find(
          (k) =>
            k.nama_kebun.toLowerCase().includes(lowerSug) ||
            lowerSug.includes(k.nama_kebun.toLowerCase())
        );
        if (found) {
          initialTargetMode = 'existing';
          initialKebunId = found.id;
          initialNama = found.nama_kebun;
          initialWilayah = found.wilayah || firstDs.suggestedWilayah || '';
          initialPerusahaan =
            found.perusahaan?.trim() || 'PT Perkebunan Nusantara I (Regional 4)';
        } else {
          initialTargetMode = 'new';
          initialKebunId = 0;
          initialNama = firstDs.suggestedKebunName;
          initialWilayah = firstDs.suggestedWilayah || 'Wilayah Operasional';
        }
      } else {
        initialTargetMode = kebunList.length > 0 ? 'existing' : 'new';
        initialNama = 'Kebun Baru';
        initialWilayah = firstDs?.suggestedWilayah || 'Wilayah Operasional';
      }

      setTargetMode(initialTargetMode);
      setSelectedKebunId(initialKebunId);
      setNewKebunNama(initialNama);
      setNewKebunWilayah(initialWilayah);
      setNewKebunPerusahaan(initialPerusahaan);
      setIsNewPerusahaan(false);

      // Siapkan default mapping untuk setiap dataset
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
          selected: true,
          nama_layer: ds.name,
          kategori: cat,
          kebun_id: initialKebunId,
          is_new_kebun: initialTargetMode === 'new',
          new_kebun_nama: initialNama,
          new_kebun_wilayah: initialWilayah,
          new_kebun_perusahaan: initialPerusahaan,
          afdeling_id: null,
          new_afdeling_nama: ds.suggestedAfdelingName || null,
          blok_id: null,
          fallback_crs: ds.isPrjMissing
            ? fallbackCrs || 'EPSG:32749'
            : ds.crsAsal || fallbackCrs || 'EPSG:4326',
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
    field:
      | 'selected'
      | 'nama_layer'
      | 'kategori'
      | 'afdeling_id'
      | 'new_afdeling_nama'
      | 'blok_id'
      | 'fallback_crs',
    value: unknown
  ) => {
    setMappings((prev) =>
      prev.map((m) => {
        if (m.datasetIndex !== index) return m;

        if (field === 'afdeling_id') {
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

  const toggleAllSelection = (select: boolean) => {
    setMappings((prev) => prev.map((m) => ({ ...m, selected: select })));
  };

  // STEP 2: Konfirmasi dan Import ke PostgreSQL/PostGIS (Standar ArcGIS Pro)
  const handleConfirmImport = async () => {
    if (!tempId) return;

    // 1. Validasi seleksi minimal 1 layer
    const activeMappings = mappings.filter((m) => m.selected !== false);
    if (activeMappings.length === 0) {
      setErrorMessage('Harap centang minimal 1 layer spasial untuk diimpor.');
      return;
    }

    // 2. Validasi Target Kebun, Wilayah & Perusahaan
    if (targetMode === 'existing') {
      if (!selectedKebunId || selectedKebunId <= 0) {
        setErrorMessage('Pilih Unit Kebun tujuan untuk menyimpan layer.');
        return;
      }
    } else {
      if (!newKebunNama.trim()) {
        setErrorMessage('Nama Unit Kebun baru wajib diisi.');
        return;
      }
      if (!newKebunWilayah.trim()) {
        setErrorMessage('Wilayah administratif kebun baru wajib diisi.');
        return;
      }
    }
    if (isNewPerusahaan && !newKebunPerusahaan.trim()) {
      setErrorMessage('Ketik nama perusahaan baru, atau klik "← Pilih Daftar" untuk memilih perusahaan yang sudah ada.');
      return;
    }

    // 3. Validasi nama layer aktif
    for (const m of activeMappings) {
      if (!m.nama_layer.trim()) {
        setErrorMessage('Nama layer pada daftar tidak boleh kosong.');
        return;
      }
    }

    setIsImporting(true);
    setErrorMessage(null);

    try {
      const payload = {
        tempId,
        nama_data: fileName.replace(/\.[^/.]+$/, ''),
        keterangan: 'Diimpor melalui GIS Monitoring Dashboard (Standar ArcGIS Pro)',
        target_kebun: {
          is_new_kebun: targetMode === 'new',
          kebun_id: targetMode === 'existing' ? selectedKebunId : null,
          new_kebun_nama: newKebunNama.trim(),
          new_kebun_wilayah: newKebunWilayah.trim() || 'Wilayah Belum Ditentukan',
          new_kebun_perusahaan: newKebunPerusahaan.trim() || 'PT Perkebunan Nusantara I (Regional 4)',
        },
        mappings: mappings.map((m) => ({
          datasetIndex: m.datasetIndex,
          selected: m.selected !== false,
          nama_layer: m.nama_layer,
          kategori: m.kategori,
          kebun_id: targetMode === 'existing' ? selectedKebunId : 0,
          is_new_kebun: targetMode === 'new',
          new_kebun_nama: newKebunNama.trim(),
          new_kebun_wilayah: newKebunWilayah.trim(),
          new_kebun_perusahaan: newKebunPerusahaan.trim(),
          afdeling_id: m.afdeling_id,
          new_afdeling_nama: m.new_afdeling_nama,
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
      <div
        className={`w-full ${
          step === 'mapping' ? 'max-w-5xl' : 'max-w-3xl'
        } bg-[#0D1322] border border-[#1E2942] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-[#F0F6FC] transition-all duration-200 animate-in fade-in zoom-in-95`}
      >
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
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all group ${
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
                onDrop={async (e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const items = e.dataTransfer.items;
                  if (items && items.length > 0) {
                    try {
                      const promises: Promise<File[]>[] = [];
                      for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        if (typeof (item as unknown as { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry === 'function') {
                          const entry = (item as unknown as { webkitGetAsEntry: () => FileSystemEntryCustom }).webkitGetAsEntry();
                          if (entry) {
                            promises.push(readEntryRecursively(entry));
                          }
                        } else {
                          const f = item.getAsFile();
                          if (f) promises.push(Promise.resolve([f]));
                        }
                      }
                      const results = await Promise.all(promises);
                      const flattened = results.flat().filter(Boolean);
                      if (flattened.length > 0) {
                        handleFilesChosen(flattened);
                        return;
                      }
                    } catch (err) {
                      console.warn('Error reading dropped folder:', err);
                    }
                  }
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFilesChosen(Array.from(e.dataTransfer.files));
                  }
                }}
              >
                {/* Hidden File Input (Single/Multiple Files) */}
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

                {/* Hidden Folder Input (Entire Directory with Subfolders) */}
                <input
                  id="gis-folder-input"
                  type="file"
                  multiple
                  {...({ webkitdirectory: '', directory: '' } as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFilesChosen(Array.from(e.target.files));
                    }
                  }}
                />

                {files.length === 0 ? (
                  <div className="space-y-3">
                    <div className="w-12 h-12 mx-auto rounded-full bg-slate-800/80 group-hover:bg-emerald-950/80 border border-slate-700 group-hover:border-emerald-600 flex items-center justify-center text-slate-400 group-hover:text-emerald-400 transition-colors">
                      <IconLayers className="w-6 h-6" />
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-slate-100 mb-1">
                        Pilih Satu Folder Penuh atau Seret Folder/File ke Sini
                      </div>
                      <div className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
                        Anda tidak perlu masuk ke dalam subfolder satu per satu. Cukup klik tombol <strong>Pilih Satu Folder Penuh</strong> di bawah, sistem otomatis memindai seluruh subfolder dan mendeteksi file Shapefile (.shp, .dbf, .prj).
                      </div>
                    </div>

                    {/* Dua Tombol Pilihan Utama */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById('gis-folder-input')?.click();
                        }}
                        className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500/20 to-amber-600/30 hover:from-amber-500/30 hover:to-amber-600/40 border border-amber-500/60 text-amber-300 hover:text-amber-200 text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 transition-all cursor-pointer group"
                      >
                        <IconFolder className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                        <span>Pilih Satu Folder Penuh</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 font-normal">
                          Auto-Scan Subfolder
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById('gis-file-input')?.click();
                        }}
                        className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                      >
                        <IconAddData className="w-4 h-4 text-emerald-400" />
                        <span>Pilih Berkas File (.zip / .shp)</span>
                      </button>
                    </div>
                  </div>
                ) : fileSummary?.type === 'loose_shapefile' ? (
                  <div className="space-y-2.5 text-left max-w-xl mx-auto bg-slate-900/90 border border-slate-800 rounded-lg p-3.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        {fileSummary.isFromFolder ? (
                          <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                            <IconFolder className="w-4 h-4" />
                          </div>
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                        <div>
                          <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
                            <span>{fileSummary.isFromFolder ? `Folder: ${fileSummary.folderName}` : fileSummary.primaryName}</span>
                            {fileSummary.isFromFolder && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                                Subfolder Mode
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {fileSummary.fileCount} file terkumpul ({(fileSummary.totalSize / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-emerald-400 font-semibold block">
                          {fileSummary.hasShp ? '✓ Siap Diperiksa' : '⚠ Perlu .shp'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFiles([]);
                          }}
                          className="text-[10px] text-slate-400 hover:text-rose-400 underline cursor-pointer"
                        >
                          Ganti Folder / File
                        </button>
                      </div>
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
                        {fileSummary.shpCount > 0 ? '✓' : '✗'} .shp ({fileSummary.shpCount} layer)
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
                    </div>

                    {fileSummary.shpList && fileSummary.shpList.length > 0 && (
                      <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800 flex items-center gap-1.5">
                        <span className="text-slate-500 font-medium">Layer ditemukan:</span>
                        <span className="text-slate-300 font-mono truncate">
                          {fileSummary.shpList.slice(0, 3).join(', ')}
                          {fileSummary.shpList.length > 3 && ` +${fileSummary.shpList.length - 3} lainnya`}
                        </span>
                      </div>
                    )}
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

              {/* Smart Auto-Detect CRS Banner & Opsi Manual Lanjutan (Zero-Config untuk Karyawan) */}
              <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs">
                      ✓
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                        <span>Sistem Koordinat Otomatis (Smart Auto-Detect)</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                          AKTIF
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 leading-relaxed">
                        Sistem otomatis membaca berkas proyeksi (.prj) atau mendeteksi rentang koordinat (WGS84 / UTM). Bebas risiko salah pilih bagi karyawan pemula.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowManualCrs((prev) => !prev)}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer shrink-0 ml-2"
                  >
                    {showManualCrs ? 'Tutup Opsi Manual' : 'Opsi Lanjutan'}
                  </button>
                </div>

                {showManualCrs && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                      <span>Ubah Manual CRS Fallback (Khusus Ahli GIS):</span>
                      <span className="text-[10px] text-slate-500 font-mono">WGS84 / UTM</span>
                    </label>
                    <select
                      value={fallbackCrs}
                      onChange={(e) => setFallbackCrs(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                    >
                      {Object.entries(KNOWN_CRS_WKT).map(([key, val]) => (
                        <option key={key} value={key} className="bg-slate-900">
                          {val.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* STEP 2: Preview & Data Mapping Standar ArcGIS Pro */
            <div className="space-y-4">
              {/* Header Info File */}
              <div className="p-3 bg-[#0A1A2F]/80 border border-[#00B4D8]/30 rounded-lg flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-2 h-2 rounded-full bg-[#00D2FF] animate-pulse" />
                  <span className="text-[#8B9BB4]">Sumber File / Folder:</span>
                  <span className="font-bold text-[#00D2FF]">{fileName}</span>
                  <span className="text-slate-400 font-mono text-[11px]">
                    ({detectedDatasets.length} dataset spasial ditemukan)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  className="text-[11px] text-[#00D2FF] hover:underline cursor-pointer shrink-0"
                >
                  ← Ganti File / Folder
                </button>
              </div>

              {/* 1. BLOK TARGET INDUK DATASET (Set 1 Kali untuk Seluruh Folder) */}
              <div className="p-4 bg-[#12192B]/90 border border-[#1E2942] rounded-xl space-y-3 shadow-md">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1E2942] pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-[#00D2FF]/10 border border-[#00D2FF]/30 flex items-center justify-center text-[#00D2FF] text-xs">
                      📍
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider flex items-center gap-2">
                        <span>Target Lokasi Dataset (Geodatabase Workspace)</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-normal">
                          Standar ArcGIS
                        </span>
                      </h4>
                      <p className="text-[10px] text-[#8B9BB4]">
                        Ditetapkan 1 kali untuk mengelompokkan seluruh layer dari folder ini
                      </p>
                    </div>
                  </div>

                  {/* Tab Switcher: Buat Kebun Baru vs Pilih Kebun Ada */}
                  <div className="flex items-center bg-[#0D1322] p-0.5 rounded-lg border border-[#1E2942] shrink-0">
                    <button
                      type="button"
                      onClick={() => setTargetMode('new')}
                      className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                        targetMode === 'new'
                          ? 'bg-[#00D2FF] text-[#0A0E1A] shadow-xs'
                          : 'text-[#8B9BB4] hover:text-[#F0F6FC]'
                      }`}
                    >
                      + Buat Kebun Baru
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetMode('existing');
                        if (kebunList.length > 0 && (!selectedKebunId || selectedKebunId === 0)) {
                          const firstK = kebunList[0];
                          setSelectedKebunId(firstK.id);
                          if (!isNewPerusahaan) {
                            setNewKebunPerusahaan(
                              firstK.perusahaan?.trim() || 'PT Perkebunan Nusantara I (Regional 4)'
                            );
                          }
                        }
                      }}
                      className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                        targetMode === 'existing'
                          ? 'bg-[#00D2FF] text-[#0A0E1A] shadow-xs'
                          : 'text-[#8B9BB4] hover:text-[#F0F6FC]'
                      }`}
                    >
                      Pilih Kebun yang Ada
                    </button>
                  </div>
                </div>

                {/* Form Input Target Kebun & Perusahaan */}
                {(() => {
                  const renderPerusahaanField = () => (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-semibold text-[#8B9BB4]">
                          Perusahaan Induk <span className="text-rose-400">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            if (isNewPerusahaan) {
                              setIsNewPerusahaan(false);
                              if (!availablePerusahaan.includes(newKebunPerusahaan.trim())) {
                                setNewKebunPerusahaan(
                                  availablePerusahaan[0] ||
                                    'PT Perkebunan Nusantara I (Regional 4)'
                                );
                              }
                            } else {
                              setIsNewPerusahaan(true);
                              setNewKebunPerusahaan('');
                            }
                          }}
                          className="text-[10px] font-semibold text-[#00D2FF] hover:text-[#38BDF8] hover:underline cursor-pointer"
                        >
                          {isNewPerusahaan ? '← Pilih dari Daftar' : '+ Ketik Perusahaan Baru'}
                        </button>
                      </div>
                      {isNewPerusahaan ? (
                        <input
                          type="text"
                          placeholder="Ketik nama perusahaan baru (misal: PTPN I Regional 2)..."
                          value={newKebunPerusahaan}
                          onChange={(e) => setNewKebunPerusahaan(e.target.value)}
                          autoFocus
                          className="w-full bg-[#0D1322] border border-[#00D2FF]/60 focus:border-[#00D2FF] rounded-lg px-3 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
                        />
                      ) : (
                        <select
                          value={
                            availablePerusahaan.includes(newKebunPerusahaan)
                              ? newKebunPerusahaan
                              : availablePerusahaan[0] || ''
                          }
                          onChange={(e) => {
                            if (e.target.value === '__NEW__') {
                              setIsNewPerusahaan(true);
                              setNewKebunPerusahaan('');
                            } else {
                              setNewKebunPerusahaan(e.target.value);
                            }
                          }}
                          className="w-full bg-[#0D1322] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-3 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
                        >
                          {availablePerusahaan.map((p) => (
                            <option key={p} value={p} className="bg-[#0D1322]">
                              {p}
                            </option>
                          ))}
                          <option value="__NEW__" className="bg-[#0D1322] text-[#00D2FF] font-semibold">
                            + Ketik Perusahaan Baru...
                          </option>
                        </select>
                      )}
                    </div>
                  );

                  if (targetMode === 'new') {
                    return (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                        <div>
                          <label className="text-[11px] font-semibold text-[#8B9BB4] block mb-1 flex items-center justify-between">
                            <span>
                              Nama Unit Kebun Baru <span className="text-rose-400">*</span>
                            </span>
                            <span className="text-[9px] text-[#00D2FF]">Auto-Detected</span>
                          </label>
                          <input
                            type="text"
                            placeholder="misal: Kebun Sarongge"
                            value={newKebunNama}
                            onChange={(e) => setNewKebunNama(e.target.value)}
                            className="w-full bg-[#0D1322] border border-[#00D2FF]/50 focus:border-[#00D2FF] rounded-lg px-3 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-[#8B9BB4] block mb-1 flex items-center justify-between">
                            <span>
                              Wilayah Administratif <span className="text-rose-400">*</span>
                            </span>
                            <span className="text-[9px] text-emerald-400">Dari Koordinat GIS</span>
                          </label>
                          <input
                            type="text"
                            placeholder="misal: Kabupaten Cianjur, Jawa Barat"
                            value={newKebunWilayah}
                            onChange={(e) => setNewKebunWilayah(e.target.value)}
                            className="w-full bg-[#0D1322] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-3 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
                          />
                        </div>
                        {renderPerusahaanField()}
                      </div>
                    );
                  }

                  const curKebun = kebunList.find((k) => k.id === selectedKebunId);
                  const curPerusahaan = curKebun?.perusahaan?.trim() || '';
                  const isPerusahaanChanged =
                    Boolean(newKebunPerusahaan.trim()) &&
                    newKebunPerusahaan.trim().toLowerCase() !== curPerusahaan.toLowerCase();

                  return (
                    <div className="space-y-2.5 pt-1">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] font-semibold text-[#8B9BB4] block mb-1">
                            Pilih Unit Kebun Tujuan <span className="text-rose-400">*</span>
                          </label>
                          <select
                            value={selectedKebunId || ''}
                            onChange={(e) => {
                              const nextId = Number(e.target.value);
                              setSelectedKebunId(nextId);
                              const nextK = kebunList.find((k) => k.id === nextId);
                              if (nextK && !isNewPerusahaan) {
                                setNewKebunPerusahaan(
                                  nextK.perusahaan?.trim() ||
                                    'PT Perkebunan Nusantara I (Regional 4)'
                                );
                              }
                            }}
                            className="w-full bg-[#0D1322] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-3 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
                          >
                            <option value="" disabled>
                              Pilih Kebun yang Ada...
                            </option>
                            {kebunList.map((k) => (
                              <option key={k.id} value={k.id} className="bg-[#0D1322]">
                                {k.nama_kebun} — ({k.wilayah || 'Wilayah Belum Diset'})
                              </option>
                            ))}
                          </select>
                        </div>
                        {renderPerusahaanField()}
                      </div>

                      {curKebun && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-[#8B9BB4] bg-[#0D1322]/60 rounded-lg px-3 py-1.5 border border-[#1E2942]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[#F0F6FC] font-semibold">
                              {curKebun.nama_kebun}
                            </span>
                            <span className="text-[#2C3B59]">|</span>
                            <span>
                              Wilayah:{' '}
                              <span className="text-emerald-400 font-medium">
                                {curKebun.wilayah || '-'}
                              </span>
                            </span>
                          </div>
                          {isPerusahaanChanged && (
                            <span className="px-2 py-0.5 rounded bg-[#00D2FF]/10 border border-[#00D2FF]/40 text-[#00D2FF] text-[10px] font-semibold">
                              Perusahaan akan diperbarui ke: {newKebunPerusahaan.trim()}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* 2. TABEL MATRIKS STANDAR ARCGIS PRO: DAFTAR LAYER SPASIAL */}
              <div className="bg-[#12192B]/90 border border-[#1E2942] rounded-xl overflow-hidden shadow-md">
                {/* Toolbar Tabel */}
                <div className="p-3 bg-[#0D1322] border-b border-[#1E2942] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider">
                      Daftar Layer Spasial Terdeteksi
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#00D2FF]/10 text-[#00D2FF] border border-[#00D2FF]/30">
                      {mappings.filter((m) => m.selected !== false).length} dari{' '}
                      {mappings.length} Layer Dipilih
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => toggleAllSelection(true)}
                      className="px-2.5 py-1 rounded bg-[#1A2338] hover:bg-[#25324E] border border-[#2A3958] text-[#8B9BB4] hover:text-[#F0F6FC] text-[10px] font-semibold transition-colors cursor-pointer"
                    >
                      ✓ Centang Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleAllSelection(false)}
                      className="px-2.5 py-1 rounded bg-[#1A2338] hover:bg-[#25324E] border border-[#2A3958] text-[#8B9BB4] hover:text-[#F0F6FC] text-[10px] font-semibold transition-colors cursor-pointer"
                    >
                      ✕ Batal Semua
                    </button>
                  </div>
                </div>

                {/* Tabel Matrix */}
                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-[#0A0E1A] text-[10px] uppercase font-bold text-[#8B9BB4] tracking-wider sticky top-0 z-10 border-b border-[#1E2942]">
                      <tr>
                        <th className="py-2.5 px-3 w-12 text-center">Pilih</th>
                        <th className="py-2.5 px-3 min-w-[210px]">File Sumber &amp; Geometri</th>
                        <th className="py-2.5 px-3 min-w-[210px]">Nama Layer di Peta</th>
                        <th className="py-2.5 px-3 min-w-[130px]">Kategori Layer</th>
                        <th className="py-2.5 px-3 min-w-[150px]">Afdeling (Opsional)</th>
                        <th className="py-2.5 px-3 min-w-[160px]">Proyeksi CRS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E2942]/60">
                      {detectedDatasets.map((ds, idx) => {
                        const m = mappings.find((item) => item.datasetIndex === idx) || mappings[idx];
                        const isChecked = m?.selected !== false;
                        const activeKebunId = targetMode === 'existing' ? selectedKebunId : null;
                        const filteredAfdeling = activeKebunId
                          ? afdelingList.filter((a) => a.kebun_id === activeKebunId)
                          : afdelingList;

                        return (
                          <tr
                            key={ds.index}
                            className={`transition-colors ${
                              isChecked
                                ? 'bg-[#12192B]/50 hover:bg-[#162138]'
                                : 'bg-[#0D1322]/50 opacity-40 hover:opacity-70'
                            }`}
                          >
                            {/* 1. Checkbox */}
                            <td className="py-3 px-3 text-center align-middle">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => updateMapping(idx, 'selected', e.target.checked)}
                                className="w-4 h-4 rounded border-[#1E2942] text-[#00D2FF] focus:ring-0 focus:ring-offset-0 bg-[#0D1322] cursor-pointer"
                              />
                            </td>

                            {/* 2. File Sumber & Geometri */}
                            <td className="py-3 px-3 align-middle">
                              <div
                                className="font-semibold text-xs text-[#F0F6FC] truncate max-w-[220px]"
                                title={ds.sourceFileName}
                              >
                                {ds.sourceFileName}
                              </div>
                              <div className="flex items-center gap-1.5 pt-0.5">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
                                  {ds.geometryType}
                                </span>
                                <span className="text-[10px] text-[#8B9BB4] font-mono">
                                  {ds.featureCount} fitur
                                </span>
                              </div>
                              {ds.attributes && ds.attributes.length > 0 && (
                                <div
                                  className="text-[9px] text-[#566680] truncate max-w-[220px] pt-0.5"
                                  title={ds.attributes.join(', ')}
                                >
                                  Atribut: {ds.attributes.slice(0, 4).join(', ')}
                                  {ds.attributes.length > 4 ? ` (+${ds.attributes.length - 4})` : ''}
                                </div>
                              )}
                            </td>

                            {/* 3. Nama Layer di Peta (Editable) */}
                            <td className="py-3 px-3 align-middle">
                              <input
                                type="text"
                                disabled={!isChecked}
                                value={m?.nama_layer || ''}
                                onChange={(e) => updateMapping(idx, 'nama_layer', e.target.value)}
                                placeholder="Nama layer..."
                                className="w-full bg-[#0D1322] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-none disabled:opacity-40 transition-colors"
                              />
                            </td>

                            {/* 4. Kategori Layer */}
                            <td className="py-3 px-3 align-middle">
                              <select
                                disabled={!isChecked}
                                value={m?.kategori || 'Lainnya'}
                                onChange={(e) => updateMapping(idx, 'kategori', e.target.value)}
                                className="w-full bg-[#0D1322] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-2 py-1.5 text-xs text-[#F0F6FC] focus:outline-none disabled:opacity-40 transition-colors"
                              >
                                {LAYER_CATEGORIES.map((c) => (
                                  <option key={c} value={c} className="bg-[#0D1322]">
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* 5. Afdeling Tujuan */}
                            <td className="py-3 px-3 align-middle">
                              {m?.new_afdeling_nama !== undefined && m?.new_afdeling_nama !== null ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    disabled={!isChecked}
                                    placeholder="Nama Afdeling..."
                                    value={m.new_afdeling_nama}
                                    onChange={(e) =>
                                      updateMapping(idx, 'new_afdeling_nama', e.target.value)
                                    }
                                    className="w-full bg-[#0D1322] border border-cyan-500/80 rounded-lg px-2 py-1.5 text-xs text-[#F0F6FC] focus:outline-none disabled:opacity-40"
                                  />
                                  <button
                                    type="button"
                                    disabled={!isChecked}
                                    onClick={() => updateMapping(idx, 'new_afdeling_nama', null)}
                                    className="text-[9px] text-slate-400 hover:text-white px-1"
                                    title="Pilih dari daftar"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <select
                                    disabled={!isChecked}
                                    value={m?.afdeling_id || ''}
                                    onChange={(e) =>
                                      updateMapping(
                                        idx,
                                        'afdeling_id',
                                        e.target.value ? Number(e.target.value) : null
                                      )
                                    }
                                    className="w-full bg-[#0D1322] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-2 py-1.5 text-xs text-[#F0F6FC] focus:outline-none disabled:opacity-40 transition-colors"
                                  >
                                    <option value="">Semua Afdeling</option>
                                    {filteredAfdeling.map((a) => (
                                      <option key={a.id} value={a.id} className="bg-[#0D1322]">
                                        {a.kode_afdeling} — {a.nama_afdeling}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={!isChecked}
                                    onClick={() => updateMapping(idx, 'new_afdeling_nama', 'Afdeling Baru')}
                                    className="text-[9px] text-[#00D2FF] hover:underline px-1 shrink-0"
                                    title="Ketik Afdeling Baru"
                                  >
                                    + Baru
                                  </button>
                                </div>
                              )}
                            </td>

                            {/* 6. Proyeksi CRS */}
                            <td className="py-3 px-3 align-middle">
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                <span className="truncate max-w-[150px]" title={ds.crsAsal || 'WGS 84'}>
                                  {ds.crsAsal || 'WGS 84'}
                                </span>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
            className="px-3.5 py-1.5 rounded-lg border border-[#1E2942] bg-[#12192B] hover:bg-[#19233A] text-xs text-[#8B9BB4] hover:text-[#F0F6FC] transition-colors cursor-pointer"
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
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#8B9BB4] hidden sm:inline font-mono">
                {mappings.filter((m) => m.selected !== false).length} dari {mappings.length} layer aktif
              </span>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={isImporting || mappings.filter((m) => m.selected !== false).length === 0}
                className="px-4 py-2 rounded-lg bg-[#00D2FF] hover:bg-[#38BDF8] disabled:opacity-40 text-xs font-bold text-[#0A0E1A] shadow-lg shadow-[#00D2FF]/20 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {isImporting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-[#0A0E1A]/30 border-t-[#0A0E1A] rounded-full animate-spin" />
                    <span>Menyimpan ke PostGIS...</span>
                  </>
                ) : (
                  <>
                    <IconAddData className="w-3.5 h-3.5" />
                    <span>
                      Konfirmasi &amp; Import ({mappings.filter((m) => m.selected !== false).length} Layer)
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
