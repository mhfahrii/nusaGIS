'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { AdminOnly, WithAdmin } from '@/components/RoleGate';
import { Blok, Afdeling, Kebun } from '@/types/perkebunan';
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconSearch,
  IconRefresh,
} from '@/components/icons';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AlertNotification } from '@/components/ui/AlertNotification';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';

interface BlokWithDetails extends Blok {
  nama_afdeling?: string;
  nama_kebun?: string;
}

export default function BlokPage() {
  const [data, setData] = useState<BlokWithDetails[]>([]);
  const [kebunList, setKebunList] = useState<Kebun[]>([]);
  const [afdelingList, setAfdelingList] = useState<Afdeling[]>([]);

  // Filter Bertingkat
  const [filterKebun, setFilterKebun] = useState<string>('');
  const [filterAfdeling, setFilterAfdeling] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modal Tambah / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BlokWithDetails | null>(null);
  const [formData, setFormData] = useState({
    afdeling_id: '',
    kode_blok: '',
    nama_blok: '',
    komoditas: '',
    tahun_tanam: '',
    keterangan: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Modal Hapus
  const [deleteTarget, setDeleteTarget] = useState<BlokWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filter bertingkat opsi afdeling dihitung dengan useMemo
  const filteredAfdelingOptions = useMemo(() => {
    if (!filterKebun) return afdelingList;
    return afdelingList.filter((a) => String(a.kebun_id) === String(filterKebun));
  }, [filterKebun, afdelingList]);

  // Ambil daftar kebun dan seluruh afdeling
  const fetchFilterMasters = useCallback(async () => {
    try {
      const [kebunRes, afdRes] = await Promise.all([
        fetch('/api/kebun'),
        fetch('/api/afdeling'),
      ]);
      const [kebunJson, afdJson] = await Promise.all([kebunRes.json(), afdRes.json()]);

      if (kebunRes.ok) setKebunList(kebunJson.data || []);
      if (afdRes.ok) setAfdelingList(afdJson.data || []);
    } catch {
      // ignore
    }
  }, []);

  // Ambil data blok (dengan filter afdeling jika dipilih)
  const fetchBlok = useCallback(async () => {
    try {
      const url = filterAfdeling ? `/api/blok?afdeling_id=${filterAfdeling}` : '/api/blok';
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal memuat data blok.');
      setData(json.data || []);
    } catch (err: unknown) {
      const error = err as Error;
      setNotification({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }, [filterAfdeling]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const [kebunRes, afdRes] = await Promise.all([
          fetch('/api/kebun'),
          fetch('/api/afdeling'),
        ]);
        const [kebunJson, afdJson] = await Promise.all([kebunRes.json(), afdRes.json()]);

        if (!ignore) {
          if (kebunRes.ok) setKebunList(kebunJson.data || []);
          if (afdRes.ok) setAfdelingList(afdJson.data || []);
        }
      } catch {
        // ignore
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const url = filterAfdeling ? `/api/blok?afdeling_id=${filterAfdeling}` : '/api/blok';
        const res = await fetch(url);
        const json = await res.json();
        if (!ignore) {
          if (!res.ok) throw new Error(json.message || 'Gagal memuat data blok.');
          setData(json.data || []);
        }
      } catch (err: unknown) {
        if (!ignore) {
          const error = err as Error;
          setNotification({ type: 'error', message: error.message });
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [filterAfdeling]);

  function handleManualRefresh() {
    setLoading(true);
    fetchFilterMasters();
    fetchBlok();
  }

  // Filter teks pencarian dan filter kebun jika afdeling tidak spesifik dipilih
  const filteredData = useMemo(() => {
    return data.filter((b) => {
      // Filter kebun jika filterKebun dipilih tapi filterAfdeling kosong
      if (filterKebun && !filterAfdeling) {
        const afd = afdelingList.find((a) => String(a.id) === String(b.afdeling_id));
        if (!afd || String(afd.kebun_id) !== String(filterKebun)) {
          return false;
        }
      }

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        b.kode_blok.toLowerCase().includes(q) ||
        b.nama_blok.toLowerCase().includes(q) ||
        (b.komoditas && b.komoditas.toLowerCase().includes(q)) ||
        (b.nama_afdeling && b.nama_afdeling.toLowerCase().includes(q)) ||
        (b.nama_kebun && b.nama_kebun.toLowerCase().includes(q)) ||
        (b.tahun_tanam && String(b.tahun_tanam).includes(q))
      );
    });
  }, [data, filterKebun, filterAfdeling, afdelingList, search]);

  function handleOpenCreate() {
    setEditingItem(null);
    setFormData({
      afdeling_id: filterAfdeling || (filteredAfdelingOptions[0]?.id ? String(filteredAfdelingOptions[0].id) : ''),
      kode_blok: '',
      nama_blok: '',
      komoditas: 'Kelapa Sawit',
      tahun_tanam: new Date().getFullYear().toString(),
      keterangan: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  }

  function handleOpenEdit(item: BlokWithDetails) {
    setEditingItem(item);
    setFormData({
      afdeling_id: String(item.afdeling_id),
      kode_blok: item.kode_blok,
      nama_blok: item.nama_blok,
      komoditas: item.komoditas || '',
      tahun_tanam: item.tahun_tanam ? String(item.tahun_tanam) : '',
      keterangan: item.keterangan || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  }

  function validateForm() {
    const errors: Record<string, string> = {};
    if (!formData.afdeling_id) {
      errors.afdeling_id = 'Afdeling induk wajib dipilih.';
    }
    if (!formData.kode_blok.trim()) {
      errors.kode_blok = 'Kode blok wajib diisi.';
    }
    if (!formData.nama_blok.trim()) {
      errors.nama_blok = 'Nama blok wajib diisi.';
    }
    if (formData.tahun_tanam) {
      const year = parseInt(formData.tahun_tanam, 10);
      if (isNaN(year) || year < 1900 || year > 2100) {
        errors.tahun_tanam = 'Tahun tanam harus berupa angka 1900 - 2100.';
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setNotification(null);

    try {
      const isEdit = Boolean(editingItem);
      const url = '/api/blok';
      const method = isEdit ? 'PATCH' : 'POST';
      const payload = {
        ...(isEdit ? { id: editingItem?.id } : {}),
        afdeling_id: parseInt(formData.afdeling_id, 10),
        kode_blok: formData.kode_blok.trim(),
        nama_blok: formData.nama_blok.trim(),
        komoditas: formData.komoditas.trim() || null,
        tahun_tanam: formData.tahun_tanam ? parseInt(formData.tahun_tanam, 10) : null,
        keterangan: formData.keterangan.trim() || null,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Gagal menyimpan data blok.');
      }

      setNotification({
        type: 'success',
        message: isEdit ? 'Data blok berhasil diperbarui.' : 'Data blok baru berhasil ditambahkan.',
      });
      setIsModalOpen(false);
      fetchBlok();
    } catch (err: unknown) {
      const error = err as Error;
      setNotification({ type: 'error', message: error.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setNotification(null);

    try {
      const res = await fetch(`/api/blok?id=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal menghapus blok.');

      setNotification({
        type: 'success',
        message: `Blok "${deleteTarget.nama_blok}" berhasil dihapus.`,
      });
      setDeleteTarget(null);
      fetchBlok();
    } catch (err: unknown) {
      const error = err as Error;
      setNotification({ type: 'error', message: error.message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DashboardLayout
      title="Data Blok Tanaman"
      subtitle="Pengelolaan Petak Blok Tanaman (Blok) di Bawah Afdeling"
    >
      {notification && (
        <AlertNotification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      {/* Baris Kontrol: Filter Bertingkat, Pencarian, & Tambah */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs mb-6 flex flex-col xl:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full xl:w-auto">
          {/* Filter 1: Dropdown Kebun */}
          <div className="w-full sm:w-48">
            <select
              value={filterKebun}
              onChange={(e) => setFilterKebun(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors font-medium text-slate-700"
            >
              <option value="">Semua Kebun</option>
              {kebunList.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.kode_kebun} - {k.nama_kebun}
                </option>
              ))}
            </select>
          </div>

          {/* Filter 2: Dropdown Afdeling (Bertingkat) */}
          <div className="w-full sm:w-52">
            <select
              value={filterAfdeling}
              onChange={(e) => setFilterAfdeling(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors font-medium text-slate-700"
            >
              <option value="">Semua Afdeling</option>
              {filteredAfdelingOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kode_afdeling} - {a.nama_afdeling}
                </option>
              ))}
            </select>
          </div>

          {/* Pencarian */}
          <div className="relative w-full sm:w-60">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari blok, tahun, dll..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full xl:w-auto justify-end">
          <button
            onClick={handleManualRefresh}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            title="Muat Ulang"
          >
            <IconRefresh className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          <AdminOnly>
            <button
              onClick={handleOpenCreate}
              disabled={afdelingList.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <IconPlus className="w-4 h-4" />
              <span>Tambah Blok</span>
            </button>
          </AdminOnly>
        </div>
      </div>

      {afdelingList.length === 0 && !loading && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          ⚠️ Belum ada Afdeling yang terdaftar. Anda harus membuat Kebun dan Afdeling terlebih dahulu sebelum menambahkan data Blok.
        </div>
      )}

      {/* Tabel Data Blok */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-6">
            <TableSkeleton rows={5} cols={7} />
          </div>
        ) : filteredData.length === 0 ? (
          <WithAdmin>
            {(isAdmin) => (
              <EmptyState
                title={search || filterKebun || filterAfdeling ? 'Data Tidak Ditemukan' : 'Belum Ada Data Blok'}
                description={
                  search || filterKebun || filterAfdeling
                    ? 'Tidak ada petak blok yang cocok dengan kriteria filter saat ini.'
                    : 'Mulai dengan menambahkan data blok tanaman baru pada afdeling yang tersedia.'
                }
                actionLabel={search || filterKebun || filterAfdeling ? 'Reset Filter' : 'Tambah Blok'}
                onAction={
                  search || filterKebun || filterAfdeling
                    ? () => {
                        setSearch('');
                        setFilterKebun('');
                        setFilterAfdeling('');
                      }
                    : isAdmin
                      ? handleOpenCreate
                      : undefined
                }
              />
            )}
          </WithAdmin>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-6 py-3.5 w-12 text-center">No</th>
                  <th className="px-6 py-3.5">Hierarki Induk</th>
                  <th className="px-6 py-3.5">Kode Blok</th>
                  <th className="px-6 py-3.5">Nama Blok</th>
                  <th className="px-6 py-3.5">Komoditas</th>
                  <th className="px-6 py-3.5 text-center">Tahun Tanam</th>
                  <th className="px-6 py-3.5">Keterangan</th>
                  <AdminOnly>
                    <th className="px-6 py-3.5 text-center w-28">Aksi</th>
                  </AdminOnly>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredData.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-3.5 text-center text-slate-400 font-mono">{index + 1}</td>
                    <td className="px-6 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-800">{item.nama_afdeling || `Afdeling #${item.afdeling_id}`}</span>
                        <span className="text-[11px] text-slate-400">{item.nama_kebun || 'Kebun Induk'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 font-bold text-emerald-700 tracking-wide">{item.kode_blok}</td>
                    <td className="px-6 py-3.5 font-medium text-slate-900">{item.nama_blok}</td>
                    <td className="px-6 py-3.5">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                        {item.komoditas || 'Umum'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-center font-mono font-medium text-slate-700">
                      {item.tahun_tanam ? (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700">
                          {item.tahun_tanam}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-slate-500 max-w-xs truncate">{item.keterangan || '-'}</td>
                    <AdminOnly>
                      <td className="px-6 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(item)}
                            className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors cursor-pointer"
                            title="Edit Blok"
                          >
                            <IconPencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(item)}
                            className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                            title="Hapus Blok"
                          >
                            <IconTrash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </AdminOnly>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Form Tambah / Edit Blok */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !submitting && setIsModalOpen(false)}
        title={editingItem ? 'Edit Data Blok' : 'Tambah Blok Baru'}
      >
        <form onSubmit={handleSubmitForm} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Afdeling Induk <span className="text-rose-500">*</span>
            </label>
            <select
              value={formData.afdeling_id}
              onChange={(e) => setFormData({ ...formData, afdeling_id: e.target.value })}
              className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                formErrors.afdeling_id
                  ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                  : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
              }`}
            >
              <option value="">-- Pilih Afdeling Induk --</option>
              {afdelingList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kode_afdeling} - {a.nama_afdeling}
                </option>
              ))}
            </select>
            {formErrors.afdeling_id && (
              <p className="text-[11px] text-rose-500 mt-1">{formErrors.afdeling_id}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Kode Blok <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: BLK-A01"
                value={formData.kode_blok}
                onChange={(e) => setFormData({ ...formData, kode_blok: e.target.value })}
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                  formErrors.kode_blok
                    ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                    : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
                }`}
              />
              {formErrors.kode_blok && (
                <p className="text-[11px] text-rose-500 mt-1">{formErrors.kode_blok}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Blok <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: Blok A01 Primadona"
                value={formData.nama_blok}
                onChange={(e) => setFormData({ ...formData, nama_blok: e.target.value })}
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                  formErrors.nama_blok
                    ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                    : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
                }`}
              />
              {formErrors.nama_blok && (
                <p className="text-[11px] text-rose-500 mt-1">{formErrors.nama_blok}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Komoditas</label>
              <input
                type="text"
                placeholder="Contoh: Kelapa Sawit"
                value={formData.komoditas}
                onChange={(e) => setFormData({ ...formData, komoditas: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tahun Tanam</label>
              <input
                type="number"
                placeholder="Contoh: 2021"
                min={1900}
                max={2100}
                value={formData.tahun_tanam}
                onChange={(e) => setFormData({ ...formData, tahun_tanam: e.target.value })}
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                  formErrors.tahun_tanam
                    ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                    : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
                }`}
              />
              {formErrors.tahun_tanam && (
                <p className="text-[11px] text-rose-500 mt-1">{formErrors.tahun_tanam}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Keterangan</label>
            <textarea
              rows={3}
              placeholder="Catatan mengenai kondisi petak blok..."
              value={formData.keterangan}
              onChange={(e) => setFormData({ ...formData, keterangan: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : editingItem ? 'Simpan Perubahan' : 'Tambah Blok'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Konfirmasi Hapus */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Konfirmasi Hapus Blok"
        message={`Apakah Anda yakin ingin menghapus blok "${deleteTarget?.nama_blok}" (${deleteTarget?.kode_blok})?`}
        confirmLabel="Hapus Blok"
        cancelLabel="Batal"
        isLoading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </DashboardLayout>
  );
}
