import React from 'react';
import type { HakAksesFitur, Peran } from '@/types/auth';

export type MenuKey =
  | 'hasil_analisa'
  | 'catatan_harian'
  | 'data_makro'
  | 'data_perusahaan'
  | 'data_kebun'
  | 'master_aktivitas'
  | 'hak_sementara'
  | 'manajemen_pengguna'
  | 'create_account'
  | 'log_audit'
  | 'backup_riwayat';

export type JenisHakSementara = 'upload_layer' | 'edit_data';
export type StatusHakSementara = 'pending' | 'disetujui' | 'ditolak' | 'dicabut';

export interface PermintaanHakSementaraRecord {
  id: number;
  pengguna_id: number;
  nama_pengguna: string;
  email: string;
  foto_profil: string | null;
  peran: string;
  jenis_hak: JenisHakSementara;
  alasan: string | null;
  status: StatusHakSementara;
  dikonfirmasi_oleh: number | null;
  nama_konfirmator: string | null;
  dibuat_pada: string;
  diperbarui_pada: string;
}

export interface KaryawanItem {
  id: number;
  kode_karyawan: string;
  nama: string;
  email: string;
  peran: Peran;
  aktif: boolean;
  afdeling_id?: number | null;
  kebun_id?: number | null;
  afdeling_nama?: string | null;
  kebun_nama?: string | null;
  hak_akses: HakAksesFitur;
  foto_profil?: string | null;
  dibuat_pada: string | null;
}

export interface KebunRecord {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  perusahaan: string | null;
  wilayah: string | null;
  provinsi?: string | null;
  kabupaten_kota?: string | null;
  komoditas: string | null;
  keterangan: string | null;
  dibuat_pada: string | null;
}

export interface AfdelingRecord {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
  keterangan: string | null;
  dibuat_pada: string | null;
}

export interface AuditLogRecord {
  id: number;
  aktivitas: string;
  keterangan: string | null;
  dibuat_pada: string;
  nama_pengguna: string;
  role: string;
}

export interface PermissionMeta {
  key: keyof HakAksesFitur;
  title: string;
  description: string;
  shortLabel: string;
}

export const PERMISSION_ITEMS: PermissionMeta[] = [
  {
    key: 'lihat_peta',
    title: 'Lihat Peta & Statistik Spasial',
    description: 'Mengakses dashboard peta GIS, filter wilayah/kebun, dan grafik analisis atribut.',
    shortLabel: 'Lihat Peta',
  },
  {
    key: 'upload_layer',
    title: 'Upload & Import Layer GIS',
    description: 'Mengunggah file ZIP Shapefile, GeoJSON, atau GeoTIFF baru ke dalam PostGIS.',
    shortLabel: 'Upload Layer',
  },
  {
    key: 'edit_data',
    title: 'Edit Atribut, Poligon & Kebun',
    description: 'Mengubah nama layer, mengedit atribut poligon blok/kebun, dan menambah petak.',
    shortLabel: 'Edit Data',
  },
  {
    key: 'hapus_data',
    title: 'Hapus Layer, Wilayah & Fitur',
    description: 'Memindahkan layer atau wilayah ke tempat sampah serta mengelola penghapusan permanen.',
    shortLabel: 'Hapus Data',
  },
  {
    key: 'kelola_karyawan',
    title: 'Kelola Akun Pengguna & Hak Akses',
    description: 'Membuat akun baru (Create Account), mengatur hak akses, dan mereset password.',
    shortLabel: 'Kelola Pengguna',
  },
];

export function resizeImageToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File yang dipilih harus berupa gambar (JPG, PNG, atau WebP).'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('Ukuran file gambar maksimal 10 MB.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Gagal memproses gambar di browser.'));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Gagal memuat file gambar.'));
    reader.readAsDataURL(file);
  });
}

export function IconUsers({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconUserPlus({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  );
}

export function IconGlobeMap({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

export function IconChartBar({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function IconBuilding({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </svg>
  );
}

export function IconCamera({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function IconLogoutExit({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function IconShieldKey({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <circle cx="12" cy="11" r="2" />
      <path d="M12 13v3" />
    </svg>
  );
}

export function formatTanggal(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function formatWaktuLengkap(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function classifyAuditBadge(aktivitas: string): {
  label: string;
  category: 'upload' | 'delete' | 'account' | 'kebun' | 'auth' | 'other';
  className: string;
} {
  const act = (aktivitas || '').toLowerCase();
  if (act.includes('upload') || act.includes('impor')) {
    return {
      label: 'Upload Data GIS',
      category: 'upload',
      className: 'bg-[#00D2FF]/15 text-[#00D2FF] border-[#00D2FF]/40',
    };
  }
  if (act.includes('hapus') || act.includes('delete') || act.includes('empty_trash')) {
    return {
      label: 'Penghapusan Data',
      category: 'delete',
      className: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    };
  }
  if (act.includes('restore') || act.includes('pulih')) {
    return {
      label: 'Pemulihan Data',
      category: 'other',
      className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    };
  }
  if (act.includes('akun') || act.includes('pengguna') || act.includes('admin')) {
    return {
      label: 'Manajemen Pengguna',
      category: 'account',
      className: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
    };
  }
  if (act.includes('kebun') || act.includes('afdeling') || act.includes('layer') || act.includes('blok')) {
    return {
      label: 'Data Kebun & Layer',
      category: 'kebun',
      className: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    };
  }
  if (act.includes('login') || act.includes('logout')) {
    return {
      label: 'Sesi Autentikasi',
      category: 'auth',
      className: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    };
  }
  return {
    label: aktivitas.replace(/_/g, ' '),
    category: 'other',
    className: 'bg-[#12192B] text-[#8B9BB4] border-[#1E2942]',
  };
}
