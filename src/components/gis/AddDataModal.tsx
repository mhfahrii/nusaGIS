'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { IconClose, IconFolder } from './GisIcons';
import { IconUpload, IconCheck, IconAlertCircle } from '@/components/icons';
import type { LayerPeta, ExtentBox } from '@/types/gis';

interface AddDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (layers: LayerPeta[], bbox: [number, number, number, number] | null) => void;
}

interface KebunOption {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  wilayah?: string;
}

const CRS_OPTIONS = [
  { value: '', label: 'Deteksi Otomatis dari File .prj (Direkomendasikan)' },
  { value: 'EPSG:4326', label: 'EPSG:4326 — WGS 84 Geographic (Longitude / Latitude)' },
  { value: 'EPSG:32647', label: 'EPSG:32647 — WGS 84 / UTM Zone 47N (Aceh, Sumut)' },
  { value: 'EPSG:32648', label: 'EPSG:32648 — WGS 84 / UTM Zone 48N (Riau, Kepri, Kalbar)' },
  { value: 'EPSG:32748', label: 'EPSG:32748 — WGS 84 / UTM Zone 48S (Sumsel, Lampung, Jabar)' },
  { value: 'EPSG:32749', label: 'EPSG:32749 — WGS 84 / UTM Zone 49S (Jateng, Jatim, Kalteng, Kalsel)' },
  { value: 'EPSG:32750', label: 'EPSG:32750 — WGS 84 / UTM Zone 50S (Kaltim, Sulawesi, Bali, NTB)' },
  { value: 'EPSG:3857', label: 'EPSG:3857 — WGS 84 / Pseudo-Mercator (Web Mercator)' },
];

export function AddDataModal({ isOpen, onClose, onUploadSuccess }: AddDataModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [namaData, setNamaData] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [kebunId, setKebunId] = useState<string>('');
  const [fallbackCrs, setFallbackCrs] = useState<string>('');
  const [needsExplicitCrs, setNeedsExplicitCrs] = useState(false);
  const [kebunList, setKebunList] = useState<KebunOption[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    unggahanId: number;
    count: number;
    layers: LayerPeta[];
    bbox: [number, number, number, number] | null;
    extent: ExtentBox | null;
  } | null>(null);

  // Ambil daftar kebun dari public.kebun
  useEffect(() => {
    if (!isOpen) return;
    let ignore = false;
    async function fetchKebun() {
      try {
        const res = await fetch('/api/kebun');
        if (res.ok && !ignore) {
          const json = await res.json();
          const list: KebunOption[] = json.data || [];
          setKebunList(list);
          if (list.length > 0 && !kebunId) {
            setKebunId(String(list[0].id));
          }
        }
      } catch {
        // Abaikan jika gagal memuat
      }
    }
    fetchKebun();
    return () => {
      ignore = true;
    };
  }, [isOpen, kebunId]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (selected.length > 0) {
      setFiles(selected);
      setError(null);
      setNeedsExplicitCrs(false);
      if (!namaData) {
        const shp = selected.find((f) => f.name.toLowerCase().endsWith('.shp'));
        const target = shp || selected[0];
        setNamaData(target.name.replace(/\.[^/.]+$/, '').replace(/[_.-]/g, ' '));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kebunId) {
      setError('Silakan pilih Kebun terlebih dahulu dari data master.');
      return;
    }
    if (files.length === 0) {
      setError('Pilih file ZIP Shapefile atau kumpulan file .shp, .dbf, .prj terlebih dahulu.');
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    for (const f of files) {
      formData.append('files', f);
    }
    if (files.length === 1) {
      formData.append('file', files[0]);
    }
    formData.append('kebun_id', kebunId);
    formData.append(
      'nama_data',
      namaData.trim() || files[0].name.replace(/\.[^/.]+$/, '')
    );
    if (keterangan.trim()) {
      formData.append('keterangan', keterangan.trim());
    }
    if (fallbackCrs) {
      formData.append('fallback_crs', fallbackCrs);
    }

    try {
      const res = await fetch('/api/gis/upload', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        if (json.code === 'MISSING_PRJ_CRS') {
          setNeedsExplicitCrs(true);
        }
        throw new Error(json.message || 'Gagal memproses file.');
      }

      setSuccessInfo({
        unggahanId: json.data.unggahan_id,
        count: json.data.jumlah_layer,
        layers: json.data.layers,
        bbox: json.data.overall_bbox,
        extent: json.data.overall_extent,
      });

      // Langsung tambahkan layer ke Map View dan jalankan Auto-Zoom ke Extent
      onUploadSuccess(json.data.layers, json.data.overall_bbox);
    } catch (err: unknown) {
      const errorObj = err as Error;
      setError(errorObj.message || 'Terjadi kesalahan saat mengunggah.');
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setNamaData('');
    setKeterangan('');
    setFallbackCrs('');
    setNeedsExplicitCrs(false);
    setError(null);
    setSuccessInfo(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="h-11 px-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
            <IconFolder className="w-4 h-4" />
            <span>Add Data · Upload Shapefile ZIP ke PostGIS</span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 text-xs max-h-[82vh] overflow-y-auto">
          {successInfo ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-emerald-950/60 border border-emerald-700/60 flex items-start gap-3">
                <IconCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-emerald-300 text-sm">
                    Import PostGIS Berhasil! (Unggahan #{successInfo.unggahanId})
                  </h4>
                  <p className="text-slate-300 mt-1">
                    Sebanyak <strong>{successInfo.count} layer spasial</strong> telah divalidasi,
                    ditransformasikan ke <code>EPSG:4326</code>, dan peta otomatis diarahkan
                    (Auto-Zoom) ke lokasi geometri.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase">
                  Layer yang Ditambahkan ke Contents & Peta:
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {successInfo.layers.map((l) => (
                    <div
                      key={l.id}
                      className="flex flex-col gap-1 px-3 py-2 rounded bg-slate-950 border border-slate-800"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-xs shrink-0"
                            style={{ backgroundColor: l.warna }}
                          />
                          <span className="font-semibold text-slate-200">{l.nama_layer}</span>
                          <span className="text-[10px] text-slate-500">({l.tipe_geometri})</span>
                        </div>
                        <span className="font-mono text-[11px] text-emerald-400">
                          {l.jumlah_fitur} fitur
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>CRS Asal: {l.crs_asal || 'EPSG:4326'}</span>
                        {l.extent && (
                          <span>
                            [{l.extent.west.toFixed(4)}, {l.extent.south.toFixed(4)}] - [
                            {l.extent.east.toFixed(4)}, {l.extent.north.toFixed(4)}]
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors cursor-pointer"
                >
                  Selesai & Lihat di Peta
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-rose-950/70 border border-rose-800 text-rose-200 flex items-start gap-2.5">
                  <IconAlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* 1. Pilih Kebun (Wajib dari public.kebun) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block font-semibold text-slate-300">
                    Pilih Kebun Master <span className="text-rose-400">*</span>
                  </label>
                  <Link
                    href="/kebun"
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 underline"
                  >
                    + Kelola Master Kebun
                  </Link>
                </div>
                <select
                  required
                  value={kebunId}
                  onChange={(e) => setKebunId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">-- Pilih Kebun dari public.kebun --</option>
                  {kebunList.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.kode_kebun} — {k.nama_kebun} {k.wilayah ? `(${k.wilayah})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Dropzone File */}
              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  File GIS (ZIP atau Kumpulan File .shp, .dbf, .prj){' '}
                  <span className="text-rose-400">*</span>
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-emerald-500/80 rounded-xl p-5 bg-slate-950/50 cursor-pointer transition-colors text-center">
                  <IconUpload className="w-7 h-7 text-emerald-400 mb-1.5" />
                  {files.length > 0 ? (
                    <div>
                      <p className="font-bold text-emerald-300 text-sm">
                        {files.length === 1
                          ? files[0].name
                          : `${files.length} File Terpilih (${files
                              .filter((f) => f.name.toLowerCase().endsWith('.shp'))
                              .map((f) => f.name)
                              .join(', ') || 'Shapefile'})`}
                      </p>
                      <p className="text-slate-400 text-[11px] mt-0.5">
                        Total Ukuran:{' '}
                        {(
                          files.reduce((acc, f) => acc + f.size, 0) / 1024
                        ).toFixed(1)}{' '}
                        KB · Klik untuk mengganti
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-semibold text-slate-200">
                        Klik untuk memilih file <span className="text-emerald-400">.ZIP</span> atau{' '}
                        <span className="text-emerald-400">kumpulan file .shp, .dbf, .prj</span>
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Mendukung pemilihan langsung seluruh komponen Shapefile sekaligus (Maks. 250 MB)
                      </p>
                    </div>
                  )}
                  <input
                    type="file"
                    multiple
                    accept=".zip,.shp,.dbf,.shx,.prj,.cpg,.sbn,.sbx,.xml,.geojson,.json"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* 3. Nama Dataset & Keterangan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-300">
                    Nama Dataset <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={namaData}
                    onChange={(e) => setNamaData(e.target.value)}
                    placeholder="Contoh: Batas Kebun Percobaan A"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-300">Keterangan</label>
                  <input
                    type="text"
                    value={keterangan}
                    onChange={(e) => setKeterangan(e.target.value)}
                    placeholder="Contoh: Hasil pengukuran GPS 2026"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* 4. Pengaturan CRS (.prj / Fallback Eksplisit) */}
              <div
                className={`p-3 rounded-lg border space-y-1.5 ${
                  needsExplicitCrs
                    ? 'bg-amber-950/60 border-amber-600'
                    : 'bg-slate-950/70 border-slate-800'
                }`}
              >
                <label className="block font-semibold text-slate-300">
                  Sistem Koordinat / CRS Asal{' '}
                  {needsExplicitCrs && (
                    <span className="text-amber-400 font-bold">
                      (Wajib dipilih karena .prj tidak tersedia)
                    </span>
                  )}
                </label>
                <select
                  value={fallbackCrs}
                  onChange={(e) => setFallbackCrs(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-emerald-500 text-[11px]"
                >
                  {CRS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400">
                  Jika file <code>.prj</code> tersedia di dalam ZIP, sistem otomatis membaca WKT CRS
                  masing-masing Shapefile dan mentransformasikannya ke <code>EPSG:4326</code>.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={uploading}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={files.length === 0 || !kebunId || uploading}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  {uploading ? (
                    <>
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      <span>Memproses & Menyimpan ke PostGIS...</span>
                    </>
                  ) : (
                    <>
                      <IconUpload className="w-3.5 h-3.5" />
                      <span>Upload & Tampilkan di Peta</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
