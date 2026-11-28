'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  MasterAktivitas,
  CatatanAktivitasBlok,
  LaporanKendalaLapangan,
  StatusVerifikasiLaporan,
} from '@/types/perkebunan';
import type { PenggunaPublik } from '@/types/auth';
import type { AfdelingRecord, KebunRecord } from './dashboardHelpers';
import { KATEGORI_KENDALA_OPTIONS } from '@/components/gis/monitoring/CreateParcelModal';

interface BlokSimple {
  id: number;
  kebun_id: number;
  afdeling_id: number | null;
  kode_blok: string;
  nama_blok: string;
  komoditas: string | null;
  aktivitas_terakhir?: string | null;
  tanggal_aktivitas_terakhir?: string | null;
}

interface CatatanHarianSectionProps {
  user: PenggunaPublik | null;
  kebunList: KebunRecord[];
  afdelingList: AfdelingRecord[];
  blokList: BlokSimple[];
  masterAktivitasList: MasterAktivitas[];
  onRefreshMaster: () => Promise<void>;
  setBanner: (b: { type: 'success' | 'error'; text: string }) => void;
}

export default function CatatanHarianSection({
  user,
  kebunList,
  afdelingList,
  blokList,
  masterAktivitasList,
  onRefreshMaster,
  setBanner,
}: CatatanHarianSectionProps) {
  const [subTab, setSubTab] = useState<'catatan_harian' | 'laporan_kendala'>('catatan_harian');

  // Apakah akun mandor dikunci ke 1 afdeling tertentu
  const isMandorLocked = Boolean(user && user.peran !== 'admin' && user.afdeling_id);
  const lockedAfdelingId = isMandorLocked && user?.afdeling_id ? Number(user.afdeling_id) : null;
  const lockedKebunId = useMemo(() => {
    if (!lockedAfdelingId) return user?.kebun_id ? Number(user.kebun_id) : null;
    const afd = afdelingList.find((a) => Number(a.id) === lockedAfdelingId);
    return afd ? Number(afd.kebun_id) : user?.kebun_id ? Number(user.kebun_id) : null;
  }, [lockedAfdelingId, afdelingList, user]);

  // Data States
  const [catatanList, setCatatanList] = useState<CatatanAktivitasBlok[]>([]);
  const [kendalaList, setKendalaList] = useState<LaporanKendalaLapangan[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(true);

  // Form State: Catatan Harian Blok
  const [selectedKebunId, setSelectedKebunId] = useState<number | null>(lockedKebunId);
  const [selectedAfdelingId, setSelectedAfdelingId] = useState<number | null>(lockedAfdelingId);
  const [selectedBlokId, setSelectedBlokId] = useState<number | null>(null);
  const [blokSearch, setBlokSearch] = useState<string>('');
  const [selectedAktivitasId, setSelectedAktivitasId] = useState<number | null>(null);
  const [tanggalAktivitas, setTanggalAktivitas] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [volumeHasil, setVolumeHasil] = useState<string>('');
  const [tenagaKerjaHk, setTenagaKerjaHk] = useState<string>('');
  const [pusinganPetik, setPusinganPetik] = useState<string>('');
  const [persenPeko, setPersenPeko] = useState<string>('');
  const [kondisiTanaman, setKondisiTanaman] = useState<string>('sehat');
  const [statusRisikoManual, setStatusRisikoManual] = useState<string>('normal');
  const [catatanText, setCatatanText] = useState<string>('');
  const [submittingCatatan, setSubmittingCatatan] = useState<boolean>(false);

  // Form State: Lapor Kendala Lapangan
  const [judulKendala, setJudulKendala] = useState<string>('');
  const [kategoriKendala, setKategoriKendala] = useState<string>('jalan_akses');
  const [tingkatUrgensi, setTingkatUrgensi] = useState<'rendah' | 'sedang' | 'darurat'>('sedang');
  const [deskripsiKendala, setDeskripsiKendala] = useState<string>('');
  const [submittingKendala, setSubmittingKendala] = useState<boolean>(false);

  // Filter Riwayat
  const [filterStatusVerif, setFilterStatusVerif] = useState<string>('all');
  const [processingId, setProcessingId] = useState<number | null>(null);

  // Sinkronisasi default kebun & afdeling saat daftar selesai dimuat
  useEffect(() => {
    if (lockedKebunId) {
      setSelectedKebunId(lockedKebunId);
    } else if (!selectedKebunId && kebunList.length > 0) {
      const gbg =
        kebunList.find((k) => k.nama_kebun.toLowerCase().includes('gamboeng')) ||
        kebunList.find((k) => k.nama_kebun.toLowerCase().includes('bakalan')) ||
        kebunList[0];
      setSelectedKebunId(Number(gbg.id));
    }
    if (lockedAfdelingId) {
      setSelectedAfdelingId(lockedAfdelingId);
    }
  }, [lockedKebunId, lockedAfdelingId, kebunList, selectedKebunId]);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const [cRes, kRes] = await Promise.all([
        fetch('/api/catatan-aktivitas', { cache: 'no-store' }),
        fetch('/api/laporan-kendala', { cache: 'no-store' }),
      ]);
      if (cRes.ok) {
        const cj = await cRes.json();
        setCatatanList(cj.data || []);
      }
      if (kRes.ok) {
        const kj = await kRes.json();
        setKendalaList(kj.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch catatan & kendala:', err);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Filter Afdeling berdasarkan Kebun
  const availableAfdelings = useMemo(() => {
    if (lockedAfdelingId) {
      return afdelingList.filter((a) => Number(a.id) === lockedAfdelingId);
    }
    if (!selectedKebunId) return afdelingList;
    return afdelingList.filter((a) => Number(a.kebun_id) === Number(selectedKebunId));
  }, [afdelingList, selectedKebunId, lockedAfdelingId]);

  // Filter Blok berdasarkan Kebun, Afdeling, dan Pencarian Teks
  const availableBloks = useMemo(() => {
    return blokList
      .filter((b) => {
        if (lockedAfdelingId && Number(b.afdeling_id) !== lockedAfdelingId) return false;
        if (selectedKebunId && Number(b.kebun_id) !== Number(selectedKebunId)) return false;
        if (selectedAfdelingId && Number(b.afdeling_id) !== Number(selectedAfdelingId)) return false;
        if (blokSearch.trim()) {
          const q = blokSearch.trim().toLowerCase();
          return (
            b.nama_blok.toLowerCase().includes(q) ||
            b.kode_blok.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => a.nama_blok.localeCompare(b.nama_blok, 'id', { numeric: true }));
  }, [blokList, lockedAfdelingId, selectedKebunId, selectedAfdelingId, blokSearch]);

  // Auto-select blok pertama jika belum ada yang dipilih
  useEffect(() => {
    if (
      availableBloks.length > 0 &&
      (!selectedBlokId || !availableBloks.some((b) => Number(b.id) === Number(selectedBlokId)))
    ) {
      setSelectedBlokId(Number(availableBloks[0].id));
    } else if (availableBloks.length === 0) {
      setSelectedBlokId(null);
    }
  }, [availableBloks, selectedBlokId]);

  // Deteksi Komoditas Aktif dari Kebun/Blok terpilih untuk menyaring Master Aktivitas
  const activeKomoditas = useMemo(() => {
    const blk = blokList.find((b) => Number(b.id) === Number(selectedBlokId));
    if (blk?.komoditas) return blk.komoditas;
    const kbn = kebunList.find((k) => Number(k.id) === Number(selectedKebunId));
    return kbn?.komoditas || 'Teh';
  }, [blokList, selectedBlokId, kebunList, selectedKebunId]);

  const availableAktivitas = useMemo(() => {
    const activeOnly = masterAktivitasList.filter((a) => a.is_aktif);
    const matching = activeOnly.filter(
      (a) =>
        a.komoditas.toLowerCase() === activeKomoditas.toLowerCase() ||
        a.komoditas.toLowerCase() === 'umum'
    );
    return matching.length > 0 ? matching : activeOnly;
  }, [masterAktivitasList, activeKomoditas]);

  useEffect(() => {
    if (
      availableAktivitas.length > 0 &&
      (!selectedAktivitasId || !availableAktivitas.some((a) => Number(a.id) === Number(selectedAktivitasId)))
    ) {
      setSelectedAktivitasId(Number(availableAktivitas[0].id));
    }
  }, [availableAktivitas, selectedAktivitasId]);

  const currentAktivitasObj = useMemo(
    () => masterAktivitasList.find((a) => Number(a.id) === Number(selectedAktivitasId)),
    [masterAktivitasList, selectedAktivitasId]
  );

  // Submit Catatan Harian Blok
  const handleSubmitCatatan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBlokId) {
      setBanner({ type: 'error', text: 'Pilih Blok / Petak terlebih dahulu.' });
      return;
    }
    if (!selectedAktivitasId) {
      setBanner({ type: 'error', text: 'Pilih Jenis Aktivitas dari Master Data.' });
      return;
    }

    setSubmittingCatatan(true);
    try {
      const res = await fetch('/api/catatan-aktivitas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blok_id: selectedBlokId,
          aktivitas_id: selectedAktivitasId,
          tanggal_aktivitas: tanggalAktivitas,
          volume_hasil: volumeHasil ? Number(volumeHasil) : 0,
          satuan: currentAktivitasObj?.satuan_hasil || 'Kg',
          tenaga_kerja_hk: tenagaKerjaHk ? parseInt(tenagaKerjaHk, 10) : 0,
          pusingan_petik: pusinganPetik ? parseInt(pusinganPetik, 10) : null,
          persen_peko: persenPeko ? Number(persenPeko) : null,
          kondisi_tanaman: kondisiTanaman,
          status_risiko_manual: statusRisikoManual,
          catatan: catatanText.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal menyimpan catatan harian.');

      setBanner({
        type: 'success',
        text: json.message || 'Catatan harian berhasil disimpan dan tampil di Pop-up Peta GIS.',
      });
      setVolumeHasil('');
      setTenagaKerjaHk('');
      setPusinganPetik('');
      setPersenPeko('');
      setCatatanText('');
      await Promise.all([fetchLogs(), onRefreshMaster()]);
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan catatan.',
      });
    } finally {
      setSubmittingCatatan(false);
    }
  };

  // Submit Laporan Kendala Lapangan dari Dashboard
  const handleSubmitKendala = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!judulKendala.trim()) {
      setBanner({ type: 'error', text: 'Judul kendala lapangan wajib diisi.' });
      return;
    }

    setSubmittingKendala(true);
    try {
      const res = await fetch('/api/laporan-kendala', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kebun_id: selectedKebunId,
          afdeling_id: selectedAfdelingId,
          blok_id: selectedBlokId,
          judul_kendala: judulKendala.trim(),
          kategori_kendala: kategoriKendala,
          tingkat_urgensi: tingkatUrgensi,
          deskripsi: deskripsiKendala.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal mengirim laporan kendala.');

      setBanner({
        type: 'success',
        text: json.message || 'Laporan kendala berhasil dikirim ke Asisten Kebun & Kepala Kebun.',
      });
      setJudulKendala('');
      setDeskripsiKendala('');
      await fetchLogs();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mengirim laporan kendala.',
      });
    } finally {
      setSubmittingKendala(false);
    }
  };

  // Handler Verifikasi Berjenjang (Asisten Kebun -> Kepala Kebun)
  const handleVerifyCatatan = async (id: number, nextStatus: StatusVerifikasiLaporan) => {
    setProcessingId(id);
    try {
      const res = await fetch('/api/catatan-aktivitas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status_verifikasi: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal memverifikasi catatan.');
      setBanner({ type: 'success', text: json.message });
      await fetchLogs();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memverifikasi catatan.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleVerifyKendala = async (id: number, nextStatus: StatusVerifikasiLaporan) => {
    setProcessingId(id);
    try {
      const res = await fetch('/api/laporan-kendala', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status_verifikasi: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal memperbarui status kendala.');
      setBanner({ type: 'success', text: json.message });
      await fetchLogs();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memperbarui status kendala.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const renderVerificationBadge = (status?: StatusVerifikasiLaporan) => {
    switch (status) {
      case 'disetujui_kepala_kebun':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            ✓ Disetujui Kepala Kebun
          </span>
        );
      case 'diverifikasi_asisten':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00D2FF]/15 text-[#00D2FF] border border-[#00D2FF]/30">
            ✓ Terverifikasi Asisten
          </span>
        );
      case 'selesai':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            ✓ Selesai Ditindaklanjuti
          </span>
        );
      case 'ditolak':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            ✕ Ditolak / Revisi
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            ⏳ Menunggu Verifikasi Asisten
          </span>
        );
    }
  };

  const filteredCatatanList = useMemo(() => {
    if (filterStatusVerif === 'all') return catatanList;
    return catatanList.filter((c) => (c.status_verifikasi || 'menunggu_asisten') === filterStatusVerif);
  }, [catatanList, filterStatusVerif]);

  const filteredKendalaList = useMemo(() => {
    if (filterStatusVerif === 'all') return kendalaList;
    return kendalaList.filter((k) => k.status_verifikasi === filterStatusVerif);
  }, [kendalaList, filterStatusVerif]);

  return (
    <div className="space-y-5">
      {/* Banner Penugasan Afdeling Mandor (Jika Akun Terkunci Afdeling) */}
      {isMandorLocked && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px] uppercase border border-emerald-500/30">
              Wilayah Tugas Mandor
            </span>
            <span className="text-[#E2E8F0]">
              Akun Anda ditugaskan khusus pada{' '}
              <strong className="text-emerald-400">{user?.afdeling_nama || 'Afdeling Tugas'}</strong>
              {user?.kebun_nama ? ` (${user.kebun_nama})` : ''}. Seluruh pilihan blok otomatis disesuaikan dengan afdeling Anda.
            </span>
          </div>
        </div>
      )}

      {/* Sub-Tab Navigation: Catatan Harian Blok vs Laporan Kendala Lapangan */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#101726] border border-[#1E2942] p-2 rounded-2xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('catatan_harian')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border ${
              subTab === 'catatan_harian'
                ? 'bg-[#00D2FF]/20 text-[#00D2FF] border-[#00D2FF]/50 shadow-sm'
                : 'bg-[#131D31] text-[#8B9BB4] border-transparent hover:text-white'
            }`}
          >
            <span>📋 Catatan Harian Blok (Panen &amp; Perlakuan)</span>
            <span className="px-1.5 py-0.2 rounded bg-[#0D1322] text-[10px] font-mono text-[#00D2FF]">
              {catatanList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('laporan_kendala')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border ${
              subTab === 'laporan_kendala'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                : 'bg-[#131D31] text-[#8B9BB4] border-transparent hover:text-white'
            }`}
          >
            <span>⚠️ Lapor Kendala Lapangan (Terintegrasi Digitasi Peta)</span>
            <span className="px-1.5 py-0.2 rounded bg-[#0D1322] text-[10px] font-mono text-amber-300">
              {kendalaList.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 pr-2">
          <span className="text-[11px] text-[#8B9BB4]">Filter Status:</span>
          <select
            value={filterStatusVerif}
            onChange={(e) => setFilterStatusVerif(e.target.value)}
            className="bg-[#131D31] border border-[#1E2942] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#00D2FF]"
          >
            <option value="all">Semua Status Verifikasi</option>
            <option value="menunggu_asisten">Menunggu Verifikasi Asisten</option>
            <option value="diverifikasi_asisten">Terverifikasi Asisten</option>
            <option value="disetujui_kepala_kebun">Disetujui Kepala Kebun</option>
            <option value="selesai">Selesai Ditindaklanjuti</option>
            <option value="ditolak">Ditolak / Revisi</option>
          </select>
        </div>
      </div>

      {/* =====================================================================
          SUB-TAB 1: FORM & RIWAYAT CATATAN HARIAN BLOK (MANDOR -> ASISTEN -> KEPALA KEBUN)
          ===================================================================== */}
      {subTab === 'catatan_harian' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Kolom Kiri: Form Input Catatan Harian */}
          <div className="lg:col-span-5 bg-[#101726] border border-[#1E2942] rounded-2xl p-5 space-y-4 self-start">
            <div className="border-b border-[#1E2942] pb-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#00D2FF] bg-[#00D2FF]/10 px-2 py-0.5 rounded border border-[#00D2FF]/30">
                  Form Operasional Mandor
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold">
                  Sinkron Otomatis ke Pop-up Peta
                </span>
              </div>
              <h3 className="text-sm font-bold text-white mt-1.5">
                Input Catatan Harian Blok / Petak
              </h3>
              <p className="text-[11px] text-[#8B9BB4] mt-0.5">
                Data langsung memperbarui kolom Aktivitas Terakhir di Pop-up Peta GIS dan masuk antrean verifikasi Asisten Kebun.
              </p>
            </div>

            <form onSubmit={handleSubmitCatatan} className="space-y-3.5 text-xs">
              {/* Pilihan Kebun & Afdeling */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Unit Kebun
                  </label>
                  <select
                    disabled={isMandorLocked}
                    value={selectedKebunId || ''}
                    onChange={(e) => {
                      setSelectedKebunId(Number(e.target.value) || null);
                      setSelectedAfdelingId(null);
                      setSelectedBlokId(null);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white disabled:opacity-60"
                  >
                    {kebunList.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.nama_kebun} ({k.komoditas || 'Umum'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Afdeling
                  </label>
                  <select
                    disabled={isMandorLocked}
                    value={selectedAfdelingId || ''}
                    onChange={(e) => {
                      setSelectedAfdelingId(Number(e.target.value) || null);
                      setSelectedBlokId(null);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white disabled:opacity-60"
                  >
                    {!isMandorLocked && <option value="">Semua Afdeling</option>}
                    {availableAfdelings.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nama_afdeling}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Pencarian & Pemilihan Blok */}
              <div className="p-3 rounded-xl bg-[#0D1322] border border-[#1E2942] space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-white">
                    Pilih Blok / Petak <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[10px] font-mono text-[#00D2FF]">
                    {availableBloks.length} Blok Tersedia
                  </span>
                </div>
                <input
                  type="text"
                  value={blokSearch}
                  onChange={(e) => setBlokSearch(e.target.value)}
                  placeholder="Cari nama atau kode blok (misal: BLOK 01-1, GPA 2)..."
                  className="w-full px-3 py-1.5 rounded-lg bg-[#131D31] border border-[#1E2942] text-xs text-white placeholder-[#566680] focus:outline-none focus:border-[#00D2FF]"
                />
                <select
                  required
                  value={selectedBlokId || ''}
                  onChange={(e) => setSelectedBlokId(Number(e.target.value) || null)}
                  className="w-full px-3 py-2 rounded-lg bg-[#131D31] border border-[#00D2FF]/50 text-xs text-white font-semibold focus:outline-none"
                >
                  {availableBloks.length === 0 ? (
                    <option value="">-- Tidak ada blok yang cocok --</option>
                  ) : (
                    availableBloks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nama_blok} — ({b.kode_blok})
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Tanggal & Jenis Aktivitas dari Master Data */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Tanggal Pengerjaan <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={tanggalAktivitas}
                    onChange={(e) => setTanggalAktivitas(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Jenis Aktivitas ({activeKomoditas}) <span className="text-rose-400">*</span>
                  </label>
                  <select
                    required
                    value={selectedAktivitasId || ''}
                    onChange={(e) => setSelectedAktivitasId(Number(e.target.value) || null)}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-semibold"
                  >
                    {availableAktivitas.map((akt) => (
                      <option key={akt.id} value={akt.id}>
                        [{akt.komoditas}] {akt.nama_aktivitas}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Volume Hasil & Tenaga Kerja (HK) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Volume / Hasil ({currentAktivitasObj?.satuan_hasil || 'Kg'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={volumeHasil}
                    onChange={(e) => setVolumeHasil(e.target.value)}
                    placeholder={`Contoh: 450 (${currentAktivitasObj?.satuan_hasil || 'Kg'})`}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-emerald-400 font-bold font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Tenaga Kerja (HK / Pemetik)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={tenagaKerjaHk}
                    onChange={(e) => setTenagaKerjaHk(e.target.value)}
                    placeholder="Contoh: 18 HK"
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-mono"
                  />
                </div>
              </div>

              {/* Indikator Khusus Operasional (Pusingan Petik & % Peko) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Pusingan Petik (Hari ke-)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={pusinganPetik}
                    onChange={(e) => setPusinganPetik(e.target.value)}
                    placeholder="Contoh: 8 (Hari ke-8)"
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Mutu Pucuk / % Peko (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={persenPeko}
                    onChange={(e) => setPersenPeko(e.target.value)}
                    placeholder="Contoh: 65.5%"
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-mono"
                  />
                </div>
              </div>

              {/* Kondisi Tanaman & Status Risiko Blok */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Kondisi Vegetasi / Tanaman
                  </label>
                  <select
                    value={kondisiTanaman}
                    onChange={(e) => setKondisiTanaman(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white"
                  >
                    <option value="sehat">Sehat / Vigor Optimal</option>
                    <option value="hama_ringan">Serangan Hama Ringan</option>
                    <option value="hama_berat">Serangan Hama Parah (Helopeltis/Cacar)</option>
                    <option value="kekeringan">Stres Air / Kekeringan</option>
                    <option value="tergenang">Genangan Air / Drainase Buruk</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Penanda Status Risiko Blok
                  </label>
                  <select
                    value={statusRisikoManual}
                    onChange={(e) => setStatusRisikoManual(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-semibold"
                  >
                    <option value="normal">🟢 Hijau (Normal / Aman)</option>
                    <option value="waspada">🟡 Kuning (Waspada / Perhatian)</option>
                    <option value="kritis">🔴 Merah (Kritis / Prioritas)</option>
                  </select>
                </div>
              </div>

              {/* Catatan Lapangan */}
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Catatan Harian Mandor
                </label>
                <textarea
                  rows={2}
                  value={catatanText}
                  onChange={(e) => setCatatanText(e.target.value)}
                  placeholder="Catatan kondisi cuaca, kendala pemetikan, atau dosis pupuk..."
                  className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submittingCatatan}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#00D2FF] to-[#0099FF] text-[#0A0E1A] font-bold text-xs shadow-md shadow-[#00D2FF]/20 hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {submittingCatatan ? 'Menyimpan & Menyinkronkan ke Peta...' : 'Simpan Catatan Harian Blok'}
              </button>
            </form>
          </div>

          {/* Kolom Kanan: Tabel Riwayat Catatan Harian & Alur Verifikasi Asisten -> Kepala Kebun */}
          <div className="lg:col-span-7 bg-[#101726] border border-[#1E2942] rounded-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-[#1E2942] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Riwayat Catatan Harian &amp; Verifikasi Berjenjang
                </h3>
                <p className="text-[11px] text-[#8B9BB4]">
                  Alur Opsi C: Langsung terbit di Pop-up Peta GIS · Diverifikasi Asisten Kebun → Disetujui Kepala Kebun
                </p>
              </div>
              <button
                type="button"
                onClick={fetchLogs}
                className="px-3 py-1.5 rounded-lg bg-[#131D31] hover:bg-[#1E2942] text-xs text-[#00D2FF] font-semibold cursor-pointer"
              >
                Segarkan
              </button>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#131D31] text-[#8B9BB4] text-[10px] font-bold uppercase border-b border-[#1E2942]">
                    <th className="py-3 px-3.5">Tanggal &amp; Blok</th>
                    <th className="py-3 px-3.5">Aktivitas &amp; Hasil</th>
                    <th className="py-3 px-3.5">Indikator Lapangan</th>
                    <th className="py-3 px-3.5">Status Verifikasi</th>
                    <th className="py-3 px-3.5 text-right">Aksi Persetujuan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2942]">
                  {loadingLogs ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-[#8B9BB4]">
                        Memuat riwayat catatan aktivitas harian...
                      </td>
                    </tr>
                  ) : filteredCatatanList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-[#8B9BB4]">
                        Belum ada catatan aktivitas harian. Silakan isi form di samping kiri.
                      </td>
                    </tr>
                  ) : (
                    filteredCatatanList.map((item) => {
                      const numId = Number(item.id);
                      const st = item.status_verifikasi || 'menunggu_asisten';
                      return (
                        <tr key={numId} className="hover:bg-[#131E33] transition-colors">
                          <td className="py-3 px-3.5">
                            <div className="font-bold text-white">{item.nama_blok}</div>
                            <div className="text-[10px] text-[#00D2FF] font-mono">
                              {item.tanggal_aktivitas} · {item.nama_afdeling || item.nama_kebun}
                            </div>
                            <div className="text-[10px] text-[#8B9BB4]">
                              Oleh: {item.nama_petugas || 'Mandor'}
                            </div>
                          </td>
                          <td className="py-3 px-3.5">
                            <div className="font-semibold text-[#E2E8F0]">{item.nama_aktivitas}</div>
                            <div className="text-[11px] font-mono text-emerald-400 font-bold">
                              {item.volume_hasil ? `${item.volume_hasil} ${item.satuan || 'Kg'}` : '-'}
                              {item.tenaga_kerja_hk ? ` · ${item.tenaga_kerja_hk} HK` : ''}
                            </div>
                            {item.catatan && (
                              <div className="text-[10px] text-[#8B9BB4] italic mt-0.5 max-w-[190px] truncate" title={item.catatan}>
                                &ldquo;{item.catatan}&rdquo;
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3.5 space-y-1">
                            <div className="text-[10.5px] text-[#E2E8F0] capitalize">
                              Kondisi: <strong className="text-white">{(item.kondisi_tanaman || 'sehat').replace('_', ' ')}</strong>
                            </div>
                            {(item.pusingan_petik || item.persen_peko) && (
                              <div className="text-[10px] font-mono text-[#8B9BB4]">
                                {item.pusingan_petik ? `Pusingan H-${item.pusingan_petik}` : ''}
                                {item.pusingan_petik && item.persen_peko ? ' · ' : ''}
                                {item.persen_peko ? `Peko ${item.persen_peko}%` : ''}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3.5">
                            {renderVerificationBadge(st)}
                          </td>
                          <td className="py-3 px-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {st === 'menunggu_asisten' && (
                                <button
                                  type="button"
                                  disabled={processingId === numId}
                                  onClick={() => handleVerifyCatatan(numId, 'diverifikasi_asisten')}
                                  className="px-2.5 py-1 rounded-lg bg-[#00D2FF]/15 hover:bg-[#00D2FF]/25 text-[#00D2FF] border border-[#00D2FF]/40 text-[10px] font-bold cursor-pointer"
                                  title="Konfirmasi Verifikasi tingkat Asisten Kebun"
                                >
                                  Verifikasi Asisten
                                </button>
                              )}
                              {(st === 'menunggu_asisten' || st === 'diverifikasi_asisten') && (
                                <button
                                  type="button"
                                  disabled={processingId === numId}
                                  onClick={() => handleVerifyCatatan(numId, 'disetujui_kepala_kebun')}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold cursor-pointer"
                                  title="Setujui (Approve) tingkat Kepala Kebun"
                                >
                                  Approve Kebun
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 2: LAPOR KENDALA LAPANGAN FLEKSIBEL (DASHBOARD & DIGITASI PETA)
          ===================================================================== */}
      {subTab === 'laporan_kendala' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Kolom Kiri: Form Lapor Kendala Lapangan */}
          <div className="lg:col-span-5 bg-[#101726] border border-[#1E2942] rounded-2xl p-5 space-y-4 self-start">
            <div className="border-b border-[#1E2942] pb-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                Pelaporan Masalah &amp; Insiden Kebun
              </span>
              <h3 className="text-sm font-bold text-white mt-1.5">
                Buat Laporan Kendala Lapangan
              </h3>
              <p className="text-[11px] text-[#8B9BB4] mt-0.5">
                Gunakan formulir ini atau gambar area langsung melalui tombol <strong>Digitasi &amp; Lapor Kendala</strong> di Kontrol Peta GIS.
              </p>
            </div>

            <form onSubmit={handleSubmitKendala} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Kategori Kendala Lapangan <span className="text-rose-400">*</span>
                </label>
                <select
                  value={kategoriKendala}
                  onChange={(e) => setKategoriKendala(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white"
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
                  Tingkat Urgensi <span className="text-rose-400">*</span>
                </label>
                <select
                  value={tingkatUrgensi}
                  onChange={(e) => setTingkatUrgensi(e.target.value as 'rendah' | 'sedang' | 'darurat')}
                  className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white font-semibold"
                >
                  <option value="rendah">🟢 Rendah (Pemeliharaan Rutin)</option>
                  <option value="sedang">🟡 Sedang (Perlu Penanganan Segera)</option>
                  <option value="darurat">🔴 Darurat / Kritis (Prioritas Utama)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Judul / Ringkasan Kendala <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={judulKendala}
                  onChange={(e) => setJudulKendala(e.target.value)}
                  placeholder="Contoh: Serangan Helopeltis Blok 04, Jalan Produksi Putus, Drainase Meluap..."
                  className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Unit Kebun
                  </label>
                  <select
                    disabled={isMandorLocked}
                    value={selectedKebunId || ''}
                    onChange={(e) => setSelectedKebunId(Number(e.target.value) || null)}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white disabled:opacity-60"
                  >
                    {kebunList.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.nama_kebun}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Blok Terkait
                  </label>
                  <select
                    value={selectedBlokId || ''}
                    onChange={(e) => setSelectedBlokId(Number(e.target.value) || null)}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white"
                  >
                    <option value="">-- Umum / Area Afdeling --</option>
                    {availableBloks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nama_blok}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Deskripsi Detail &amp; Kebutuhan Tindakan
                </label>
                <textarea
                  rows={3}
                  value={deskripsiKendala}
                  onChange={(e) => setDeskripsiKendala(e.target.value)}
                  placeholder="Jelaskan detail masalah di lapangan dan usulan penanganan..."
                  className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submittingKendala}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0A0E1A] font-bold text-xs shadow-md shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {submittingKendala ? 'Mengirim Laporan...' : 'Kirim Laporan ke Asisten & Kepala Kebun'}
              </button>
            </form>
          </div>

          {/* Kolom Kanan: Daftar Laporan Kendala & Konfirmasi Asisten -> Kepala Kebun */}
          <div className="lg:col-span-7 bg-[#101726] border border-[#1E2942] rounded-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-[#1E2942] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Daftar Laporan Kendala Lapangan (Dashboard &amp; Digitasi Peta)
                </h3>
                <p className="text-[11px] text-[#8B9BB4]">
                  Hierarki Persetujuan: Laporan Mandor → Konfirmasi Asisten Kebun → Approve Kepala Kebun
                </p>
              </div>
              <button
                type="button"
                onClick={fetchLogs}
                className="px-3 py-1.5 rounded-lg bg-[#131D31] hover:bg-[#1E2942] text-xs text-[#00D2FF] font-semibold cursor-pointer"
              >
                Segarkan
              </button>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#131D31] text-[#8B9BB4] text-[10px] font-bold uppercase border-b border-[#1E2942]">
                    <th className="py-3 px-3.5">Kendala &amp; Kategori</th>
                    <th className="py-3 px-3.5">Lokasi &amp; Geometri</th>
                    <th className="py-3 px-3.5">Urgensi</th>
                    <th className="py-3 px-3.5">Status Verifikasi</th>
                    <th className="py-3 px-3.5 text-right">Konfirmasi &amp; Approve</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2942]">
                  {loadingLogs ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-[#8B9BB4]">
                        Memuat daftar laporan kendala lapangan...
                      </td>
                    </tr>
                  ) : filteredKendalaList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-[#8B9BB4]">
                        Belum ada laporan kendala lapangan.
                      </td>
                    </tr>
                  ) : (
                    filteredKendalaList.map((item) => {
                      const numId = Number(item.id);
                      const st = item.status_verifikasi;
                      return (
                        <tr key={numId} className="hover:bg-[#131E33] transition-colors">
                          <td className="py-3 px-3.5">
                            <div className="font-bold text-white">{item.judul_kendala}</div>
                            <div className="text-[10px] text-amber-300 font-semibold uppercase mt-0.5">
                              {item.kategori_kendala.replace(/_/g, ' ')}
                            </div>
                            {item.deskripsi && (
                              <div className="text-[10.5px] text-[#8B9BB4] mt-0.5 max-w-xs">
                                {item.deskripsi}
                              </div>
                            )}
                            <div className="text-[10px] text-[#566680] mt-0.5">
                              Pelapor: {item.nama_pelapor || 'Mandor'}
                            </div>
                          </td>
                          <td className="py-3 px-3.5">
                            <div className="font-semibold text-[#E2E8F0]">
                              {item.nama_blok || item.nama_afdeling || item.nama_kebun || 'Area Kebun'}
                            </div>
                            <div className="text-[10px] text-[#8B9BB4]">
                              {item.nama_kebun} {item.nama_afdeling ? `· ${item.nama_afdeling}` : ''}
                            </div>
                            {Boolean(item.koordinat_geojson) && (
                              <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-[#00D2FF]/15 text-[#00D2FF] border border-[#00D2FF]/30 text-[9.5px] font-mono">
                                📍 Digitasi Peta {item.luas_area_ha ? `(${item.luas_area_ha} Ha)` : ''}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                                item.tingkat_urgensi === 'darurat'
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                  : item.tingkat_urgensi === 'sedang'
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              }`}
                            >
                              {item.tingkat_urgensi}
                            </span>
                          </td>
                          <td className="py-3 px-3.5">
                            {renderVerificationBadge(st)}
                          </td>
                          <td className="py-3 px-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {st === 'menunggu_asisten' && (
                                <button
                                  type="button"
                                  disabled={processingId === numId}
                                  onClick={() => handleVerifyKendala(numId, 'diverifikasi_asisten')}
                                  className="px-2.5 py-1 rounded-lg bg-[#00D2FF]/15 hover:bg-[#00D2FF]/25 text-[#00D2FF] border border-[#00D2FF]/40 text-[10px] font-bold cursor-pointer"
                                >
                                  Konfirmasi Asisten
                                </button>
                              )}
                              {(st === 'menunggu_asisten' || st === 'diverifikasi_asisten') && (
                                <button
                                  type="button"
                                  disabled={processingId === numId}
                                  onClick={() => handleVerifyKendala(numId, 'disetujui_kepala_kebun')}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold cursor-pointer"
                                >
                                  Approve Kepala Kebun
                                </button>
                              )}
                              {st === 'disetujui_kepala_kebun' && (
                                <button
                                  type="button"
                                  disabled={processingId === numId}
                                  onClick={() => handleVerifyKendala(numId, 'selesai')}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold cursor-pointer"
                                >
                                  Tandai Selesai
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
