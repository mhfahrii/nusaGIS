'use client';

import React, { useState, useEffect } from 'react';
import { IconClose, IconPencil, IconCheck } from '../GisIcons';
import { DEFAULT_PERUSAHAAN, RPN_ENTITY_OPTIONS } from '@/lib/gis/rpnEntities';
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

interface BlokItem {
  id: number;
  kebun_id: number;
  afdeling_id: number | null;
  kode_blok: string;
  nama_blok: string;
}

interface CreateParcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  coordinates: [number, number][]; // [ [lng, lat], ... ]
  calculatedAreaHa: number;
  layers: LayerPeta[];
  defaultLayerId?: number | null;
  defaultMode?: 'parcel' | 'kendala';
  onSuccess: (newFeature: Record<string, unknown>, layerId: number) => void;
}

export const KATEGORI_KENDALA_OPTIONS = [
  { value: 'jalan_akses', label: 'Jalan Produksi / Jembatan / Akses Kebun' },
  { value: 'hama_penyakit', label: 'Serangan Hama & Penyakit Tanaman (Helopeltis / Cacar / Jamur)' },
  { value: 'drainase_banjir', label: 'Drainase / Genangan Air / Banjir / Rorak Tersumbat' },
  { value: 'erosi_longsor', label: 'Erosi Tanah / Longsor / Topografi Kritis' },
  { value: 'fasilitas_irigasi', label: 'Kerusakan Fasilitas Kebun / Pompa / Irigasi' },
  { value: 'kerusakan_tanaman', label: 'Pohon Tumbang / Stres Vegetasi / Kekeringan Ekstrem' },
  { value: 'batas_lahan', label: 'Masalah Batas Blok / Konsesi / Okupasi Lahan' },
  { value: 'lainnya', label: 'Kendala Operasional Lapangan Lainnya' },
] as const;

export function CreateParcelModal({
  isOpen,
  onClose,
  coordinates,
  calculatedAreaHa,
  layers,
  defaultLayerId,
  defaultMode = 'parcel',
  onSuccess,
}: CreateParcelModalProps) {
  const [activeTab, setActiveTab] = useState<'parcel' | 'kendala'>(defaultMode);

  // State Tab 1: Digitasi Blok / Lahan Baru
  const [nama, setNama] = useState('');
  const [kode, setKode] = useState('');
  const [selectedLayerId, setSelectedLayerId] = useState<number>(
    defaultLayerId || (layers[0]?.id ?? 11)
  );
  const [kebunList, setKebunList] = useState<KebunItem[]>([]);
  const [afdelingList, setAfdelingList] = useState<AfdelingItem[]>([]);
  const [blokList, setBlokList] = useState<BlokItem[]>([]);
  const [selectedKebunId, setSelectedKebunId] = useState<number | null>(null);
  const [selectedAfdelingId, setSelectedAfdelingId] = useState<number | null>(null);

  // Mode Buat / Ketik Kebun & Afdeling Baru
  const [isNewKebun, setIsNewKebun] = useState(false);
  const [newKebunNama, setNewKebunNama] = useState('');
  const [newKebunWilayah, setNewKebunWilayah] = useState('');
  const [newKebunPerusahaan, setNewKebunPerusahaan] = useState(RPN_ENTITY_OPTIONS[0]);
  const [isNewAfdeling, setIsNewAfdeling] = useState(false);
  const [newAfdelingNama, setNewAfdelingNama] = useState('');
  const [komoditas, setKomoditas] = useState('Teh');
  const [tahunTanam, setTahunTanam] = useState('2024');
  const [statusLahan, setStatusLahan] = useState('Tanaman Menghasilkan (TM)');
  const [luasHa, setLuasHa] = useState(calculatedAreaHa.toString());
  const [luasBaku, setLuasBaku] = useState(calculatedAreaHa.toFixed(2));
  const [keterangan, setKeterangan] = useState('');

  // State Tab 2: Lapor Kendala Lapangan (Spasial)
  const [judulKendala, setJudulKendala] = useState('');
  const [kategoriKendala, setKategoriKendala] = useState<string>('jalan_akses');
  const [tingkatUrgensi, setTingkatUrgensi] = useState<'rendah' | 'sedang' | 'darurat'>('sedang');
  const [selectedBlokId, setSelectedBlokId] = useState<number | null>(null);
  const [deskripsiKendala, setDeskripsiKendala] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync default layer and calculated area when modal opens or area changes
  useEffect(() => {
    const timer = setTimeout(() => {
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
      setErrorMsg(null);
      setSuccessMsg(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [defaultLayerId, layers, calculatedAreaHa, isOpen]);

  // Load master kebun, afdeling, & blok
  useEffect(() => {
    async function loadMaster() {
      try {
        const [kRes, aRes, bRes] = await Promise.all([
          fetch('/api/kebun'),
          fetch('/api/afdeling'),
          fetch('/api/blok'),
        ]);
        if (kRes.ok) {
          const kj = await kRes.json();
          const kData: KebunItem[] = (kj.data || []).map((k: KebunItem) => ({
            ...k,
            id: Number(k.id),
          }));
          setKebunList(kData);
          if (kData.length > 0 && !selectedKebunId) {
            const gbg =
              kData.find((k) => k.nama_kebun.toLowerCase().includes('gamboeng')) ||
              kData.find((k) => k.nama_kebun.toLowerCase().includes('bakalan')) ||
              kData[0];
            setSelectedKebunId(Number(gbg.id));
          }
        }
        if (aRes.ok) {
          const aj = await aRes.json();
          setAfdelingList(
            (aj.data || []).map((a: AfdelingItem) => ({
              ...a,
              id: Number(a.id),
              kebun_id: Number(a.kebun_id),
            }))
          );
        }
        if (bRes.ok) {
          const bj = await bRes.json();
          setBlokList(
            (bj.data || []).map((b: BlokItem) => ({
              ...b,
              id: Number(b.id),
              kebun_id: Number(b.kebun_id),
              afdeling_id: b.afdeling_id ? Number(b.afdeling_id) : null,
            }))
          );
        }
      } catch (err) {
        console.error('Failed to load master data in CreateParcelModal:', err);
      }
    }
    if (isOpen) {
      loadMaster();
    }
  }, [isOpen, selectedKebunId]);

  if (!isOpen) return null;

  const filteredAfdeling = selectedKebunId
    ? afdelingList.filter((a) => Number(a.kebun_id) === Number(selectedKebunId))
    : afdelingList;

  const filteredBlok = selectedKebunId
    ? blokList.filter(
        (b) =>
          Number(b.kebun_id) === Number(selectedKebunId) &&
          (!selectedAfdelingId || Number(b.afdeling_id) === Number(selectedAfdelingId))
      )
    : blokList;

  const handleSubmitParcel = async (e: React.FormEvent) => {
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

  const handleSubmitKendala = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!judulKendala.trim()) {
      setErrorMsg('Judul / Nama Kendala Lapangan wajib diisi.');
      return;
    }
    if (coordinates.length < 3) {
      setErrorMsg('Geometri area kendala tidak valid (kurang dari 3 titik sudut).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/laporan-kendala', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          judul_kendala: judulKendala.trim(),
          kategori_kendala: kategoriKendala,
          tingkat_urgensi: tingkatUrgensi,
          kebun_id: selectedKebunId,
          afdeling_id: selectedAfdelingId,
          blok_id: selectedBlokId,
          layer_id: selectedLayerId,
          coordinates,
          luas_area_ha: Number(calculatedAreaHa.toFixed(2)),
          deskripsi: deskripsiKendala.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.detail || 'Gagal mengirim laporan kendala lapangan.');
      }

      setSuccessMsg(
        json.message ||
          'Laporan kendala berhasil disimpan dan masuk ke antrean konfirmasi Asisten Kebun -> Kepala Kebun.'
      );
      onSuccess({ id: json.fitur_id || 0, ...json.data }, selectedLayerId);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMsg(error.message || 'Terjadi kesalahan saat mengirim laporan kendala.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hasil Digitasi Peta GIS"
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-xs p-2.5 sm:p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg max-h-[92dvh] bg-[#0D1322] border border-[#1E2942] rounded-xl shadow-2xl overflow-hidden flex flex-col text-[#F0F6FC] animate-in fade-in zoom-in-95 duration-150">
        {/* Header Modal */}
        <div className="min-h-12 px-3.5 sm:px-4 py-2.5 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                activeTab === 'parcel'
                  ? 'bg-[#0E3A5D] border-[#00B4D8]/50 text-[#00D2FF]'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-400'
              }`}
            >
              <IconPencil className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider truncate">
                {activeTab === 'parcel'
                  ? 'Simpan Digitasi Blok / Lahan Baru'
                  : 'Lapor Kendala Lapangan (Digitasi Spasial)'}
              </h3>
              <p className="text-[10px] text-[#8B9BB4] truncate">
                {activeTab === 'parcel'
                  ? 'Simpan geometri poligon baru ke layer peta & master blok PostGIS'
                  : 'Alur Verifikasi: Mandor -> Konfirmasi Asisten Kebun -> Approve Kepala Kebun'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal"
            className="min-w-9 min-h-9 flex items-center justify-center rounded-lg hover:bg-[#12192B] text-[#8B9BB4] hover:text-[#F0F6FC] transition-colors cursor-pointer shrink-0"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* 2-Tab Switcher: Buat Digitasi Blok Baru vs Lapor Kendala Lapangan */}
        <div className="grid grid-cols-2 gap-1.5 p-2 bg-[#0A0E1A] border-b border-[#1E2942] shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('parcel');
              setErrorMsg(null);
            }}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 border ${
              activeTab === 'parcel'
                ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                : 'bg-[#12192B]/60 text-[#8B9BB4] border-transparent hover:text-white'
            }`}
          >
            <span>1. Buat Digitasi Blok Baru</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('kendala');
              setErrorMsg(null);
            }}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 border ${
              activeTab === 'kendala'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-sm'
                : 'bg-[#12192B]/60 text-[#8B9BB4] border-transparent hover:text-white'
            }`}
          >
            <span>2. Lapor Kendala Lapangan</span>
          </button>
        </div>

        {/* Error / Success Alert */}
        {errorMsg && (
          <div className="mx-4 mt-3 p-2.5 bg-rose-950/80 border border-rose-800 rounded-lg text-rose-300 text-xs shrink-0">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="mx-4 mt-3 p-2.5 bg-emerald-950/80 border border-emerald-700 rounded-lg text-emerald-300 text-xs shrink-0">
            {successMsg}
          </div>
        )}

        {/* TAB 1: FORM DIGITASI BLOK BARU */}
        {activeTab === 'parcel' ? (
          <form onSubmit={handleSubmitParcel} className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3.5 text-xs">
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
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Layer GIS Tujuan <span className="text-rose-400">*</span>
              </label>
              <select
                value={selectedLayerId}
                onChange={(e) => setSelectedLayerId(Number(e.target.value))}
                className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-hidden focus:border-[#00D2FF]"
              >
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nama_layer} ({l.jumlah_fitur} fitur)
                  </option>
                ))}
              </select>
            </div>

            {/* Grid: Nama & Kode Blok */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Nama Lahan / Blok <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="misal: BLOK 05-2 atau GPA 9"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] placeholder:text-[#8B9BB4]/50 focus:outline-hidden focus:border-[#00D2FF]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Kode Blok
                </label>
                <input
                  type="text"
                  placeholder="misal: RPN-PPTK-005-2"
                  value={kode}
                  onChange={(e) => setKode(e.target.value)}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] placeholder:text-[#8B9BB4]/50 focus:outline-hidden focus:border-[#00D2FF] font-mono"
                />
              </div>
            </div>

            {/* Section: Unit Kebun & Afdeling */}
            <div className="space-y-2.5 p-2.5 bg-[#0a0e1a] rounded-lg border border-[#1E2942]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-[#F0F6FC]">Kelompok Unit Kebun &amp; Wilayah</span>
                <button
                  type="button"
                  onClick={() => {
                    setIsNewKebun((prev) => !prev);
                    if (!isNewKebun) {
                      setSelectedKebunId(null);
                      setSelectedAfdelingId(null);
                    }
                  }}
                  className="text-[10px] text-[#00D2FF] hover:underline cursor-pointer"
                >
                  {isNewKebun ? '← Pilih Kebun yang Ada' : '+ Ketik / Buat Kebun Baru'}
                </button>
              </div>

              {!isNewKebun ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
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
                      className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-hidden focus:border-[#00D2FF]"
                    >
                      <option value="">-- Pilih Kebun --</option>
                      {kebunList.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.nama_kebun} ({k.wilayah || 'Wilayah'})
                        </option>
                      ))}
                      <option value="__new__" className="text-[#00D2FF] font-bold">+ Ketik Kebun Baru...</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
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
                        className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-hidden focus:border-[#00D2FF]"
                      >
                        <option value="">-- Pilih Afdeling --</option>
                        {filteredAfdeling.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nama_afdeling} ({a.kode_afdeling})
                          </option>
                        ))}
                        <option value="__new_afd__" className="text-[#00D2FF] font-bold">+ Ketik Afdeling Baru...</option>
                      </select>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          placeholder="Nama Afdeling..."
                          value={newAfdelingNama}
                          onChange={(e) => setNewAfdelingNama(e.target.value)}
                          className="w-full bg-[#12192B] border border-[#00D2FF] rounded-lg px-2 py-1 text-xs text-[#F0F6FC]"
                        />
                        <button
                          type="button"
                          onClick={() => setIsNewAfdeling(false)}
                          className="text-[10px] text-[#8B9BB4] hover:text-[#F0F6FC] px-1"
                          title="Batal"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2 border-t border-[#1E2942] pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                        Nama Kebun Baru <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="misal: Kebun Cibeureum"
                        value={newKebunNama}
                        onChange={(e) => setNewKebunNama(e.target.value)}
                        className="w-full bg-[#12192B] border border-[#00D2FF] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                        Lokasi (Kota / Kabupaten) <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="misal: Kabupaten Bandung, Jawa Barat"
                        value={newKebunWilayah}
                        onChange={(e) => setNewKebunWilayah(e.target.value)}
                        className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                        Perusahaan / Puslit (PT RPN)
                      </label>
                      <input
                        type="text"
                        list="rpn-entity-list"
                        value={newKebunPerusahaan}
                        onChange={(e) => setNewKebunPerusahaan(e.target.value)}
                        className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC]"
                      />
                      <datalist id="rpn-entity-list">
                        {RPN_ENTITY_OPTIONS.map((opt) => (
                          <option key={opt} value={opt} />
                        ))}
                        <option value={DEFAULT_PERUSAHAAN} />
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                        Afdeling (Opsional)
                      </label>
                      <input
                        type="text"
                        placeholder="misal: Afdeling Gamboeng"
                        value={newAfdelingNama}
                        onChange={(e) => setNewAfdelingNama(e.target.value)}
                        className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC]"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Grid: Komoditas & Tahun Tanam */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Komoditas
                </label>
                <select
                  value={komoditas}
                  onChange={(e) => setKomoditas(e.target.value)}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-hidden focus:border-[#00D2FF]"
                >
                  <option value="Teh">Teh (PPTK)</option>
                  <option value="Tebu">Tebu (P3GI)</option>
                  <option value="Kelapa Sawit">Kelapa Sawit (PPKS)</option>
                  <option value="Karet">Karet (PPK)</option>
                  <option value="Kopi">Kopi</option>
                  <option value="Kakao">Kakao</option>
                  <option value="Kina">Kina</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Tahun Tanam
                </label>
                <input
                  type="number"
                  min="1980"
                  max="2035"
                  value={tahunTanam}
                  onChange={(e) => setTahunTanam(e.target.value)}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-hidden focus:border-[#00D2FF] font-mono"
                />
              </div>
            </div>

            {/* Grid: Status Lahan & Luas Baku Dokumen */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Status Pengelolaan Lahan
                </label>
                <select
                  value={statusLahan}
                  onChange={(e) => setStatusLahan(e.target.value)}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-hidden focus:border-[#00D2FF]"
                >
                  <option value="Tanaman Menghasilkan (TM)">Tanaman Menghasilkan (TM)</option>
                  <option value="Tanaman Belum Menghasilkan (TBM)">Tanaman Belum Menghasilkan (TBM)</option>
                  <option value="KS GPA 2023">KS GPA 2023 (Kerjasama Garapan)</option>
                  <option value="Kebun Tebu Giling (KTG)">Kebun Tebu Giling (KTG)</option>
                  <option value="Lahan Cadangan / Replanting">Lahan Cadangan / Replanting</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-[#8B9BB4]">
                    Luas Baku Dokumen (Ha)
                  </label>
                  <span className="text-[9.5px] text-[#00D2FF]">GIS: {calculatedAreaHa.toFixed(2)} Ha</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  placeholder={calculatedAreaHa.toFixed(2)}
                  value={luasBaku}
                  onChange={(e) => setLuasBaku(e.target.value)}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#00D2FF] font-mono font-bold"
                />
              </div>
            </div>

            {/* Keterangan */}
            <div>
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Catatan / Keterangan
              </label>
              <textarea
                rows={2}
                placeholder="Catatan topografi, nomor kontrak, atau kondisi lahan..."
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] resize-none"
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
        ) : (
          /* TAB 2: FORM LAPOR KENDALA LAPANGAN SPASIAL (FLEKSIBEL & BERJENJANG ASISTEN -> KEPALA KEBUN) */
          <form onSubmit={handleSubmitKendala} className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3.5 text-xs">
            {/* Summary Box Area Kendala */}
            <div className="bg-amber-950/30 border border-amber-500/40 rounded-lg p-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                <span className="text-[11px] text-amber-200 font-semibold">
                  Area Kendala Terdigitasi:
                </span>
                <span className="font-mono text-[11px] font-bold text-amber-300">
                  {coordinates.length} titik koordinat
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-amber-200/80 block">Estimasi Cakupan</span>
                <span className="font-mono text-xs font-extrabold text-amber-300 tabular-nums">
                  {calculatedAreaHa.toFixed(2)} Ha
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Kategori Kendala Lapangan <span className="text-rose-400">*</span>
                </label>
                <select
                  value={kategoriKendala}
                  onChange={(e) => setKategoriKendala(e.target.value)}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-hidden focus:border-amber-400"
                >
                  {KATEGORI_KENDALA_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Tingkat Urgensi / Risiko <span className="text-rose-400">*</span>
                </label>
                <select
                  value={tingkatUrgensi}
                  onChange={(e) => setTingkatUrgensi(e.target.value as 'rendah' | 'sedang' | 'darurat')}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] focus:outline-hidden focus:border-amber-400"
                >
                  <option value="rendah">Rendah (Pemeliharaan Rutin)</option>
                  <option value="sedang">Sedang (Perlu Penanganan Segera)</option>
                  <option value="darurat">Darurat / Kritis (Prioritas Tinggi)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Judul / Ringkasan Kendala Lapangan <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Contoh: Serangan Helopeltis Berat, Jalan Produksi Amblas, Rorak Tersumbat..."
                value={judulKendala}
                onChange={(e) => setJudulKendala(e.target.value)}
                className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] placeholder:text-[#8B9BB4]/50 focus:outline-hidden focus:border-amber-400"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-2.5 bg-[#0a0e1a] rounded-lg border border-[#1E2942]">
              <div>
                <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                  Unit Kebun
                </label>
                <select
                  value={selectedKebunId || ''}
                  onChange={(e) => {
                    setSelectedKebunId(Number(e.target.value) || null);
                    setSelectedAfdelingId(null);
                    setSelectedBlokId(null);
                  }}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2 py-1.5 text-xs text-[#F0F6FC]"
                >
                  <option value="">-- Pilih Kebun --</option>
                  {kebunList.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.nama_kebun}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                  Afdeling
                </label>
                <select
                  value={selectedAfdelingId || ''}
                  onChange={(e) => {
                    setSelectedAfdelingId(Number(e.target.value) || null);
                    setSelectedBlokId(null);
                  }}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2 py-1.5 text-xs text-[#F0F6FC]"
                >
                  <option value="">-- Semua Afdeling --</option>
                  {filteredAfdeling.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nama_afdeling}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                  Blok Terdampak (Opsional)
                </label>
                <select
                  value={selectedBlokId || ''}
                  onChange={(e) => setSelectedBlokId(Number(e.target.value) || null)}
                  className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2 py-1.5 text-xs text-[#F0F6FC]"
                >
                  <option value="">-- Pilih Blok --</option>
                  {filteredBlok.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nama_blok}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Layer Peta Penempatan Poligon Kendala
              </label>
              <select
                value={selectedLayerId}
                onChange={(e) => setSelectedLayerId(Number(e.target.value))}
                className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC]"
              >
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nama_layer} ({l.jumlah_fitur} fitur)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                Deskripsi Detail &amp; Usulan Tindakan Lapangan
              </label>
              <textarea
                rows={3}
                placeholder="Jelaskan kondisi di lapangan, dampak terhadap produksi/panen, dan kebutuhan dukungan dari Asisten / Kepala Kebun..."
                value={deskripsiKendala}
                onChange={(e) => setDeskripsiKendala(e.target.value)}
                className="w-full bg-[#12192B] border border-[#1E2942] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] resize-none focus:outline-hidden focus:border-amber-400"
              />
            </div>

            <div className="p-2.5 rounded-lg bg-[#12192B] border border-[#1E2942] text-[10.5px] text-[#8B9BB4] flex items-center justify-between">
              <span>Alur Persetujuan Laporan:</span>
              <span className="font-bold text-amber-300">
                Mandor → Verifikasi Asisten Kebun → Approve Kepala Kebun
              </span>
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
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#0A0E1A] font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                <IconCheck className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Mengirim Laporan...' : 'Kirim Laporan ke Asisten & Kepala Kebun'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
