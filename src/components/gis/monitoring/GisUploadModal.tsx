'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  IconClose,
  IconAddData,
  IconLayers,
  IconFolder,
} from '../GisIcons';
import { KNOWN_CRS_WKT } from '@/lib/gis/crs';
import {
  DEFAULT_PERUSAHAAN,
  RPN_ENTITY_OPTIONS,
  inferRpnEntityFromContext,
  normalizePerusahaanName,
} from '@/lib/gis/rpnEntities';
import { PROVINSI_INDONESIA, parseWilayahHierarchy } from '@/lib/gis/wilayah';
import type { DetectedDataset, LayerPeta, LayerMappingInput } from '@/types/gis';

interface KebunOption {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  wilayah?: string | null;
  provinsi?: string | null;
  kabupaten_kota?: string | null;
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

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const SHP_COMPONENT_EXTENSIONS = ['.shp', '.dbf', '.shx', '.prj', '.cpg'];

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
  const [newKebunProvinsi, setNewKebunProvinsi] = useState<string>('');
  const [newKebunKabupaten, setNewKebunKabupaten] = useState<string>('');
  const [newKebunPerusahaan, setNewKebunPerusahaan] = useState<string>(DEFAULT_PERUSAHAAN);
  const [isNewPerusahaan, setIsNewPerusahaan] = useState<boolean>(false);

  // Daftar resmi 5 Puslit PT RPN + perusahaan tambahan dari DB (bisa dipilih atau ketik baru)
  const availablePerusahaan = useMemo(() => {
    const map = new Map<string, string>();
    const defaults = [...RPN_ENTITY_OPTIONS, DEFAULT_PERUSAHAAN];
    for (const d of defaults) {
      map.set(d.toLowerCase(), d);
    }
    for (const k of kebunList) {
      const p = normalizePerusahaanName(k.perusahaan);
      if (p && !map.has(p.toLowerCase())) {
        map.set(p.toLowerCase(), p);
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

  const handleClose = useCallback(() => {
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
    setNewKebunProvinsi('');
    setNewKebunKabupaten('');
    setNewKebunPerusahaan(DEFAULT_PERUSAHAAN);
    setIsNewPerusahaan(false);
    setErrorMessage(null);
    setIsInspecting(false);
    setIsImporting(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isInspecting && !isImporting) {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isInspecting, isImporting, handleClose]);

  const handleFilesChosen = (incoming: File[]) => {
    if (!incoming || incoming.length === 0) return;
    const cleaned = incoming.filter((f) => {
      const rel = (f.webkitRelativePath || f.name).toLowerCase();
      const base = rel.split('/').pop() || '';
      if (!base || base === 'desktop.ini' || base === '.ds_store' || base === 'thumbs.db') {
        return false;
      }
      return !rel.includes('__macosx/');
    });
    if (cleaned.length === 0) {
      setErrorMessage('Tidak ditemukan berkas GIS yang valid di pilihan Anda.');
      return;
    }
    setFiles(cleaned);
    setErrorMessage(null);
  };

  // Single unified classifier for dragged folders, ZIP archives, loose SHP components, GeoJSON, and GeoTIFF
  const fileSummary = useMemo(() => {
    if (files.length === 0) return null;

    const isFromFolder = files.some(
      (f) => Boolean(f.webkitRelativePath && f.webkitRelativePath.includes('/'))
    );
    const folderName = isFromFolder
      ? files.find((f) => f.webkitRelativePath)?.webkitRelativePath.split('/')[0] || 'Folder Terpilih'
      : null;

    const hasExt = (name: string, ext: string) => name.toLowerCase().endsWith(ext);
    const isShpComponent = (name: string) =>
      SHP_COMPONENT_EXTENSIONS.some((ext) => hasExt(name, ext));

    const shpFiles = files.filter((f) => hasExt(f.name, '.shp'));
    if (shpFiles.length > 0) {
      const dbfFiles = files.filter((f) => hasExt(f.name, '.dbf'));
      const prjFiles = files.filter((f) => hasExt(f.name, '.prj'));
      const shxFiles = files.filter((f) => hasExt(f.name, '.shx'));
      const uploadableFiles = files.filter((f) => isShpComponent(f.name));
      const skippedCount = files.length - uploadableFiles.length;
      const uploadSize = uploadableFiles.reduce((acc, f) => acc + f.size, 0);
      const primaryName = folderName || shpFiles[0].name.replace(/\.shp$/i, '');

      return {
        type: 'loose_shapefile' as const,
        isFromFolder,
        folderName,
        primaryName,
        primaryFile: null,
        uploadableFiles,
        totalSize: uploadSize,
        uploadSize,
        fileCount: files.length,
        uploadCount: uploadableFiles.length,
        skippedCount,
        shpCount: shpFiles.length,
        dbfCount: dbfFiles.length,
        prjCount: prjFiles.length,
        shxCount: shxFiles.length,
        hasShp: true,
        shpList: shpFiles.map((s) => s.name),
      };
    }

    const zipFiles = files.filter((f) => hasExt(f.name, '.zip'));
    if (zipFiles.length > 0) {
      const primaryFile = zipFiles[0];
      return {
        type: 'zip' as const,
        isFromFolder,
        folderName,
        primaryName: primaryFile.name,
        primaryFile,
        uploadableFiles: [primaryFile],
        totalSize: primaryFile.size,
        uploadSize: primaryFile.size,
        fileCount: 1,
        uploadCount: 1,
        skippedCount: files.length - 1,
        hasShp: true,
        formatLabel: 'Arsip ZIP Shapefile',
      };
    }

    const geojsonFiles = files.filter(
      (f) => hasExt(f.name, '.geojson') || hasExt(f.name, '.json')
    );
    if (geojsonFiles.length > 0) {
      const primaryFile = geojsonFiles[0];
      return {
        type: 'geojson' as const,
        isFromFolder,
        folderName,
        primaryName: primaryFile.name,
        primaryFile,
        uploadableFiles: [primaryFile],
        totalSize: primaryFile.size,
        uploadSize: primaryFile.size,
        fileCount: 1,
        uploadCount: 1,
        skippedCount: files.length - 1,
        hasShp: true,
        formatLabel: 'GeoJSON',
      };
    }

    const tifFiles = files.filter((f) => hasExt(f.name, '.tif') || hasExt(f.name, '.tiff'));
    if (tifFiles.length > 0) {
      const primaryFile = tifFiles[0];
      return {
        type: 'geotiff' as const,
        isFromFolder,
        folderName,
        primaryName: primaryFile.name,
        primaryFile,
        uploadableFiles: [primaryFile],
        totalSize: primaryFile.size,
        uploadSize: primaryFile.size,
        fileCount: 1,
        uploadCount: 1,
        skippedCount: files.length - 1,
        hasShp: true,
        formatLabel: 'Citra Raster GeoTIFF',
      };
    }

    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    return {
      type: 'unsupported' as const,
      isFromFolder,
      folderName,
      primaryName: folderName || files[0].name,
      primaryFile: null,
      uploadableFiles: [] as File[],
      totalSize,
      uploadSize: 0,
      fileCount: files.length,
      uploadCount: 0,
      skippedCount: files.length,
      hasShp: false,
      formatLabel: 'Format Tidak Didukung',
    };
  }, [files]);

  if (!isOpen) return null;

  const handleInspectFile = async () => {
    if (!fileSummary || files.length === 0) {
      setErrorMessage(
        'Pilih 1 folder penuh, file .zip, kumpulan .shp/.dbf/.shx/.prj, .geojson, atau .tif terlebih dahulu.'
      );
      return;
    }

    if (fileSummary.type === 'unsupported') {
      setErrorMessage(
        'Tidak ditemukan file .shp, .zip, .geojson, atau .tif yang dapat diproses. Pastikan folder atau file berisi dataset GIS yang valid.'
      );
      return;
    }

    if (fileSummary.uploadSize > MAX_UPLOAD_BYTES) {
      setErrorMessage(
        `Ukuran berkas (${(fileSummary.uploadSize / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimum 250 MB.`
      );
      return;
    }

    setIsInspecting(true);
    setErrorMessage(null);

    try {
      let res: Response;

      if (fileSummary.primaryFile) {
        // Stream single ZIP/GeoJSON/GeoTIFF as raw binary to bypass FormData overhead
        const targetFile = fileSummary.primaryFile;
        const headers: Record<string, string> = {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(targetFile.name),
        };
        if (fallbackCrs) {
          headers['X-Fallback-Crs'] = fallbackCrs;
        }
        res = await fetch('/api/gis/inspect', {
          method: 'POST',
          headers,
          body: targetFile,
        });
      } else {
        const formData = new FormData();
        for (const f of fileSummary.uploadableFiles) {
          const rel = f.webkitRelativePath || f.name;
          formData.append('files', f, rel);
        }
        if (fallbackCrs) {
          formData.append('fallback_crs', fallbackCrs);
        }
        res = await fetch('/api/gis/inspect', {
          method: 'POST',
          body: formData,
        });
      }

      const rawText = await res.text();
      let json: {
        message?: string;
        detail?: string;
        tempId?: string;
        fileName?: string;
        datasets?: DetectedDataset[];
      } = {};
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(
          res.status === 413
            ? 'Ukuran berkas terlalu besar untuk diproses server (Maks. 250 MB).'
            : `Server mengembalikan respons tidak valid (HTTP ${res.status}).`
        );
      }
      if (!res.ok) {
        const detailSuffix = json.detail ? ` (${json.detail})` : '';
        throw new Error(`${json.message || 'Gagal memeriksa isi file GIS.'}${detailSuffix}`);
      }

      const resolvedFileName = json.fileName || '';
      setTempId(json.tempId || null);
      setFileName(resolvedFileName);
      setDetectedDatasets(json.datasets || []);

      const firstDs = (json.datasets as DetectedDataset[])[0];
      const defaultKebunId = kebunList.length > 0 ? kebunList[0].id : 0;
      let initialTargetMode: 'existing' | 'new' = 'existing';
      let initialKebunId = defaultKebunId;
      let initialNama = '';
      let initialWilayah = '';
      let initialProvinsi = '';
      let initialKabupaten = '';
      let initialPerusahaan = inferRpnEntityFromContext({
        layerName: `${resolvedFileName} ${firstDs?.folderName || ''} ${firstDs?.name || ''} ${firstDs?.sourceFileName || ''}`,
        namaKebun: firstDs?.suggestedKebunName,
        wilayah: firstDs?.suggestedWilayah,
      });

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
          const parsed = parseWilayahHierarchy(initialWilayah);
          initialProvinsi = found.provinsi || firstDs.suggestedProvinsi || parsed.provinsi;
          initialKabupaten = found.kabupaten_kota || firstDs.suggestedKabupatenKota || parsed.kabupatenKota;
          initialPerusahaan = normalizePerusahaanName(found.perusahaan) || initialPerusahaan;
        } else {
          initialTargetMode = 'new';
          initialKebunId = 0;
          initialNama = firstDs.suggestedKebunName;
          initialWilayah = firstDs.suggestedWilayah || 'Wilayah Operasional';
          const parsed = parseWilayahHierarchy(initialWilayah);
          initialProvinsi = firstDs.suggestedProvinsi || parsed.provinsi;
          initialKabupaten = firstDs.suggestedKabupatenKota || parsed.kabupatenKota;
        }
      } else {
        initialTargetMode = kebunList.length > 0 ? 'existing' : 'new';
        initialNama = 'Kebun Baru';
        initialWilayah = firstDs?.suggestedWilayah || 'Wilayah Operasional';
        const parsed = parseWilayahHierarchy(initialWilayah);
        initialProvinsi = firstDs?.suggestedProvinsi || parsed.provinsi;
        initialKabupaten = firstDs?.suggestedKabupatenKota || parsed.kabupatenKota;
      }

      setTargetMode(initialTargetMode);
      setSelectedKebunId(initialKebunId);
      setNewKebunNama(initialNama);
      setNewKebunWilayah(initialWilayah);
      setNewKebunProvinsi(initialProvinsi);
      setNewKebunKabupaten(initialKabupaten);
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
          new_kebun_provinsi: initialProvinsi,
          new_kebun_kabupaten: initialKabupaten,
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
      const isNetworkAbort =
        error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error.message);
      setErrorMessage(
        isNetworkAbort
          ? 'Koneksi ke server terputus saat mengunggah. Pastikan server aktif dan ukuran file tidak melebihi 250 MB.'
          : error.message || 'Terjadi kesalahan saat memeriksa file.'
      );
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
      if (!newKebunKabupaten.trim() && !newKebunProvinsi.trim() && !newKebunWilayah.trim()) {
        setErrorMessage('Lokasi (Kota/Kabupaten) atau Provinsi kebun baru wajib diisi.');
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

    const fullWilayah = newKebunKabupaten.trim() && newKebunProvinsi.trim()
      ? `${newKebunKabupaten.trim()}, ${newKebunProvinsi.trim()}`
      : (newKebunProvinsi.trim() || newKebunKabupaten.trim() || newKebunWilayah.trim() || 'Wilayah Belum Ditentukan');

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
          new_kebun_wilayah: fullWilayah,
          new_kebun_provinsi: newKebunProvinsi.trim() || null,
          new_kebun_kabupaten: newKebunKabupaten.trim() || null,
          new_kebun_perusahaan: newKebunPerusahaan.trim() || DEFAULT_PERUSAHAAN,
        },
        mappings: mappings.map((m) => ({
          datasetIndex: m.datasetIndex,
          selected: m.selected !== false,
          nama_layer: m.nama_layer,
          kategori: m.kategori,
          kebun_id: targetMode === 'existing' ? selectedKebunId : 0,
          is_new_kebun: targetMode === 'new',
          new_kebun_nama: newKebunNama.trim(),
          new_kebun_wilayah: fullWilayah,
          new_kebun_provinsi: newKebunProvinsi.trim() || null,
          new_kebun_kabupaten: newKebunKabupaten.trim() || null,
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

      const rawText = await res.text();
      let json: {
        message?: string;
        detail?: string;
        data?: {
          layers?: LayerPeta[];
          overall_bbox?: [number, number, number, number] | null;
        };
      } = {};
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(`Server mengembalikan respons tidak valid (HTTP ${res.status}).`);
      }

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
      const isNetworkAbort =
        error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error.message);
      setErrorMessage(
        isNetworkAbort
          ? 'Koneksi ke server terputus saat menyimpan ke PostGIS. Pastikan server aktif.'
          : error.message || 'Terjadi kesalahan saat menyimpan ke PostGIS.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import Data GIS ke PostGIS"
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto"
    >
      <div
        className={`w-full ${
          step === 'mapping' ? 'max-w-5xl' : 'max-w-3xl'
        } bg-[#0D1322] border border-[#1E2942] rounded-xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden text-[#F0F6FC] transition-all duration-200 animate-in fade-in zoom-in-95`}
      >
        {/* Header Modal */}
        <div className="min-h-12 px-3.5 sm:px-5 py-2 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#0E3A5D] border border-[#00B4D8]/50 flex items-center justify-center text-[#00D2FF] shrink-0">
              <IconAddData className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider truncate">
                Import Data GIS ke PostGIS
              </h3>
              <p className="text-[10px] text-[#8B9BB4] truncate">
                Mendukung 1 folder penuh, arsip .zip, kumpulan .shp/.dbf/.shx/.prj, GeoJSON, &amp; GeoTIFF (Maks. 250 MB)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Tutup modal upload"
            className="min-w-9 min-h-9 flex items-center justify-center rounded-lg hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#F0F6FC] transition-colors cursor-pointer shrink-0"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-3.5 sm:mx-5 mt-3 sm:mt-4 p-3 bg-rose-950/80 border border-rose-800/80 rounded-lg text-rose-300 text-xs flex items-start gap-2">
            <span className="font-bold text-rose-400 shrink-0">Kesalahan:</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4">
          {step === 'select' ? (
            <div className="space-y-4">
              {/* Unified dropzone accepting dropped folders, ZIPs, loose shapefiles, GeoJSON, and GeoTIFF */}
              <div
                onClick={() => {
                  if (files.length === 0) {
                    document.getElementById('gis-file-input')?.click();
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all group ${
                  files.length === 0 ? 'cursor-pointer' : ''
                } ${
                  isDragging
                    ? 'border-[#00D2FF] bg-[#0E3A5D]/40 ring-2 ring-[#00D2FF]/20'
                    : files.length > 0
                    ? fileSummary?.type === 'unsupported'
                      ? 'border-rose-500/70 bg-slate-950/80'
                      : 'border-emerald-600/80 bg-slate-950/80'
                    : 'border-slate-700 hover:border-[#00D2FF]/70 bg-slate-950/60'
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
                <input
                  id="gis-file-input"
                  type="file"
                  multiple
                  accept=".zip,.shp,.dbf,.shx,.prj,.cpg,.geojson,.json,.tif,.tiff"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFilesChosen(Array.from(e.target.files));
                    }
                    e.target.value = '';
                  }}
                />

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
                    e.target.value = '';
                  }}
                />

                {files.length === 0 ? (
                  <div className="space-y-3">
                    <div className="w-12 h-12 mx-auto rounded-full bg-slate-800/80 group-hover:bg-[#0E3A5D] border border-slate-700 group-hover:border-[#00D2FF]/60 flex items-center justify-center text-slate-400 group-hover:text-[#00D2FF] transition-colors">
                      <IconLayers className="w-6 h-6" aria-hidden="true" />
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-slate-100 mb-1">
                        Seret Folder atau File GIS ke Sini
                      </div>
                      <div className="text-[11px] text-[#8B9BB4] max-w-lg mx-auto leading-relaxed">
                        Satu kotak untuk semua: 1 folder penuh (auto-scan subfolder), arsip .zip, kumpulan .shp/.dbf/.shx/.prj, .geojson, atau .tif (Maks. 250 MB).
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById('gis-file-input')?.click();
                        }}
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#0E3A5D] hover:bg-[#134B78] border border-[#00D2FF]/60 text-[#F0F6FC] text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-[#00D2FF]/10 transition-all cursor-pointer"
                      >
                        <IconAddData className="w-4 h-4 text-[#00D2FF]" aria-hidden="true" />
                        <span>Pilih File / ZIP</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById('gis-folder-input')?.click();
                        }}
                        className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-4 px-2 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <IconFolder className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                        <span>atau pilih 1 folder penuh</span>
                      </button>
                    </div>
                  </div>
                ) : fileSummary?.type === 'loose_shapefile' ? (
                  <div className="space-y-2.5 text-left max-w-xl mx-auto bg-slate-900/90 border border-slate-800 rounded-lg p-3.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {fileSummary.isFromFolder ? (
                          <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                            <IconFolder className="w-4 h-4" aria-hidden="true" />
                          </div>
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                            <span className="truncate">
                              {fileSummary.isFromFolder ? `Folder: ${fileSummary.folderName}` : fileSummary.primaryName}
                            </span>
                            {fileSummary.isFromFolder && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                                Subfolder Mode
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono block">
                            {fileSummary.uploadCount} file SHP siap kirim (
                            {fileSummary.uploadSize >= 1024 * 1024
                              ? `${(fileSummary.uploadSize / (1024 * 1024)).toFixed(2)} MB`
                              : `${(fileSummary.uploadSize / 1024).toFixed(1)} KB`}
                            )
                            {fileSummary.skippedCount > 0 && (
                              <span className="text-amber-300/90">
                                {' '}· {fileSummary.skippedCount} file non-SHP dilewati otomatis
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] text-emerald-400 font-semibold block">
                          ✓ Siap Diperiksa
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFiles([]);
                            setErrorMessage(null);
                          }}
                          className="text-[10px] text-[#8B9BB4] hover:text-rose-400 underline cursor-pointer"
                        >
                          Ganti File / Folder
                        </button>
                      </div>
                    </div>

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
                        {fileSummary.dbfCount > 0 ? '✓' : '-'} .dbf ({fileSummary.dbfCount})
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 ${
                          fileSummary.prjCount > 0
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {fileSummary.prjCount > 0 ? '✓' : '-'} .prj ({fileSummary.prjCount})
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 ${
                          fileSummary.shxCount > 0
                            ? 'bg-sky-950 text-sky-300 border border-sky-800'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {fileSummary.shxCount > 0 ? '✓' : '-'} .shx ({fileSummary.shxCount})
                      </span>
                    </div>

                    {fileSummary.shpList && fileSummary.shpList.length > 0 && (
                      <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800 flex items-center gap-1.5">
                        <span className="text-slate-400 font-medium">Layer ditemukan:</span>
                        <span className="text-slate-300 font-mono truncate">
                          {fileSummary.shpList.slice(0, 3).join(', ')}
                          {fileSummary.shpList.length > 3 && ` +${fileSummary.shpList.length - 3} lainnya`}
                        </span>
                      </div>
                    )}
                  </div>
                ) : fileSummary?.type === 'unsupported' ? (
                  <div className="space-y-2 text-center max-w-md mx-auto">
                    <div className="text-xs font-bold text-rose-300">
                      Format belum dikenali ({fileSummary.primaryName})
                    </div>
                    <div className="text-[11px] text-[#8B9BB4]">
                      Tidak ditemukan file .shp, .zip, .geojson, atau .tif dari {fileSummary.fileCount} berkas yang dipilih.
                    </div>
                    <div className="pt-1 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFiles([]);
                          setErrorMessage(null);
                        }}
                        className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 cursor-pointer"
                      >
                        Ganti File / Folder
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      document.getElementById('gis-file-input')?.click();
                    }}
                    className="space-y-1.5 text-center max-w-lg mx-auto bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 cursor-pointer hover:border-[#00D2FF]/60 transition-colors"
                  >
                    <div className="text-xs font-bold text-emerald-300 truncate">
                      {fileSummary?.primaryName}
                    </div>
                    <div className="text-[11px] text-[#8B9BB4] font-mono tabular-nums">
                      Ukuran: {((fileSummary?.uploadSize || 0) / 1024 / 1024).toFixed(2)} MB · Format: {fileSummary?.formatLabel}
                    </div>
                    {(fileSummary?.uploadSize || 0) > MAX_UPLOAD_BYTES && (
                      <div className="text-[11px] text-rose-400 font-semibold">
                        Melebihi batas maksimum 250 MB. Hapus file non-SHP dari arsip atau unggah folder aslinya.
                      </div>
                    )}
                    <div className="pt-1.5 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById('gis-file-input')?.click();
                        }}
                        className="text-[11px] font-semibold text-[#00D2FF] hover:text-[#38BDF8] underline cursor-pointer"
                      >
                        Pilih File Lain
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFiles([]);
                          setErrorMessage(null);
                        }}
                        className="text-[11px] text-[#8B9BB4] hover:text-rose-400 underline cursor-pointer"
                      >
                        Ganti File / Folder
                      </button>
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
              <div className="p-3 bg-[#0A1A2F]/80 border border-[#00B4D8]/30 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-2 h-2 rounded-full bg-[#00D2FF]" />
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

              <div className="p-4 bg-[#12192B]/90 border border-[#1E2942] rounded-xl space-y-3 shadow-md">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1E2942] pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-[#00D2FF]/10 border border-[#00D2FF]/30 flex items-center justify-center text-[#00D2FF] text-xs">
                      <IconLayers className="w-3.5 h-3.5" aria-hidden="true" />
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
                              normalizePerusahaanName(firstK.perusahaan) || DEFAULT_PERUSAHAAN
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
                                  availablePerusahaan[0] || DEFAULT_PERUSAHAAN
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
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
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
                              Provinsi <span className="text-rose-400">*</span>
                            </span>
                            <span className="text-[9px] text-emerald-400">Dari Koordinat GIS</span>
                          </label>
                          <select
                            value={newKebunProvinsi}
                            onChange={(e) => {
                              const p = e.target.value;
                              setNewKebunProvinsi(p);
                              const full = newKebunKabupaten.trim() ? `${newKebunKabupaten.trim()}, ${p}` : p;
                              setNewKebunWilayah(full);
                            }}
                            className="w-full bg-[#0D1322] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-none transition-colors"
                          >
                            <option value="" disabled>Pilih Provinsi...</option>
                            {PROVINSI_INDONESIA.map((prov) => (
                              <option key={prov} value={prov} className="bg-[#0D1322]">
                                {prov}
                              </option>
                            ))}
                            {newKebunProvinsi && !PROVINSI_INDONESIA.includes(newKebunProvinsi) && (
                              <option value={newKebunProvinsi} className="bg-[#0D1322]">{newKebunProvinsi}</option>
                            )}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-[#8B9BB4] block mb-1 flex items-center justify-between">
                            <span>Lokasi (Kabupaten / Kota)</span>
                            <span className="text-[9px] text-emerald-400">Otomatis / Edit</span>
                          </label>
                          <input
                            type="text"
                            placeholder="misal: Kabupaten Asahan / Pasuruan"
                            value={newKebunKabupaten}
                            onChange={(e) => {
                              const k = e.target.value;
                              setNewKebunKabupaten(k);
                              const full = k.trim() && newKebunProvinsi ? `${k.trim()}, ${newKebunProvinsi}` : (newKebunProvinsi || k);
                              setNewKebunWilayah(full);
                            }}
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
                                  normalizePerusahaanName(nextK.perusahaan) || DEFAULT_PERUSAHAAN
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
                                {k.nama_kebun} ({k.wilayah || 'Wilayah Belum Diset'})
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
                              Lokasi:{' '}
                              <span className="text-emerald-400 font-medium">
                                {curKebun.kabupaten_kota || curKebun.wilayah || '-'}
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
                                        {a.kode_afdeling} - {a.nama_afdeling}
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
