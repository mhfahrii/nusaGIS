'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { DataMakroKebun, StatusHaraTanah } from '@/types/perkebunan';
import type { AfdelingRecord, KebunRecord } from './dashboardHelpers';

interface BlokItem {
  id: number;
  kebun_id: number;
  afdeling_id: number | null;
  kode_blok: string;
  nama_blok: string;
}

interface DataMakroKepalaKebunSectionProps {
  kebunList: KebunRecord[];
  afdelingList: AfdelingRecord[];
  blokList: BlokItem[];
  onRefreshMaster: () => Promise<void>;
  setBanner: (b: { type: 'success' | 'error'; text: string }) => void;
}

export default function DataMakroKepalaKebunSection({
  kebunList,
  afdelingList,
  blokList,
  onRefreshMaster,
  setBanner,
}: DataMakroKepalaKebunSectionProps) {
  const [makroList, setMakroList] = useState<DataMakroKebun[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Form State (Opsi A: Kombinasi Praktis Kepala Kebun)
  const [selectedKebunId, setSelectedKebunId] = useState<number | null>(
    kebunList[0]?.id ? Number(kebunList[0].id) : null
  );
  const [selectedAfdelingId, setSelectedAfdelingId] = useState<number | null>(null);
  const [selectedBlokId, setSelectedBlokId] = useState<number | null>(null);
  const [periodeBulan, setPeriodeBulan] = useState<string>('2026-11');
  const [curahHujanMm, setCurahHujanMm] = useState<string>('145');
  const [statusHara, setStatusHara] = useState<StatusHaraTanah>('normal');
  const [ndviRataRata, setNdviRataRata] = useState<string>('0.71');
  const [kelembabanTanah, setKelembabanTanah] = useState<string>('0.28');
  const [catatanLab, setCatatanLab] = useState<string>('');

  useEffect(() => {
    if (!selectedKebunId && kebunList.length > 0) {
      setSelectedKebunId(Number(kebunList[0].id));
    }
  }, [kebunList, selectedKebunId]);

  const fetchMakro = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data-makro', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setMakroList(j.data || []);
      }
    } catch (err) {
      console.error('Failed to load macro data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMakro();
  }, [fetchMakro]);

  const filteredAfdeling = useMemo(() => {
    if (!selectedKebunId) return [];
    return afdelingList.filter((a) => Number(a.kebun_id) === Number(selectedKebunId));
  }, [afdelingList, selectedKebunId]);

  const filteredBlok = useMemo(() => {
    if (!selectedKebunId) return [];
    return blokList.filter(
      (b) =>
        Number(b.kebun_id) === Number(selectedKebunId) &&
        (!selectedAfdelingId || Number(b.afdeling_id) === Number(selectedAfdelingId))
    );
  }, [blokList, selectedKebunId, selectedAfdelingId]);

  // Otomatis sesuaikan default NDVI & Soil Moisture saat Kepala Kebun memilih Status Hara (tetap bebas diedit)
  const handleSelectHara = (val: StatusHaraTanah) => {
    setStatusHara(val);
    if (val === 'optimal') {
      setNdviRataRata('0.78');
      setKelembabanTanah('0.32');
    } else if (val === 'normal') {
      setNdviRataRata('0.71');
      setKelembabanTanah('0.28');
    } else if (val === 'rendah') {
      setNdviRataRata('0.62');
      setKelembabanTanah('0.24');
    } else if (val === 'kritis') {
      setNdviRataRata('0.51');
      setKelembabanTanah('0.19');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKebunId) {
      setBanner({ type: 'error', text: 'Pilih Unit Kebun terlebih dahulu.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/data-makro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kebun_id: selectedKebunId,
          afdeling_id: selectedAfdelingId,
          blok_id: selectedBlokId,
          periode_bulan: periodeBulan,
          curah_hujan_mm: Number(curahHujanMm),
          status_hara: statusHara,
          ndvi_rata_rata: Number(ndviRataRata),
          kelembaban_tanah: Number(kelembabanTanah),
          catatan_lab: catatanLab.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal menyimpan data makro.');

      setBanner({
        type: 'success',
        text:
          json.message ||
          'Data Makro Iklim & Hara berhasil disimpan dan disinkronkan ke Root Cause Analysis (RCA).',
      });
      setCatatanLab('');
      await Promise.all([fetchMakro(), onRefreshMaster()]);
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyimpan data makro.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Form Input Data Makro & Iklim (Kepala Kebun) */}
      <div className="lg:col-span-5 bg-[#101726] border border-[#1E2942] rounded-2xl p-5 space-y-4 self-start">
        <div className="border-b border-[#1E2942] pb-3">
          <div className="flex items-center justify-between">
            <span className="px-2 py-0.5 rounded bg-[#00D2FF]/15 text-[#00D2FF] border border-[#00D2FF]/30 text-[10px] font-bold uppercase tracking-wider">
              Panel Kepala Kebun (Fase 5)
            </span>
            <span className="text-[10px] text-emerald-400 font-semibold">
              Sumber Kalkulasi RCA
            </span>
          </div>
          <h3 className="text-sm font-bold text-white mt-1.5">
            Input Data Makro Iklim, Hara &amp; Indeks Vegetasi
          </h3>
          <p className="text-[11px] text-[#8B9BB4] mt-0.5 leading-relaxed">
            Input data stasiun ombrometer (curah hujan), kategori status hara laboratorium (N, P, K), dan indeks vegetasi (NDVI) untuk cakupan 1 Unit Kebun atau diagnosis Blok spesifik.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {/* Cakupan Wilayah: Unit Kebun + Opsional Afdeling/Blok Spesifik */}
          <div className="p-3 rounded-xl bg-[#0D1322] border border-[#1E2942] space-y-2.5">
            <div className="text-[11px] font-bold text-[#00D2FF]">
              1. Cakupan Wilayah (Kebun Umum atau Blok Spesifik)
            </div>
            <div>
              <label className="block text-[10.5px] font-semibold text-[#8B9BB4] mb-1">
                Unit Kebun <span className="text-rose-400">*</span>
              </label>
              <select
                required
                value={selectedKebunId || ''}
                onChange={(e) => {
                  setSelectedKebunId(Number(e.target.value) || null);
                  setSelectedAfdelingId(null);
                  setSelectedBlokId(null);
                }}
                className="w-full px-3 py-2 rounded-lg bg-[#131D31] border border-[#1E2942] text-xs text-white font-semibold"
              >
                {kebunList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama_kebun} ({k.komoditas || 'Perkebunan'})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                  Afdeling (Opsional)
                </label>
                <select
                  value={selectedAfdelingId || ''}
                  onChange={(e) => {
                    setSelectedAfdelingId(Number(e.target.value) || null);
                    setSelectedBlokId(null);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#131D31] border border-[#1E2942] text-xs text-white"
                >
                  <option value="">-- Seluruh Kebun --</option>
                  {filteredAfdeling.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nama_afdeling}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                  Blok Spesifik (Opsional)
                </label>
                <select
                  value={selectedBlokId || ''}
                  onChange={(e) => setSelectedBlokId(Number(e.target.value) || null)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#131D31] border border-[#1E2942] text-xs text-white"
                >
                  <option value="">-- Seluruh Blok --</option>
                  {filteredBlok.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nama_blok}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Periode Bulan Pengamatan
              </label>
              <input
                type="month"
                value={periodeBulan}
                onChange={(e) => setPeriodeBulan(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Curah Hujan 30 Hari (mm) <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="1000"
                required
                value={curahHujanMm}
                onChange={(e) => setCurahHujanMm(e.target.value)}
                placeholder="Contoh: 145 mm"
                className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-[#00D2FF] font-bold font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
              Kategori Status Hara Tanah &amp; Daun (N, P, K) <span className="text-rose-400">*</span>
            </label>
            <select
              value={statusHara}
              onChange={(e) => handleSelectHara(e.target.value as StatusHaraTanah)}
              className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-semibold"
            >
              <option value="optimal">🟢 Optimal / Tinggi (Kandungan Hara N-P-K Sangat Cukup)</option>
              <option value="normal">🔵 Cukup / Normal (Sesuai Standar Agronomi)</option>
              <option value="rendah">🟡 Rendah / Defisit (Perlu Pemupukan Korektif N &amp; K)</option>
              <option value="kritis">🔴 Kritis (Defisit Hara Berat / Gejala Defisiensi Daun)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Indeks Vegetasi (NDVI: 0.10 – 0.95)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                max="0.99"
                value={ndviRataRata}
                onChange={(e) => setNdviRataRata(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-emerald-400 font-bold font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Soil Moisture (Kelembaban m³/m³)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.05"
                max="0.90"
                value={kelembabanTanah}
                onChange={(e) => setKelembabanTanah(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-amber-300 font-bold font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
              Catatan Hasil Uji Laboratorium / Evaluasi Kepala Kebun (Opsional)
            </label>
            <textarea
              rows={2}
              value={catatanLab}
              onChange={(e) => setCatatanLab(e.target.value)}
              placeholder="Contoh: Hasil analisis daun menunjukkan defisiensi Kalium pada blok lereng timur..."
              className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#00D2FF] to-[#0099FF] text-[#0A0E1A] font-bold text-xs shadow-md shadow-[#00D2FF]/20 hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
          >
            {submitting
              ? 'Menyimpan & Memperbarui RCA...'
              : 'Simpan Data Makro & Sinkronkan ke Analisis RCA'}
          </button>
        </form>
      </div>

      {/* Tabel Riwayat Data Makro & Iklim */}
      <div className="lg:col-span-7 bg-[#101726] border border-[#1E2942] rounded-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-[#1E2942] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">
              Rekam Jejak Data Makro Iklim, Hara &amp; NDVI Kebun
            </h3>
            <p className="text-[11px] text-[#8B9BB4]">
              Data yang diinput Kepala Kebun langsung digunakan oleh mesin Root Cause Analysis (RCA)
            </p>
          </div>
          <button
            type="button"
            onClick={fetchMakro}
            className="px-3 py-1.5 rounded-lg bg-[#131D31] hover:bg-[#1E2942] text-xs text-[#00D2FF] font-semibold cursor-pointer"
          >
            Segarkan
          </button>
        </div>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#131D31] text-[#8B9BB4] text-[10px] font-bold uppercase border-b border-[#1E2942]">
                <th className="py-3 px-4">Periode &amp; Cakupan</th>
                <th className="py-3 px-4">Curah Hujan</th>
                <th className="py-3 px-4">Status Hara (N, P, K)</th>
                <th className="py-3 px-4">NDVI &amp; Soil Moisture</th>
                <th className="py-3 px-4">Catatan Lab / Evaluasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2942]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#8B9BB4]">
                    Memuat data makro kebun...
                  </td>
                </tr>
              ) : makroList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#8B9BB4]">
                    Belum ada data makro tercatat.
                  </td>
                </tr>
              ) : (
                makroList.map((item) => (
                  <tr key={Number(item.id)} className="hover:bg-[#131E33] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-white">{item.nama_kebun}</div>
                      <div className="text-[10px] text-[#00D2FF] font-mono">
                        Periode: {item.periode_bulan}
                        {item.nama_blok ? ` · Blok: ${item.nama_blok}` : item.nama_afdeling ? ` · ${item.nama_afdeling}` : ' · Seluruh Kebun'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-[#38BDF8]">
                      {item.curah_hujan_mm} mm
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                          item.status_hara === 'kritis'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : item.status_hara === 'rendah'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        {item.status_hara}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      <span className="text-emerald-400 font-bold">NDVI {item.ndvi_rata_rata}</span>
                      <span className="text-[#8B9BB4]"> · SM {item.kelembaban_tanah} m³/m³</span>
                    </td>
                    <td className="py-3 px-4 text-[#8B9BB4] max-w-xs">
                      {item.catatan_lab || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
