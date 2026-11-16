'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { AdminOnly, WithAdmin } from '@/components/RoleGate';
import { Afdeling, Kebun } from '@/types/perkebunan';
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

interface AfdelingWithKebun extends Afdeling {
  nama_kebun?: string;
}

export default function AfdelingPage() {
  const [data, setData] = useState<AfdelingWithKebun[]>([]);
  const [kebunList, setKebunList] = useState<Kebun[]>([]);
  const [selectedKebunFilter, setSelectedKebunFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modal Tambah / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AfdelingWithKebun | null>(null);
  const [formData, setFormData] = useState({
    kebun_id: '',
    kode_afdeling: '',
    nama_afdeling: '',
    keterangan: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Modal Hapus
  const [deleteTarget, setDeleteTarget] = useState<AfdelingWithKebun | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Ambil daftar kebun untuk dropdown
  const fetchKebunList = useCallback(async () => {
    try {
      const res = await fetch('/api/kebun');
      const json = await res.json();
      if (res.ok) setKebunList(json.data || []);
    } catch {
      // ignore
    }
  }, []);

  // Ambil daftar afdeling (dengan filter kebun jika dipilih)
  const fetchAfdeling = useCallback(async () => {
    try {
      const url = selectedKebunFilter
        ? `/api/afdeling?kebun_id=${selectedKebunFilter}`
        : '/api/afdeling';
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal memuat data afdeling.');
      setData(json.data || []);
    } catch (err: unknown) {
      const error = err as Error;
      setNotification({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }, [selectedKebunFilter]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch('/api/kebun');
        const json = await res.json();
        if (!ignore && res.ok) {
          setKebunList(json.data || []);
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
        const url = selectedKebunFilter
          ? `/api/afdeling?kebun_id=${selectedKebunFilter}`
          : '/api/afdeling';
        const res = await fetch(url);
        const json = await res.json();
        if (!ignore) {
          if (!res.ok) throw new Error(json.message || 'Gagal memuat data afdeling.');
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
  }, [selectedKebunFilter]);

  function handleManualRefresh() {
    setLoading(true);
    fetchKebunList();
    fetchAfdeling();
  }

  // Filter teks pencarian
  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(
      (a) =>
        a.kode_afdeling.toLowerCase().includes(q) ||
        a.nama_afdeling.toLowerCase().includes(q) ||
        (a.nama_kebun && a.nama_kebun.toLowerCase().includes(q))
    );
  }, [data, search]);

  function handleOpenCreate() {
    setEditingItem(null);
    setFormData({
      kebun_id: selectedKebunFilter || (kebunList[0]?.id ? String(kebunList[0].id) : ''),
      kode_afdeling: '',
      nama_afdeling: '',
      keterangan: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  }

  function handleOpenEdit(item: AfdelingWithKebun) {
    setEditingItem(item);
    setFormData({
      kebun_id: String(item.kebun_id),
      kode_afdeling: item.kode_afdeling,
      nama_afdeling: item.nama_afdeling,
      keterangan: item.keterangan || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  }

  function validateForm() {
    const errors: Record<string, string> = {};
    if (!formData.kebun_id) {
      errors.kebun_id = 'Kebun induk wajib dipilih.';
    }
    if (!formData.kode_afdeling.trim()) {
      errors.kode_afdeling = 'Kode afdeling wajib diisi.';
    }
    if (!formData.nama_afdeling.trim()) {
      errors.nama_afdeling = 'Nama afdeling wajib diisi.';
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
      const url = '/api/afdeling';
      const method = isEdit ? 'PATCH' : 'POST';
      const payload = isEdit
        ? { id: editingItem?.id, ...formData }
        : formData;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Gagal menyimpan data afdeling.');
      }

      setNotification({
        type: 'success',
        message: isEdit ? 'Data afdeling berhasil diperbarui.' : 'Data afdeling baru berhasil ditambahkan.',
      });
      setIsModalOpen(false);
      fetchAfdeling();
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
      const res = await fetch(`/api/afdeling?id=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal menghapus afdeling.');

      setNotification({
        type: 'success',
        message: `Afdeling "${deleteTarget.nama_afdeling}" berhasil dihapus.`,
      });
      setDeleteTarget(null);
      fetchAfdeling();
    } catch (err: unknown) {
      const error = err as Error;
      setNotification({ type: 'error', message: error.message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DashboardLayout
      title="Data Afdeling"
      subtitle="Pengelolaan Divisi Operasional (Afdeling) di Bawah Kebun"
    >
      {notification && (
        <AlertNotification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      {/* Baris Kontrol: Filter Kebun, Pencarian, & Tambah */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          {/* Filter Dropdown Kebun */}
          <div className="w-full sm:w-56">
            <select
              value={selectedKebunFilter}
              onChange={(e) => setSelectedKebunFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors font-medium text-slate-700"
            >
              <option value="">Semua Kebun Induk</option>
              {kebunList.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.kode_kebun} - {k.nama_kebun}
                </option>
              ))}
            </select>
          </div>

          {/* Pencarian */}
          <div className="relative w-full sm:w-64">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari kode atau nama..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
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
              disabled={kebunList.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <IconPlus className="w-4 h-4" />
              <span>Tambah Afdeling</span>
            </button>
          </AdminOnly>
        </div>
      </div>

      {kebunList.length === 0 && !loading && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center justify-between">
          <span>⚠️ Belum ada Kebun yang terdaftar. Anda harus menambahkan Kebun terlebih dahulu sebelum membuat Afdeling.</span>
        </div>
      )}

      {/* Tabel Data Afdeling */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-6">
            <TableSkeleton rows={5} cols={5} />
          </div>
        ) : filteredData.length === 0 ? (
          <WithAdmin>
            {(isAdmin) => (
              <EmptyState
                title={search || selectedKebunFilter ? 'Data Tidak Ditemukan' : 'Belum Ada Data Afdeling'}
                description={
                  search || selectedKebunFilter
                    ? 'Tidak ada afdeling yang cocok dengan kriteria filter saat ini.'
                    : 'Mulai dengan menambahkan data afdeling baru pada kebun pilihan Anda.'
                }
                actionLabel={search || selectedKebunFilter ? 'Reset Filter' : 'Tambah Afdeling'}
                onAction={
                  search || selectedKebunFilter
                    ? () => {
                        setSearch('');
                        setSelectedKebunFilter('');
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
                  <th className="px-6 py-3.5">Kebun Induk</th>
                  <th className="px-6 py-3.5">Kode Afdeling</th>
                  <th className="px-6 py-3.5">Nama Afdeling</th>
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
                    <td className="px-6 py-3.5 font-medium text-slate-900">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {item.nama_kebun || `Kebun #${item.kebun_id}`}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 font-bold text-emerald-700 tracking-wide">{item.kode_afdeling}</td>
                    <td className="px-6 py-3.5 font-medium text-slate-800">{item.nama_afdeling}</td>
                    <td className="px-6 py-3.5 text-slate-500 max-w-xs truncate">{item.keterangan || '-'}</td>
                    <AdminOnly>
                      <td className="px-6 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(item)}
                            className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors cursor-pointer"
                            title="Edit Afdeling"
                          >
                            <IconPencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(item)}
                            className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                            title="Hapus Afdeling"
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

      {/* Modal Form Tambah / Edit Afdeling */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !submitting && setIsModalOpen(false)}
        title={editingItem ? 'Edit Data Afdeling' : 'Tambah Afdeling Baru'}
      >
        <form onSubmit={handleSubmitForm} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Kebun Induk <span className="text-rose-500">*</span>
            </label>
            <select
              value={formData.kebun_id}
              onChange={(e) => setFormData({ ...formData, kebun_id: e.target.value })}
              className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                formErrors.kebun_id
                  ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                  : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
              }`}
            >
              <option value="">-- Pilih Kebun Induk --</option>
              {kebunList.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.kode_kebun} - {k.nama_kebun}
                </option>
              ))}
            </select>
            {formErrors.kebun_id && (
              <p className="text-[11px] text-rose-500 mt-1">{formErrors.kebun_id}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Kode Afdeling <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Contoh: AFD-01"
              value={formData.kode_afdeling}
              onChange={(e) => setFormData({ ...formData, kode_afdeling: e.target.value })}
              className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                formErrors.kode_afdeling
                  ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                  : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
              }`}
            />
            {formErrors.kode_afdeling && (
              <p className="text-[11px] text-rose-500 mt-1">{formErrors.kode_afdeling}</p>
            )}
            <p className="text-[11px] text-slate-400 mt-0.5">Kode unik dalam satu kebun induk yang sama.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nama Afdeling <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Contoh: Afdeling I Rayon Utara"
              value={formData.nama_afdeling}
              onChange={(e) => setFormData({ ...formData, nama_afdeling: e.target.value })}
              className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                formErrors.nama_afdeling
                  ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                  : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
              }`}
            />
            {formErrors.nama_afdeling && (
              <p className="text-[11px] text-rose-500 mt-1">{formErrors.nama_afdeling}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Keterangan</label>
            <textarea
              rows={3}
              placeholder="Catatan mengenai afdeling..."
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
              {submitting ? 'Menyimpan...' : editingItem ? 'Simpan Perubahan' : 'Tambah Afdeling'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Konfirmasi Hapus */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Konfirmasi Hapus Afdeling"
        message={`Apakah Anda yakin ingin menghapus afdeling "${deleteTarget?.nama_afdeling}" (${deleteTarget?.kode_afdeling})? Seluruh data blok di bawah afdeling ini juga akan dihapus secara bertingkat.`}
        confirmLabel="Hapus Afdeling"
        cancelLabel="Batal"
        isLoading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </DashboardLayout>
  );
}
