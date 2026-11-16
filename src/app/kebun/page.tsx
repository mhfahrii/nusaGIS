'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/DashboardLayout';
import { AdminOnly, WithAdmin } from '@/components/RoleGate';
import { Kebun } from '@/types/perkebunan';
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconSearch,
  IconRefresh,
  IconUpload,
  IconMap,
} from '@/components/icons';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AlertNotification } from '@/components/ui/AlertNotification';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';

export default function KebunPage() {
  const [data, setData] = useState<Kebun[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // State Modal Form (Tambah / Edit)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Kebun | null>(null);
  const [formData, setFormData] = useState({
    kode_kebun: '',
    nama_kebun: '',
    wilayah: '',
    komoditas: '',
    keterangan: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // State Modal Konfirmasi Hapus
  const [deleteTarget, setDeleteTarget] = useState<Kebun | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchKebun = useCallback(async () => {
    try {
      const res = await fetch('/api/kebun');
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal mengambil data kebun.');
      setData(json.data || []);
    } catch (err: unknown) {
      const error = err as Error;
      setNotification({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch('/api/kebun');
        const json = await res.json();
        if (!ignore) {
          if (!res.ok) throw new Error(json.message || 'Gagal mengambil data kebun.');
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
  }, []);

  function handleManualRefresh() {
    setLoading(true);
    fetchKebun();
  }

  // Filter pencarian berdasarkan Kode Kebun, Nama Kebun, Wilayah, dan Komoditas
  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(
      (k) =>
        k.kode_kebun.toLowerCase().includes(q) ||
        k.nama_kebun.toLowerCase().includes(q) ||
        (k.wilayah && k.wilayah.toLowerCase().includes(q)) ||
        (k.komoditas && k.komoditas.toLowerCase().includes(q))
    );
  }, [data, search]);

  // Buka Modal Tambah
  function handleOpenCreate() {
    setEditingItem(null);
    setFormData({
      kode_kebun: '',
      nama_kebun: '',
      wilayah: '',
      komoditas: 'Kelapa Sawit',
      keterangan: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  }

  // Buka Modal Edit
  function handleOpenEdit(item: Kebun) {
    setEditingItem(item);
    setFormData({
      kode_kebun: item.kode_kebun,
      nama_kebun: item.nama_kebun,
      wilayah: item.wilayah || '',
      komoditas: item.komoditas || '',
      keterangan: item.keterangan || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  }

  // Validasi Form
  function validateForm() {
    const errors: Record<string, string> = {};
    if (!formData.kode_kebun.trim()) {
      errors.kode_kebun = 'Kode kebun wajib diisi.';
    }
    if (!formData.nama_kebun.trim()) {
      errors.nama_kebun = 'Nama kebun wajib diisi.';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // Submit Form (Tambah / Edit)
  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setNotification(null);

    try {
      const isEdit = Boolean(editingItem);
      const url = '/api/kebun';
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
        throw new Error(json.message || 'Gagal menyimpan data kebun.');
      }

      setNotification({
        type: 'success',
        message: isEdit ? 'Data kebun berhasil diperbarui.' : 'Data kebun baru berhasil ditambahkan.',
      });
      setIsModalOpen(false);
      fetchKebun();
    } catch (err: unknown) {
      const error = err as Error;
      setNotification({ type: 'error', message: error.message });
    } finally {
      setSubmitting(false);
    }
  }

  // Eksekusi Hapus Kebun
  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setNotification(null);

    try {
      const res = await fetch(`/api/kebun?id=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Gagal menghapus kebun.');

      setNotification({
        type: 'success',
        message: `Kebun "${deleteTarget.nama_kebun}" berhasil dihapus.`,
      });
      setDeleteTarget(null);
      fetchKebun();
    } catch (err: unknown) {
      const error = err as Error;
      setNotification({ type: 'error', message: error.message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DashboardLayout
      title="Data Kebun"
      subtitle="Pengelolaan Master Data Tingkat Kebun (Estate) & Integrasi Spasial"
    >
      {notification && (
        <AlertNotification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      {/* Baris Kontrol: Pencarian & Tambah */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari kode, nama, wilayah, atau komoditas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          <button
            onClick={handleManualRefresh}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            title="Muat Ulang"
          >
            <IconRefresh className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          <Link
            href="/upload"
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
          >
            <IconUpload className="w-4 h-4" />
            <span>Upload Shapefile ZIP</span>
          </Link>

          <AdminOnly>
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <IconPlus className="w-4 h-4" />
              <span>Tambah Kebun</span>
            </button>
          </AdminOnly>
        </div>
      </div>

      {/* Tabel Data Kebun */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-6">
            <TableSkeleton rows={5} cols={6} />
          </div>
        ) : filteredData.length === 0 ? (
          <WithAdmin>
            {(isAdmin) => (
              <EmptyState
                title={search ? 'Hasil Pencarian Tidak Ditemukan' : 'Belum Ada Data Kebun'}
                description={
                  search
                    ? `Tidak ada kebun yang cocok dengan kata kunci "${search}".`
                    : 'Mulai dengan menambahkan data kebun pertama Anda pada tombol di bawah.'
                }
                actionLabel={search ? 'Reset Pencarian' : 'Tambah Kebun'}
                onAction={search ? () => setSearch('') : isAdmin ? handleOpenCreate : undefined}
              />
            )}
          </WithAdmin>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-6 py-3.5 w-12 text-center">No</th>
                  <th className="px-6 py-3.5">Kode Kebun</th>
                  <th className="px-6 py-3.5">Nama Kebun</th>
                  <th className="px-6 py-3.5">Wilayah</th>
                  <th className="px-6 py-3.5">Komoditas</th>
                  <th className="px-6 py-3.5">Keterangan</th>
                  <th className="px-6 py-3.5 text-center">Spasial GIS</th>
                  <AdminOnly>
                    <th className="px-6 py-3.5 text-center w-28">Aksi</th>
                  </AdminOnly>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredData.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-3.5 text-center text-slate-400 font-mono">{index + 1}</td>
                    <td className="px-6 py-3.5 font-bold text-emerald-700 tracking-wide">{item.kode_kebun}</td>
                    <td className="px-6 py-3.5 font-medium text-slate-900">{item.nama_kebun}</td>
                    <td className="px-6 py-3.5 text-slate-600">{item.wilayah || '-'}</td>
                    <td className="px-6 py-3.5">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                        {item.komoditas || 'Umum'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-slate-500 max-w-xs truncate">{item.keterangan || '-'}</td>
                    <td className="px-6 py-3.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Link
                          href={`/upload?kebun_id=${item.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[11px] font-medium transition-colors"
                          title="Upload Shapefile ZIP untuk Kebun ini"
                        >
                          <IconUpload className="w-3.5 h-3.5" />
                          <span>Upload ZIP</span>
                        </Link>
                        <Link
                          href={`/?kebun_id=${item.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-[11px] font-medium transition-colors"
                          title="Lihat Kebun di GIS Workspace"
                        >
                          <IconMap className="w-3.5 h-3.5" />
                          <span>Peta</span>
                        </Link>
                      </div>
                    </td>
                    <AdminOnly>
                      <td className="px-6 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(item)}
                            className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors cursor-pointer"
                            title="Edit Kebun"
                          >
                            <IconPencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(item)}
                            className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                            title="Hapus Kebun"
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

      {/* Modal Form Tambah / Edit Kebun */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !submitting && setIsModalOpen(false)}
        title={editingItem ? 'Edit Data Kebun' : 'Tambah Kebun Baru'}
      >
        <form onSubmit={handleSubmitForm} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Kode Kebun <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Contoh: KBN-01"
              value={formData.kode_kebun}
              onChange={(e) => setFormData({ ...formData, kode_kebun: e.target.value })}
              className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                formErrors.kode_kebun
                  ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                  : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
              }`}
            />
            {formErrors.kode_kebun && (
              <p className="text-[11px] text-rose-500 mt-1">{formErrors.kode_kebun}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nama Kebun <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Contoh: Kebun Percobaan A"
              value={formData.nama_kebun}
              onChange={(e) => setFormData({ ...formData, nama_kebun: e.target.value })}
              className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                formErrors.nama_kebun
                  ? 'border-rose-400 focus:ring-rose-200 bg-rose-50/20'
                  : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
              }`}
            />
            {formErrors.nama_kebun && (
              <p className="text-[11px] text-rose-500 mt-1">{formErrors.nama_kebun}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Wilayah / Regional</label>
              <input
                type="text"
                placeholder="Contoh: Kampar, Riau"
                value={formData.wilayah}
                onChange={(e) => setFormData({ ...formData, wilayah: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Komoditas Utama</label>
              <input
                type="text"
                placeholder="Contoh: Kelapa Sawit"
                value={formData.komoditas}
                onChange={(e) => setFormData({ ...formData, komoditas: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Keterangan Tambahan</label>
            <textarea
              rows={3}
              placeholder="Catatan mengenai kebun..."
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
              {submitting ? 'Menyimpan...' : editingItem ? 'Simpan Perubahan' : 'Tambah Kebun'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Konfirmasi Hapus Kebun */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Konfirmasi Hapus Kebun"
        message={`Apakah Anda yakin ingin menghapus kebun "${deleteTarget?.nama_kebun}" (${deleteTarget?.kode_kebun})? Tindakan ini akan menghapus seluruh data afdeling dan blok yang berada di bawahnya secara otomatis.`}
        confirmLabel="Hapus Kebun"
        cancelLabel="Batal"
        isLoading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </DashboardLayout>
  );
}
