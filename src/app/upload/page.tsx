'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/DashboardLayout';
import {
  IconUpload,
  IconCheck,
  IconAlertCircle,
  IconMap,
  IconLayer,
  IconRefresh,
} from '@/components/icons';
import type { LayerPeta, ExtentBox } from '@/types/gis';

interface KebunItem {
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

function UploadGisContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialKebunId = searchParams.get('kebun_id') || '';

  const [kebunList, setKebunList] = useState<KebunItem[]>([]);
  const [existingLayers, setExistingLayers] = useState<LayerPeta[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Form states
  const [kebunId, setKebunId] = useState<string>(initialKebunId);
  const [namaData, setNamaData] = useState<string>('');
  const [keterangan, setKeterangan] = useState<string>('');
  const [fallbackCrs, setFallbackCrs] = useState<string>('');
  const [needsExplicitCrs, setNeedsExplicitCrs] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    unggahan_id: number;
    nama_kebun: string;
    kode_kebun: string;
    nama_data: string;
    crs_asal: string;
    jumlah_layer: number;
    layers: LayerPeta[];
    overall_extent: ExtentBox | null;
  } | null>(null);

  const loadMasterData = async () => {
    try {
      const [kebunRes, layersRes] = await Promise.all([
        fetch('/api/kebun'),
        fetch('/api/gis/layers'),
      ]);
      if (kebunRes.ok) {
        const kj = await kebunRes.json();
        const kList: KebunItem[] = kj.data || [];
        setKebunList(kList);
        setKebunId((prev) => (prev ? prev : kList.length > 0 ? String(kList[0].id) : ''));
      }
      if (layersRes.ok) {
        const lj = await layersRes.json();
        setExistingLayers(lj.data || []);
      }
    } catch {
      // Abaikan error sementara
    } finally {
      setLoadingInitial(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    async function init() {
      if (!ignore) {
        await loadMasterData();
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

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
      setError('Pilih Kebun terlebih dahulu dari data master public.kebun.');
      return;
    }
    if (files.length === 0) {
      setError('Pilih file ZIP Shapefile atau kumpulan file .shp, .dbf, .prj terlebih dahulu.');
      return;
    }

    setUploading(true);
    setError(null);
    setUploadResult(null);

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
        throw new Error(json.message || 'Gagal mengunggah dan memproses file.');
      }

      setUploadResult(json.data);
      setFiles([]);
      await loadMasterData();
    } catch (err: unknown) {
      const errorObj = err as Error;
      setError(errorObj.message || 'Terjadi kesalahan saat memproses Shapefile.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Kolom Kiri: Form Upload Shapefile ZIP */}
      <div className="lg:col-span-6 space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Formulir Upload Shapefile (.ZIP)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ekstraksi multi-Shapefile, validasi CRS <code>.prj</code>, & transformasi otomatis
                ke <code>EPSG:4326</code>
              </p>
            </div>
            <Link
              href="/kebun"
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 transition-colors"
            >
              + Master Kebun
            </Link>
          </div>

          {error && (
            <div className="mb-4 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
              <IconAlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Gagal Memproses Arsip Shapefile</p>
                <p className="mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {uploadResult && (
            <div className="mb-5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs space-y-3">
              <div className="flex items-start gap-2.5">
                <IconCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-emerald-900 text-sm">
                    Import Spasial Berhasil! (ID Unggahan #{uploadResult.unggahan_id})
                  </h4>
                  <p className="text-emerald-800 mt-0.5">
                    Dataset <strong>{uploadResult.nama_data}</strong> untuk kebun{' '}
                    <strong>
                      {uploadResult.nama_kebun} ({uploadResult.kode_kebun})
                    </strong>{' '}
                    berhasil disimpan ke PostGIS ({uploadResult.jumlah_layer} layer).
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-emerald-200 p-3 space-y-2">
                {uploadResult.layers.map((lyr) => (
                  <div
                    key={lyr.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 last:pb-0 border-b last:border-b-0 border-slate-100"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-xs shrink-0"
                          style={{ backgroundColor: lyr.warna }}
                        />
                        <span className="font-bold text-slate-800">{lyr.nama_layer}</span>
                        <span className="text-[11px] text-slate-500">
                          ({lyr.tipe_geometri} · {lyr.jumlah_fitur} fitur)
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                        CRS Asal: {lyr.crs_asal}
                      </p>
                      {lyr.extent && (
                        <p className="text-[10px] text-slate-500 font-mono">
                          Extent: W:{lyr.extent.west.toFixed(4)}, S:{lyr.extent.south.toFixed(4)},
                          E:{lyr.extent.east.toFixed(4)}, N:{lyr.extent.north.toFixed(4)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/?layer_id=${lyr.id}`)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <IconMap className="w-3.5 h-3.5" />
                      <span>Buka & Auto Zoom di Peta</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* 1. Pilih Kebun */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                1. Pilih Kebun (<code className="text-emerald-700">public.kebun</code>){' '}
                <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={kebunId}
                onChange={(e) => setKebunId(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white text-slate-800"
              >
                <option value="">-- Pilih Kebun --</option>
                {kebunList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.kode_kebun} — {k.nama_kebun} {k.wilayah ? `(${k.wilayah})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Nama Dataset */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                2. Nama Dataset <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={namaData}
                onChange={(e) => setNamaData(e.target.value)}
                placeholder="Contoh: Dataset Batas Kebun Percobaan A"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>

            {/* 3. File Shapefile (.ZIP / Kumpulan File Terpisah) */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                3. File GIS (ZIP atau Kumpulan File .shp, .dbf, .prj){' '}
                <span className="text-rose-500">*</span>
              </label>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl p-6 bg-slate-50/70 cursor-pointer transition-colors text-center">
                <IconUpload className="w-7 h-7 text-emerald-600 mb-2" />
                {files.length > 0 ? (
                  <div>
                    <p className="font-bold text-emerald-700 text-sm">
                      {files.length === 1
                        ? files[0].name
                        : `${files.length} File Terpilih (${files
                            .filter((f) => f.name.toLowerCase().endsWith('.shp'))
                            .map((f) => f.name)
                            .join(', ') || 'Shapefile'})`}
                    </p>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      Total Ukuran:{' '}
                      {(
                        files.reduce((acc, f) => acc + f.size, 0) / 1024
                      ).toFixed(1)}{' '}
                      KB · Klik untuk mengganti
                    </p>
                    <div className="flex flex-wrap gap-1 justify-center mt-2 max-w-sm">
                      {files.map((f) => (
                        <span
                          key={f.name}
                          className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono"
                        >
                          {f.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="font-semibold text-slate-700">
                      Pilih file arsip <span className="text-emerald-600 font-bold">.ZIP</span> atau{' '}
                      <span className="text-emerald-600 font-bold">kumpulan file .shp, .dbf, .prj</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
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

            {/* 4. Keterangan */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">4. Keterangan</label>
              <textarea
                rows={2}
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Catatan sumber peta, tahun pemetaan, atau metode survei..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>

            {/* 5. Pengaturan CRS (.prj / Pilihan Manual) */}
            <div
              className={`p-3.5 rounded-lg border ${
                needsExplicitCrs
                  ? 'bg-amber-50 border-amber-300'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <label className="block font-semibold text-slate-700 mb-1">
                5. Sistem Koordinat / CRS Sumber{' '}
                {needsExplicitCrs && (
                  <span className="text-amber-700 font-bold">
                    (Wajib dipilih karena file .prj tidak ditemukan di dalam ZIP)
                  </span>
                )}
              </label>
              <select
                value={fallbackCrs}
                onChange={(e) => setFallbackCrs(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-emerald-500"
              >
                {CRS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Sistem membaca CRS tiap Shapefile dari file <code>.prj</code> secara otomatis dan
                mentransformasikan koordinat ke <code>EPSG:4326</code> sebelum disimpan ke PostGIS.
              </p>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <Link
                href="/"
                className="px-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium transition-colors"
              >
                Kembali ke Workspace Peta
              </Link>
              <button
                type="submit"
                disabled={files.length === 0 || !kebunId || uploading}
                className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                {uploading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    <span>Memproses ke PostGIS...</span>
                  </>
                ) : (
                  <>
                    <IconUpload className="w-4 h-4" />
                    <span>Upload & Impor ke PostGIS</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Kolom Kanan: Daftar Layer Spasial Tersimpan di PostGIS */}
      <div className="lg:col-span-6 space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
            <div className="flex items-center gap-2">
              <IconLayer className="w-5 h-5 text-emerald-600" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Layer Spasial Tersimpan di PostGIS ({existingLayers.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Klik &ldquo;Auto Zoom di Peta&rdquo; untuk langsung menuju extent geometri layer
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadMasterData}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer"
              title="Muat Ulang Daftar Layer"
            >
              <IconRefresh className={`w-4 h-4 ${loadingInitial ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
            {existingLayers.map((layer) => (
              <div
                key={layer.id}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-emerald-300 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded-xs shrink-0"
                      style={{ backgroundColor: layer.warna }}
                    />
                    <span className="font-bold text-slate-900 text-xs truncate">
                      {layer.nama_layer}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-700">
                      {layer.tipe_geometri}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span>
                      Kebun:{' '}
                      <strong className="text-slate-800">
                        {layer.nama_kebun || 'Umum'} ({layer.kode_kebun || '-'})
                      </strong>
                    </span>
                    <span>
                      Fitur: <strong className="text-emerald-700">{layer.jumlah_fitur}</strong>
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    CRS Asal: {layer.crs_asal || 'EPSG:4326'} → Disimpan: EPSG:4326
                  </div>
                </div>

                <Link
                  href={`/?layer_id=${layer.id}`}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 self-start sm:self-center transition-colors"
                >
                  <IconMap className="w-3.5 h-3.5" />
                  <span>Auto Zoom di Peta</span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UploadGisPage() {
  return (
    <DashboardLayout
      title="Upload Data Spasial GIS"
      subtitle="Impor Shapefile (.ZIP) ke PostgreSQL/PostGIS & Transformasi Koordinat EPSG:4326"
    >
      <Suspense fallback={<div className="p-6 text-xs text-slate-500">Memuat halaman upload...</div>}>
        <UploadGisContent />
      </Suspense>
    </DashboardLayout>
  );
}

