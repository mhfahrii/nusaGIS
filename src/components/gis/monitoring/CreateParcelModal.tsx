'use client';

import React, { useState, useEffect } from 'react';
import { IconClose, IconPencil, IconCheck } from '../GisIcons';
import type { LayerPeta } from '@/types/gis';

interface KebunItem {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  wilayah: string | null;
  perusahaan?: string | null;
}

interface AfdelingItem {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
}

interface CreateParcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  coordinates: [number, number][]; // [ [lng, lat], ... ]
  calculatedAreaHa: number;
  layers: LayerPeta[];
  defaultLayerId?: number | null;
  onSuccess: (newFeature: Record<string, unknown>, layerId: number) => void;
}

export function CreateParcelModal({
  isOpen,
  onClose,
  coordinates,
  calculatedAreaHa,
  layers,
  defaultLayerId,
  onSuccess,
}: CreateParcelModalProps) {
  const [nama, setNama] = useState('');
  const [kode, setKode] = useState('');
  const [selectedLayerId, setSelectedLayerId] = useState<number>(
    defaultLayerId || (layers[0]?.id ?? 11)
  );
  const [kebunList, setKebunList] = useState<KebunItem[]>([]);
  const [afdelingList, setAfdelingList] = useState<AfdelingItem[]>([]);
  const [selectedKebunId, setSelectedKebunId] = useState<number | null>(null);
  const [selectedAfdelingId, setSelectedAfdelingId] = useState<number | null>(null);

  // Mode Buat / Ketik Kebun & Afdeling Baru
  const [isNewKebun, setIsNewKebun] = useState(false);
  const [newKebunNama, setNewKebunNama] = useState('');
  const [newKebunWilayah, setNewKebunWilayah] = useState('');
  const [newKebunPerusahaan, setNewKebunPerusahaan] = useState('PT Perkebunan Nusantara I (Regional 4)');
  const [isNewAfdeling, setIsNewAfdeling] = useState(false);
  const [newAfdelingNama, setNewAfdelingNama] = useState('');
  const [komoditas, setKomoditas] = useState('Tebu');
  const [tahunTanam, setTahunTanam] = useState('2024');
  const [statusLahan, setStatusLahan] = useState('KS GPA 2023');
  const [luasHa, setLuasHa] = useState(calculatedAreaHa.toString());
  const [luasBaku, setLuasBaku] = useState(calculatedAreaHa.toFixed(2));
  const [keterangan, setKeterangan] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync default layer and calculated area
  useEffect(() => {
    if (defaultLayerId) {
      setSelectedLayerId(defaultLayerId);
    } else if (layers.length > 0) {
      setSelectedLayerId(layers[0].id);
    }
    const areaStr = calculatedAreaHa.toFixed(2);
    setLuasHa(areaStr);
    setLuasBaku(areaStr);
    setKode(`BLK-${Date.now().toString().slice(-4)}`);
    setTahunTanam(new Date().getFullYear().toString());
  }, [defaultLayerId, layers, calculatedAreaHa]);

  // Load master kebun & afdeling
  useEffect(() => {
    async function loadMaster() {
      try {
        const [kRes, aRes] = await Promise.all([fetch('/api/kebun'), fetch('/api/afdeling')]);
        if (kRes.ok) {
          const kj = await kRes.json();
          const kData: KebunItem[] = kj.data || [];
          setKebunList(kData);
          if (kData.length > 0 && !selectedKebunId) {
            // Default to Kebun Bakalan jika ada
            const bkl = kData.find((k) => k.nama_kebun.toLowerCase().includes('bakalan')) || kData[0];
            setSelectedKebunId(bkl.id);
          }
        }
        if (aRes.ok) {
          const aj = await aRes.json();
          setAfdelingList(aj.data || []);
        }
      } catch (err) {
        console.error('Failed to load kebun & afdeling:', err);
      }
    }
    if (isOpen) {
      loadMaster();
    }
  }, [isOpen, selectedKebunId]);

  if (!isOpen) return null;

  const filteredAfdeling = selectedKebunId
    ? afdelingList.filter((a) => a.kebun_id === selectedKebunId)
    : afdelingList;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nama.trim()) {
      setErrorMsg('Nama Lahan / Blok wajib diisi.');
      return;
    }
    if (!selectedLayerId) {
      setErrorMsg('Pilih layer tujuan penyimpanan.');
      return;
    }
    if (coordinates.length < 3) {
      setErrorMsg('Geometri tidak valid (kurang dari 3 titik sudut).');
      return;
    }

    if (isNewKebun && !newKebunNama.trim()) {
      setErrorMsg('Harap isi nama Unit Kebun baru.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const payload = {
        layer_id: selectedLayerId,
        coordinates,
        nama: nama.trim(),
        kode: kode.trim() || undefined,
        kebun_id: isNewKebun ? null : selectedKebunId,
        afdeling_id: isNewAfdeling ? null : selectedAfdelingId,
        new_kebun_nama: isNewKebun ? newKebunNama.trim() : null,
        new_kebun_wilayah: isNewKebun ? newKebunWilayah.trim() : null,
        new_kebun_perusahaan: isNewKebun ? newKebunPerusahaan.trim() : null,
        new_afdeling_nama: isNewAfdeling ? newAfdelingNama.trim() : null,
        komoditas,
        tahun_tanam: parseInt(tahunTanam, 10) || null,
        status_lahan: statusLahan,
        luas_ha: parseFloat(luasHa) || calculatedAreaHa,
        luas_baku: luasBaku ? parseFloat(luasBaku) : null,
        keterangan: keterangan.trim() || undefined,
      };

      const res = await fetch('/api/gis/features/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.detail || 'Gagal menyimpan lahan baru.');
      }

      onSuccess(json.data, selectedLayerId);
      onClose();
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMsg(error.message || 'Terjadi kesalahan saat menyimpan ke PostGIS.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-1200 flex items-center justify-center bg-black/80 p-4 overflow-hidden">
      <div className="w-full max-w-lg max-h-modal bg-bg-nav border border-border-subtle rounded-xl shadow-2xl overflow-hidden flex flex-col min-h-0 text-text-primary animate-in fade-in zoom-in-95 duration-150">
        {/* Header Modal */}
        <div className="h-12 px-4 bg-bg-nav border-b border-border-subtle flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-bg-accent-surface border border-accent-secondary/50 flex items-center justify-center text-accent-primary">
              <IconPencil className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">
                Simpan Lahan Hasil Digitasi
              </h3>
              <p className="text-2xs text-text-secondary">
                Data poligon otomatis disesuaikan dan disimpan ke database PostGIS
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-bg-surface text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-4 mt-3 p-2.5 bg-rose-950/80 border border-rose-800 rounded-lg text-rose-300 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3.5 text-xs nusa-scroll">
          {/* Summary Box Hasil Digitasi */}
          <div className="bg-bg-surface border border-border-subtle rounded-lg p-2.5 flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-accent-primary animate-pulse" />
              <span className="text-caption text-text-secondary font-medium">
                Geometri Poligon Terbentuk:
              </span>
              <span className="font-mono text-caption font-bold text-accent-primary">
                {coordinates.length} titik sudut
              </span>
            </div>
            <div className="text-right">
              <span className="text-2xs text-text-secondary block">Luas Geodesik Riil</span>
              <span className="font-mono text-xs font-extrabold text-accent-primary tabular-nums">
                {calculatedAreaHa.toFixed(2)} Ha
              </span>
            </div>
          </div>

          {/* Layer Tujuan */}
          <div>
            <label className="block text-caption font-semibold text-text-secondary mb-1">
              Layer GIS Tujuan <span className="text-rose-400">*</span>
            </label>
            <select
              value={selectedLayerId}
              onChange={(e) => setSelectedLayerId(Number(e.target.value))}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-border-active"
            >
              {layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nama_layer} ({l.jumlah_fitur} fitur)
                </option>
              ))}
            </select>
          </div>

          {/* Grid: Nama & Kode Blok */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-semibold text-text-secondary mb-1">
                Nama Lahan / Blok <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="misal: GPA 9 (Bakalan C, Timur)"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-border-active"
              />
            </div>
            <div>
              <label className="block text-caption font-semibold text-text-secondary mb-1">
                Kode Blok
              </label>
              <input
                type="text"
                placeholder="misal: GPA-09"
                value={kode}
                onChange={(e) => setKode(e.target.value)}
                className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-border-active font-mono"
              />
            </div>
          </div>

          {/* Section: Unit Kebun & Afdeling (Pilih yang Ada atau Ketik Baru) */}
          <div className="space-y-2.5 p-2.5 bg-bg-ground rounded-lg border border-border-subtle">
            <div className="flex items-center justify-between">
              <span className="text-caption font-bold text-text-primary">Kelompok Unit Kebun & Wilayah</span>
              <button
                type="button"
                onClick={() => {
                  setIsNewKebun((prev) => !prev);
                  if (!isNewKebun) {
                    setSelectedKebunId(null);
                    setSelectedAfdelingId(null);
                  }
                }}
                className="text-2xs text-accent-primary hover:underline cursor-pointer"
              >
                {isNewKebun ? '← Pilih Kebun yang Ada' : '+ Ketik / Buat Kebun Baru'}
              </button>
            </div>

            {!isNewKebun ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-semibold text-text-secondary mb-1">
                    Pilih Unit Kebun
                  </label>
                  <select
                    value={selectedKebunId || ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setIsNewKebun(true);
                        setSelectedKebunId(null);
                      } else {
                        setSelectedKebunId(Number(e.target.value) || null);
                      }
                      setSelectedAfdelingId(null);
                    }}
                    className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-border-active"
                  >
                    <option value="">-- Pilih Kebun --</option>
                    {kebunList.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.nama_kebun} ({k.wilayah || 'Wilayah'})
                      </option>
                    ))}
                    <option value="__new__" className="text-accent-primary font-bold">+ Ketik Kebun Baru...</option>
                  </select>
                </div>
                <div>
                  <label className="block text-2xs font-semibold text-text-secondary mb-1">
                    Afdeling
                  </label>
                  {!isNewAfdeling ? (
                    <select
                      value={selectedAfdelingId || ''}
                      onChange={(e) => {
                        if (e.target.value === '__new_afd__') {
                          setIsNewAfdeling(true);
                          setSelectedAfdelingId(null);
                        } else {
                          setSelectedAfdelingId(Number(e.target.value) || null);
                        }
                      }}
                      className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-border-active"
                    >
                      <option value="">-- Pilih Afdeling --</option>
                      {filteredAfdeling.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nama_afdeling} ({a.kode_afdeling})
                        </option>
                      ))}
                      <option value="__new_afd__" className="text-accent-primary font-bold">+ Ketik Afdeling Baru...</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        placeholder="Nama Afdeling..."
                        value={newAfdelingNama}
                        onChange={(e) => setNewAfdelingNama(e.target.value)}
                        className="w-full bg-bg-surface border border-border-active rounded-lg px-2 py-1 text-xs text-text-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setIsNewAfdeling(false)}
                        className="text-2xs text-text-secondary hover:text-text-primary px-1"
                        title="Batal"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2 border-t border-border-subtle pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-2xs font-semibold text-text-secondary mb-1">
                      Nama Kebun Baru <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="misal: Kebun Cibeureum"
                      value={newKebunNama}
                      onChange={(e) => setNewKebunNama(e.target.value)}
                      className="w-full bg-bg-surface border border-border-active rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-semibold text-text-secondary mb-1">
                      Wilayah Geografis <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="misal: Kabupaten Bandung, Jawa Barat"
                      value={newKebunWilayah}
                      onChange={(e) => setNewKebunWilayah(e.target.value)}
                      className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-2xs font-semibold text-text-secondary mb-1">
                      Perusahaan / Holding
                    </label>
                    <input
                      type="text"
                      placeholder="misal: PT Perkebunan Nusantara I"
                      value={newKebunPerusahaan}
                      onChange={(e) => setNewKebunPerusahaan(e.target.value)}
                      className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-semibold text-text-secondary mb-1">
                      Afdeling (Opsional)
                    </label>
                    <input
                      type="text"
                      placeholder="misal: Afdeling I"
                      value={newAfdelingNama}
                      onChange={(e) => setNewAfdelingNama(e.target.value)}
                      className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Grid: Komoditas & Tahun Tanam */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-semibold text-text-secondary mb-1">
                Komoditas
              </label>
              <select
                value={komoditas}
                onChange={(e) => setKomoditas(e.target.value)}
                className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-border-active"
              >
                <option value="Tebu">Tebu (PSKA 942)</option>
                <option value="Kelapa Sawit">Kelapa Sawit</option>
                <option value="Karet">Karet</option>
                <option value="Kopi">Kopi</option>
                <option value="Kakao">Kakao</option>
                <option value="Lainnya">Lainnya</option>
              </select>
            </div>
            <div>
              <label className="block text-caption font-semibold text-text-secondary mb-1">
                Tahun Tanam
              </label>
              <input
                type="number"
                min="1980"
                max="2035"
                value={tahunTanam}
                onChange={(e) => setTahunTanam(e.target.value)}
                className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-border-active font-mono"
              />
            </div>
          </div>

          {/* Grid: Status Lahan & Luas Baku Dokumen */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-semibold text-text-secondary mb-1">
                Status Pengelolaan Lahan
              </label>
              <select
                value={statusLahan}
                onChange={(e) => setStatusLahan(e.target.value)}
                className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-border-active"
              >
                <option value="KS GPA 2023">KS GPA 2023 (Kerjasama Garapan)</option>
                <option value="Kebun Tebu Giling (KTG)">Kebun Tebu Giling (KTG)</option>
                <option value="Tanaman Menghasilkan (TM)">Tanaman Menghasilkan (TM)</option>
                <option value="Tanaman Belum Menghasilkan (TBM)">Tanaman Belum Menghasilkan (TBM)</option>
                <option value="Lahan Cadangan / Replanting">Lahan Cadangan / Replanting</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-caption font-semibold text-text-secondary">
                  Luas Baku Dokumen (Ha)
                </label>
                <span className="text-3xs text-accent-primary">GIS: {calculatedAreaHa.toFixed(2)} Ha</span>
              </div>
              <input
                type="number"
                step="0.01"
                placeholder={calculatedAreaHa.toFixed(2)}
                value={luasBaku}
                onChange={(e) => setLuasBaku(e.target.value)}
                className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-accent-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-border-active font-mono font-bold"
              />
            </div>
          </div>

          {/* Keterangan */}
          <div>
            <label className="block text-caption font-semibold text-text-secondary mb-1">
              Catatan / Keterangan
            </label>
            <textarea
              rows={2}
              placeholder="Catatan topografi, nomor kontrak, atau kondisi lahan..."
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              className="w-full bg-bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-border-active resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-bg-surface text-text-secondary hover:text-text-primary text-xs transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded-lg bg-accent-primary hover:brightness-110 text-background font-bold text-xs flex items-center gap-1.5 shadow-md shadow-accent-primary/20 transition-all cursor-pointer disabled:opacity-50"
            >
              <IconCheck className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Menyimpan ke PostGIS...' : 'Simpan Lahan ke PostGIS'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

