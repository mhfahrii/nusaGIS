'use client';

import React, { useState, useMemo } from 'react';
import type { MasterAktivitas } from '@/types/perkebunan';

interface MasterAktivitasSectionProps {
  aktivitasList: MasterAktivitas[];
  loading: boolean;
  canEdit: boolean;
  onRefresh: () => Promise<void>;
  setBanner: (b: { type: 'success' | 'error'; text: string }) => void;
}

const KOMODITAS_OPTIONS = ['Semua', 'Teh', 'Kelapa Sawit', 'Tebu', 'Karet', 'Umum'] as const;
const KATEGORI_OPTIONS = [
  { value: 'semua', label: 'Semua Kategori' },
  { value: 'panen', label: 'Panen / Pemetikan' },
  { value: 'pemupukan', label: 'Pemupukan' },
  { value: 'pemeliharaan', label: 'Pemeliharaan Tanaman' },
  { value: 'hama_penyakit', label: 'Proteksi Hama & Penyakit' },
  { value: 'pangkas', label: 'Pemangkasan / Kastrasi' },
  { value: 'penyiraman', label: 'Penyiraman & Irigasi' },
  { value: 'pengolahan_tanah', label: 'Pengelolaan Lahan & Rorak' },
];

export default function MasterAktivitasSection({
  aktivitasList,
  loading,
  canEdit,
  onRefresh,
  setBanner,
}: MasterAktivitasSectionProps) {
  const [selectedKomoditas, setSelectedKomoditas] = useState<string>('Semua');
  const [selectedKategori, setSelectedKategori] = useState<string>('semua');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal State
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<MasterAktivitas | null>(null);
  const [formKode, setFormKode] = useState<string>('');
  const [formNama, setFormNama] = useState<string>('');
  const [formKomoditas, setFormKomoditas] = useState<string>('Teh');
  const [formKategori, setFormKategori] = useState<string>('panen');
  const [formSatuan, setFormSatuan] = useState<string>('Kg Pucuk Basah');
  const [formDeskripsi, setFormDeskripsi] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Filtered List
  const filteredList = useMemo(() => {
    return aktivitasList.filter((item) => {
      const matchKomoditas =
        selectedKomoditas === 'Semua' ||
        item.komoditas === selectedKomoditas ||
        item.komoditas === 'Umum';

      const matchKategori =
        selectedKategori === 'semua' || item.kategori === selectedKategori;

      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        item.nama_aktivitas.toLowerCase().includes(q) ||
        item.kode_aktivitas.toLowerCase().includes(q) ||
        (item.deskripsi && item.deskripsi.toLowerCase().includes(q));

      return matchKomoditas && matchKategori && matchSearch;
    });
  }, [aktivitasList, selectedKomoditas, selectedKategori, searchQuery]);

  const openAddModal = () => {
    setEditingItem(null);
    setFormKode('');
    setFormNama('');
    setFormKomoditas(selectedKomoditas !== 'Semua' ? selectedKomoditas : 'Teh');
    setFormKategori('panen');
    setFormSatuan('Kg Pucuk Basah');
    setFormDeskripsi('');
    setShowModal(true);
  };

  const openEditModal = (item: MasterAktivitas) => {
    setEditingItem(item);
    setFormKode(item.kode_aktivitas);
    setFormNama(item.nama_aktivitas);
    setFormKomoditas(item.komoditas);
    setFormKategori(item.kategori);
    setFormSatuan(item.satuan_hasil);
    setFormDeskripsi(item.deskripsi || '');
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNama.trim()) {
      setBanner({ type: 'error', text: 'Nama aktivitas wajib diisi.' });
      return;
    }

    setSubmitting(true);
    try {
      if (editingItem) {
        // PATCH
        const res = await fetch('/api/master-aktivitas', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingItem.id,
            nama_aktivitas: formNama.trim(),
            komoditas: formKomoditas,
            kategori: formKategori,
            satuan_hasil: formSatuan.trim(),
            deskripsi: formDeskripsi.trim() || null,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.message || 'Gagal memperbarui aktivitas.');
        setBanner({ type: 'success', text: `Aktivitas "${formNama}" berhasil diperbarui.` });
      } else {
        // POST
        const res = await fetch('/api/master-aktivitas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kode_aktivitas: formKode.trim() || undefined,
            nama_aktivitas: formNama.trim(),
            komoditas: formKomoditas,
            kategori: formKategori,
            satuan_hasil: formSatuan.trim(),
            deskripsi: formDeskripsi.trim() || null,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.message || 'Gagal menambahkan aktivitas.');
        setBanner({ type: 'success', text: `Aktivitas "${formNama}" berhasil ditambahkan ke master data.` });
      }

      setShowModal(false);
      await onRefresh();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Terjadi kesalahan sistem.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (item: MasterAktivitas) => {
    try {
      const res = await fetch('/api/master-aktivitas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          is_aktif: !item.is_aktif,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || 'Gagal mengubah status aktivitas.');
      setBanner({
        type: 'success',
        text: `Status aktivitas "${item.nama_aktivitas}" diubah menjadi ${!item.is_aktif ? 'Aktif' : 'Nonaktif'}.`,
      });
      await onRefresh();
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memperbarui status.',
      });
    }
  };

  const getKomoditasBadgeColor = (kom: string) => {
    switch (kom) {
      case 'Teh':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'Kelapa Sawit':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'Tebu':
        return 'bg-lime-500/15 text-lime-400 border-lime-500/30';
      case 'Karet':
        return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
      default:
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    }
  };

  const getKategoriBadgeColor = (kat: string) => {
    switch (kat) {
      case 'panen':
        return 'bg-green-500/10 text-green-300 border-green-500/20';
      case 'pemupukan':
        return 'bg-purple-500/10 text-purple-300 border-purple-500/20';
      case 'hama_penyakit':
        return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
      case 'pangkas':
        return 'bg-orange-500/10 text-orange-300 border-orange-500/20';
      default:
        return 'bg-slate-500/10 text-slate-300 border-slate-500/20';
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Deskripsi Mandat */}
      <div className="bg-[#101726] border border-[#1E2942] rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#00D2FF]/15 text-[#00D2FF] border border-[#00D2FF]/30">
                Unified Master Data
              </span>
              <span className="text-xs text-[#8B9BB4]">Katalog Agronomi Terpadu PT RPN</span>
            </div>
            <h2 className="text-lg font-bold text-white mt-1">Master Data Aktivitas Perkebunan</h2>
            <p className="text-xs text-[#8B9BB4] mt-0.5 max-w-2xl leading-relaxed">
              Seluruh perlakuan agronomi lintas komoditas (Teh Gamboeng, Sawit, Tebu, Karet) disatukan dalam satu pintu master data terpadu untuk kebutuhan pencatatan harian mandor dan analisis produktivitas.
            </p>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#00D2FF] to-[#0099FF] text-[#0A0E1A] font-bold text-xs shadow-md shadow-[#00D2FF]/20 hover:opacity-95 transition-all cursor-pointer whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
              </svg>
              Tambah Aktivitas
            </button>
          )}
        </div>

        {/* Filter Komoditas (Pill Buttons) */}
        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-[#1E2942] overflow-x-auto pb-1">
          <span className="text-xs text-[#8B9BB4] font-medium mr-1 whitespace-nowrap">Komoditas:</span>
          {KOMODITAS_OPTIONS.map((kom) => {
            const isSelected = selectedKomoditas === kom;
            const count =
              kom === 'Semua'
                ? aktivitasList.length
                : aktivitasList.filter((a) => a.komoditas === kom || (kom !== 'Umum' && a.komoditas === 'Umum')).length;

            return (
              <button
                key={kom}
                type="button"
                onClick={() => setSelectedKomoditas(kom)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap border flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#00D2FF]/20 text-[#00D2FF] border-[#00D2FF]/50 shadow-sm'
                    : 'bg-[#131D31] text-[#8B9BB4] border-[#1E2942] hover:text-white hover:border-[#2D3F66]'
                }`}
              >
                <span>{kom}</span>
                <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono ${isSelected ? 'bg-[#00D2FF]/30 text-white' : 'bg-[#0D1322] text-[#8B9BB4]'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter Bar & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <svg
              className="w-4 h-4 text-[#8B9BB4] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari aktivitas atau kode (misal: Petik, Pangkas, TEH-PTK)..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#101726] border border-[#1E2942] text-xs text-white placeholder-[#566680] focus:outline-none focus:border-[#00D2FF]"
            />
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs text-[#8B9BB4] hover:text-white px-2 py-1"
            >
              Reset
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedKategori}
            onChange={(e) => setSelectedKategori(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#101726] border border-[#1E2942] text-xs text-white focus:outline-none focus:border-[#00D2FF]"
          >
            {KATEGORI_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table Data */}
      <div className="bg-[#101726] border border-[#1E2942] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#131D31] text-[#8B9BB4] font-semibold uppercase tracking-wider text-[10px] border-b border-[#1E2942]">
                <th className="py-3 px-4">Kode</th>
                <th className="py-3 px-4">Nama Aktivitas</th>
                <th className="py-3 px-4">Komoditas</th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">Satuan Hasil</th>
                <th className="py-3 px-4">Deskripsi / Spesifikasi</th>
                <th className="py-3 px-4 text-center">Status</th>
                {canEdit && <th className="py-3 px-4 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2942]">
              {loading ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="py-12 text-center text-[#8B9BB4]">
                    Memuat daftar master data aktivitas...
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="py-12 text-center text-[#8B9BB4]">
                    Tidak ada aktivitas yang sesuai dengan filter.
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => (
                  <tr key={item.id} className="hover:bg-[#131E33] transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-[#00D2FF]">
                      {item.kode_aktivitas}
                    </td>
                    <td className="py-3 px-4 font-semibold text-white">
                      {item.nama_aktivitas}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${getKomoditasBadgeColor(item.komoditas)}`}>
                        {item.komoditas}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border capitalize ${getKategoriBadgeColor(item.kategori)}`}>
                        {item.kategori.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[#E2E8F0]">
                      {item.satuan_hasil}
                    </td>
                    <td className="py-3 px-4 text-[#8B9BB4] max-w-xs truncate" title={item.deskripsi || ''}>
                      {item.deskripsi || '-'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          item.is_aktif
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        }`}
                      >
                        {item.is_aktif ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="p-1.5 rounded-lg text-[#8B9BB4] hover:text-white hover:bg-[#1E2942] transition-colors"
                            title="Edit Aktivitas"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(item)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              item.is_aktif
                                ? 'text-amber-400 hover:bg-amber-500/10'
                                : 'text-emerald-400 hover:bg-emerald-500/10'
                            }`}
                            title={item.is_aktif ? 'Nonaktifkan' : 'Aktifkan'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {item.is_aktif ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                              )}
                            </svg>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="py-2.5 px-4 bg-[#131D31] border-t border-[#1E2942] flex items-center justify-between text-[11px] text-[#8B9BB4]">
          <span>Menampilkan {filteredList.length} dari {aktivitasList.length} aktivitas terdaftar</span>
          <span>Komoditas aktif: {selectedKomoditas}</span>
        </div>
      </div>

      {/* Modal Tambah / Edit Aktivitas */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#101726] border border-[#1E2942] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-[#1E2942] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  {editingItem ? 'Edit Master Data Aktivitas' : 'Tambah Master Data Aktivitas Baru'}
                </h3>
                <p className="text-[11px] text-[#8B9BB4] mt-0.5">
                  Lengkapi spesifikasi agronomi aktivitas perkebunan
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-[#8B9BB4] hover:text-white p-1 rounded-lg hover:bg-[#1E2942]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Komoditas
                  </label>
                  <select
                    value={formKomoditas}
                    onChange={(e) => setFormKomoditas(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white focus:outline-none focus:border-[#00D2FF]"
                  >
                    <option value="Teh">Teh (PPTK Gamboeng)</option>
                    <option value="Kelapa Sawit">Kelapa Sawit (PPKS)</option>
                    <option value="Tebu">Tebu (P3GI)</option>
                    <option value="Karet">Karet (PPK)</option>
                    <option value="Umum">Umum / Semua Komoditas</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Kategori Perlakuan
                  </label>
                  <select
                    value={formKategori}
                    onChange={(e) => setFormKategori(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white focus:outline-none focus:border-[#00D2FF]"
                  >
                    <option value="panen">Panen / Pemetikan</option>
                    <option value="pemupukan">Pemupukan</option>
                    <option value="pemeliharaan">Pemeliharaan Tanaman</option>
                    <option value="hama_penyakit">Proteksi Hama & Penyakit</option>
                    <option value="pangkas">Pemangkasan / Kastrasi</option>
                    <option value="penyiraman">Penyiraman & Irigasi</option>
                    <option value="pengolahan_tanah">Pengolahan Lahan / Rorak</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Nama Aktivitas <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formNama}
                  onChange={(e) => setFormNama(e.target.value)}
                  placeholder="Contoh: Petik Halus (P+1, P+2), Pemupukan NPK..."
                  className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white placeholder-[#566680] focus:outline-none focus:border-[#00D2FF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Kode Aktivitas (Opsional)
                  </label>
                  <input
                    type="text"
                    disabled={Boolean(editingItem)}
                    value={formKode}
                    onChange={(e) => setFormKode(e.target.value)}
                    placeholder="Auto-generate jika kosong"
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white placeholder-[#566680] focus:outline-none focus:border-[#00D2FF] font-mono disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Satuan Hasil <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formSatuan}
                    onChange={(e) => setFormSatuan(e.target.value)}
                    placeholder="Contoh: Kg Pucuk Basah, Ton TBS, Hektar..."
                    className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white placeholder-[#566680] focus:outline-none focus:border-[#00D2FF]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                  Deskripsi / Keterangan Teknis
                </label>
                <textarea
                  rows={2}
                  value={formDeskripsi}
                  onChange={(e) => setFormDeskripsi(e.target.value)}
                  placeholder="Keterangan standar operasional atau target mutu..."
                  className="w-full px-3 py-2 rounded-xl bg-[#131D31] border border-[#1E2942] text-xs text-white placeholder-[#566680] focus:outline-none focus:border-[#00D2FF]"
                />
              </div>

              <div className="pt-3 border-t border-[#1E2942] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl bg-[#131D31] text-[#8B9BB4] hover:text-white border border-[#1E2942] text-xs font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#00D2FF] to-[#0099FF] text-[#0A0E1A] font-bold text-xs shadow-md shadow-[#00D2FF]/20 hover:opacity-95 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Menyimpan...' : editingItem ? 'Simpan Perubahan' : 'Tambah Aktivitas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
