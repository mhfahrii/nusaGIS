'use client';

import React, { useState, useEffect } from 'react';
import { IconClose, IconPencil, IconCheck } from '../GisIcons';
import type { LayerPeta } from '@/types/gis';

interface KebunItem {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
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
  const [komoditas, setKomoditas] = useState('Kelapa Sawit');
  const [tahunTanam, setTahunTanam] = useState(new Date().getFullYear().toString());
  const [statusLahan, setStatusLahan] = useState('Tanaman Menghasilkan (TM)');
  const [luasHa, setLuasHa] = useState(calculatedAreaHa.toString());
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
    setLuasHa(calculatedAreaHa.toFixed(2));
    setKode(`BLK-${Date.now().toString().slice(-4)}`);
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

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const payload = {
        layer_id: selectedLayerId,
        coordinates,
        nama: nama.trim(),
        kode: kode.trim() || undefined,
        kebun_id: selectedKebunId,
        afdeling_id: selectedAfdelingId,
        komoditas,
        tahun_tanam: parseInt(tahunTanam, 10) || null,
        status_lahan: statusLahan,
        luas_ha: parseFloat(luasHa) || calculatedAreaHa,
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
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-[#0D1322] border border-[#1E2942] rounded-xl shadow-2xl overflow-hidden flex flex-col text-[#F0F6FC] animate-in fade-in zoom-in-95 duration-150">
        {/* Header Modal */}
        <div className="h-12 px-4 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0E3A5D] border border-[#00B4D8]/50 flex items-center justify-center text-[#00D2FF]">
              <IconPencil className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider">
                Simpan Lahan Baru Hasil Gambar
              </h3>
              <p className="text-[10px] text-[#8B9BB4]">
                Data poligon otomatis disesuaikan dan disimpan ke database PostGIS
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#F0F6FC] transition-colors cursor-pointer"
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
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {/* Summary Box Hasil Digitasi */}
          <div className="bg-[#12192B] border border-[#1E2942] rounded-lg p-2.5 flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#00D2FF] animate-pulse" />
              <span className="text-[11px] text-[#8B9BB4] font-medium">
                Geometri Poligon Terbentuk:
              </span>
              <span className="font-mono text-[11px] font-bold text-[#00D2FF]">
                {coordinates.length} titik sudut
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-[#8B9BB4] block">Luas Geodesik Riil</span>
              <span className="font-mono text-xs font-extrabold text-[#00D2FF] tabular-nums">
                {calculatedAreaHa.toFixed(2)} Ha
              </span>
            </div>
          </div>

          {/* Layer Tujuan */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Layer GIS Tujuan <span className="text-rose-400">*</span>
            </label>
            <select
              value={selectedLayerId}
              onChange={(e) => setSelectedLayerId(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
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
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Nama Lahan / Blok <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="misal: Blok GPA 9 (Barat)"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-hidden focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Kode Blok
              </label>
              <input
                type="text"
                placeholder="misal: GPA-09"
                value={kode}
                onChange={(e) => setKode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-hidden focus:border-emerald-500 font-mono"
              />
            </div>
          </div>

          {/* Grid: Kebun & Afdeling */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Unit Kebun
              </label>
              <select
                value={selectedKebunId || ''}
                onChange={(e) => {
                  setSelectedKebunId(Number(e.target.value) || null);
                  setSelectedAfdelingId(null);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
              >
                <option value="">-- Pilih Kebun --</option>
                {kebunList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama_kebun} ({k.kode_kebun})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Afdeling
              </label>
              <select
                value={selectedAfdelingId || ''}
                onChange={(e) => setSelectedAfdelingId(Number(e.target.value) || null)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
              >
                <option value="">-- Pilih Afdeling --</option>
                {filteredAfdeling.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nama_afdeling} ({a.kode_afdeling})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Grid: Komoditas & Tahun Tanam */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Komoditas
              </label>
              <select
                value={komoditas}
                onChange={(e) => setKomoditas(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
              >
                <option value="Kelapa Sawit">Kelapa Sawit</option>
                <option value="Tebu">Tebu</option>
                <option value="Karet">Karet</option>
                <option value="Kopi">Kopi</option>
                <option value="Kakao">Kakao</option>
                <option value="Lainnya">Lainnya</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Tahun Tanam
              </label>
              <input
                type="number"
                min="1980"
                max="2035"
                value={tahunTanam}
                onChange={(e) => setTahunTanam(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-hidden focus:border-emerald-500 font-mono"
              />
            </div>
          </div>

          {/* Grid: Status Lahan & Luas (Ha) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Status Lahan
              </label>
              <select
                value={statusLahan}
                onChange={(e) => setStatusLahan(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-emerald-500"
              >
                <option value="Tanaman Menghasilkan (TM)">Tanaman Menghasilkan (TM)</option>
                <option value="Tanaman Belum Menghasilkan (TBM)">Tanaman Belum Menghasilkan (TBM)</option>
                <option value="Lahan Baku (KS GPA)">Lahan Baku (KS GPA)</option>
                <option value="Lahan Cadangan / Replanting">Lahan Cadangan / Replanting</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Luas Lahan Baku (Ha)
              </label>
              <input
                type="number"
                step="0.01"
                value={luasHa}
                onChange={(e) => setLuasHa(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-hidden focus:border-emerald-500 font-mono font-bold text-emerald-400"
              />
            </div>
          </div>

          {/* Keterangan */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Catatan / Keterangan
            </label>
            <textarea
              rows={2}
              placeholder="Catatan topografi, jenis bibit, atau kondisi jalan..."
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-hidden focus:border-emerald-500 resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#1E2942]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-lg border border-[#1E2942] hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#F0F6FC] text-xs transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded-lg bg-[#00D2FF] hover:bg-[#38BDF8] text-[#0A0E1A] font-bold text-xs flex items-center gap-1.5 shadow-md shadow-[#00D2FF]/20 transition-all cursor-pointer disabled:opacity-50"
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

