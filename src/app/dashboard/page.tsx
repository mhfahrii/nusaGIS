'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthProvider, useAuth } from '@/components/AuthProvider';
import { IconTree } from '@/components/icons';
import {
  IconCheck,
  IconClose,
  IconDatabase,
  IconEye,
  IconEyeOff,
  IconHistory,
  IconLayers,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTrash,
} from '@/components/gis/GisIcons';
import SettingsModal from '@/components/gis/monitoring/SettingsModal';
import { MonitoringBottomPanel } from '@/components/gis/monitoring/MonitoringBottomPanel';
import {
  RPN_ENTITIES,
  RPN_ENTITY_OPTIONS,
  matchPerusahaanFilter,
  normalizePerusahaanName,
} from '@/lib/gis/rpnEntities';
import { PROVINSI_INDONESIA } from '@/lib/gis/wilayah';
import {
  DEFAULT_HAK_AKSES_ADMIN,
  DEFAULT_HAK_AKSES_KARYAWAN,
  hasPermission,
  normalizeHakAkses,
  type HakAksesFitur,
  type Peran,
} from '@/types/auth';
import type { LayerPeta, MonitoringStats } from '@/types/gis';

type MenuKey =
  | 'hasil_analisa'
  | 'data_perusahaan'
  | 'data_kebun'
  | 'hak_sementara'
  | 'manajemen_pengguna'
  | 'create_account'
  | 'log_audit'
  | 'backup_riwayat';

type JenisHakSementara = 'upload_layer' | 'edit_data';
type StatusHakSementara = 'pending' | 'disetujui' | 'ditolak' | 'dicabut';

interface PermintaanHakSementaraRecord {
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

interface KaryawanItem {
  id: number;
  kode_karyawan: string;
  nama: string;
  email: string;
  peran: Peran;
  aktif: boolean;
  hak_akses: HakAksesFitur;
  foto_profil?: string | null;
  dibuat_pada: string | null;
}

interface KebunRecord {
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

interface AfdelingRecord {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
  keterangan: string | null;
  dibuat_pada: string | null;
}

interface AuditLogRecord {
  id: number;
  aktivitas: string;
  keterangan: string | null;
  dibuat_pada: string;
  nama_pengguna: string;
  role: string;
}

interface PermissionMeta {
  key: keyof HakAksesFitur;
  title: string;
  description: string;
  shortLabel: string;
}

const PERMISSION_ITEMS: PermissionMeta[] = [
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

function resizeImageToAvatarDataUrl(file: File): Promise<string> {
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

function IconUsers({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconUserPlus({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  );
}

function IconGlobeMap({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function IconChartBar({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconBuilding({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </svg>
  );
}

function IconCamera({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function IconLogoutExit({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconShieldKey({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <circle cx="12" cy="11" r="2" />
      <path d="M12 13v3" />
    </svg>
  );
}

function formatTanggal(iso: string | null): string {
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

function formatWaktuLengkap(iso: string | null): string {
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

function classifyAuditBadge(aktivitas: string): {
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
  if (act.includes('kebun') || act.includes('afdeling') || act.includes('layer')) {
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

function DashboardContent() {
  const { user, logout, refreshUser } = useAuth();
  const [activeMenu, setActiveMenu] = useState<MenuKey>('hasil_analisa');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uploadingSelfPhoto, setUploadingSelfPhoto] = useState<boolean>(false);

  const selfPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const createPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const editPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Master Data States
  const [karyawanList, setKaryawanList] = useState<KaryawanItem[]>([]);
  const [kebunList, setKebunList] = useState<KebunRecord[]>([]);
  const [afdelingList, setAfdelingList] = useState<AfdelingRecord[]>([]);
  const [layersList, setLayersList] = useState<LayerPeta[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [stats, setStats] = useState<MonitoringStats | null>(null);
  const [loadingData, setLoadingData] = useState<boolean>(true);

  // Filter State pada Menu Hasil & Analisa
  const [analisaPerusahaan, setAnalisaPerusahaan] = useState<string>('');
  const [analisaKebunId, setAnalisaKebunId] = useState<number | null>(null);
  const [analisaAfdelingId, setAnalisaAfdelingId] = useState<number | null>(null);
  const [analisaLayerId, setAnalisaLayerId] = useState<number | null>(null);
  const [analisaFeatureId, setAnalisaFeatureId] = useState<number | null>(null);

  // State Menu Data Kebun & Afdeling
  const [expandedKebunId, setExpandedKebunId] = useState<number | null>(null);
  const [kebunSearch, setKebunSearch] = useState<string>('');
  const [kebunPerusahaanFilter, setKebunPerusahaanFilter] = useState<string>('');
  const [showAddKebunModal, setShowAddKebunModal] = useState<boolean>(false);
  const [editingKebun, setEditingKebun] = useState<KebunRecord | null>(null);
  const [formKodeKebun, setFormKodeKebun] = useState<string>('');
  const [formNamaKebun, setFormNamaKebun] = useState<string>('');
  const [formPerusahaanKebun, setFormPerusahaanKebun] = useState<string>(RPN_ENTITY_OPTIONS[0]);
  const [formProvinsiKebun, setFormProvinsiKebun] = useState<string>('Jawa Timur');
  const [formKabupatenKebun, setFormKabupatenKebun] = useState<string>('');
  const [formKomoditasKebun, setFormKomoditasKebun] = useState<string>('');
  const [savingKebun, setSavingKebun] = useState<boolean>(false);

  // Form Tambah Afdeling per Kebun
  const [newAfdKode, setNewAfdKode] = useState<string>('');
  const [newAfdNama, setNewAfdNama] = useState<string>('');
  const [newAfdKeterangan, setNewAfdKeterangan] = useState<string>('');
  const [savingAfd, setSavingAfd] = useState<boolean>(false);

  // State Menu Manajemen Pengguna
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'all' | Peran>('all');

  // State Form Create Account
  const [newNama, setNewNama] = useState<string>('');
  const [newEmail, setNewEmail] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);
  const [newPeran, setNewPeran] = useState<Peran>('pengguna');
  const [newAktif, setNewAktif] = useState<boolean>(true);
  const [newFotoProfil, setNewFotoProfil] = useState<string | null>(null);
  const [newHakAkses, setNewHakAkses] = useState<HakAksesFitur>({
    ...DEFAULT_HAK_AKSES_KARYAWAN,
  });
  const [creating, setCreating] = useState<boolean>(false);

  // State Modal Edit Pengguna
  const [editTarget, setEditTarget] = useState<KaryawanItem | null>(null);
  const [editNama, setEditNama] = useState<string>('');
  const [editEmail, setEditEmail] = useState<string>('');
  const [editPeran, setEditPeran] = useState<Peran>('pengguna');
  const [editAktif, setEditAktif] = useState<boolean>(true);
  const [editPassword, setEditPassword] = useState<string>('');
  const [showEditPassword, setShowEditPassword] = useState<boolean>(false);
  const [editFotoProfil, setEditFotoProfil] = useState<string | null>(null);
  const [editHakAkses, setEditHakAkses] = useState<HakAksesFitur>({
    ...DEFAULT_HAK_AKSES_KARYAWAN,
  });
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<KaryawanItem | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // State Filter Log Audit
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [auditCategory, setAuditCategory] = useState<string>('all');

  // State Permintaan Hak Sementara (Karyawan & Admin)
  const [hakSementaraList, setHakSementaraList] = useState<PermintaanHakSementaraRecord[]>([]);
  const [selectedJenisHak, setSelectedJenisHak] = useState<JenisHakSementara>('upload_layer');
  const [alasanHakSementara, setAlasanHakSementara] = useState<string>('');
  const [submittingHakSementara, setSubmittingHakSementara] = useState<boolean>(false);
  const [processingHakId, setProcessingHakId] = useState<number | null>(null);

  const canManage = useMemo(() => hasPermission(user, 'kelola_karyawan'), [user]);
  const canViewMap = useMemo(() => hasPermission(user, 'lihat_peta'), [user]);
  const canUploadLayer = useMemo(() => hasPermission(user, 'upload_layer'), [user]);
  const canEditData = useMemo(() => hasPermission(user, 'edit_data'), [user]);
  const canDeleteData = useMemo(() => hasPermission(user, 'hapus_data'), [user]);
  const canAccessBackup = useMemo(() => canManage || canDeleteData, [canManage, canDeleteData]);

  const pendingHakCount = useMemo(
    () => hakSementaraList.filter((item) => item.status === 'pending').length,
    [hakSementaraList]
  );
  const activeApprovedHakCount = useMemo(
    () => hakSementaraList.filter((item) => item.status === 'disetujui').length,
    [hakSementaraList]
  );

  const fetchAllData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [karRes, kbnRes, afdRes, lyrRes, hisRes, stRes, hakRes] = await Promise.all([
        fetch('/api/karyawan', { cache: 'no-store' }),
        fetch('/api/kebun', { cache: 'no-store' }),
        fetch('/api/afdeling', { cache: 'no-store' }),
        fetch('/api/gis/layers', { cache: 'no-store' }),
        fetch('/api/gis/history', { cache: 'no-store' }),
        fetch('/api/stats', { cache: 'no-store' }),
        fetch('/api/hak-sementara', { cache: 'no-store' }),
      ]);

      if (karRes.ok) {
        const j = await karRes.json();
        setKaryawanList(j.data || []);
      }
      if (kbnRes.ok) {
        const j = await kbnRes.json();
        const kRows: KebunRecord[] = (j.data || []).map((k: KebunRecord) => ({
          ...k,
          id: Number(k.id),
        }));
        setKebunList(kRows);
        setExpandedKebunId((prev) => (prev === null && kRows.length > 0 ? kRows[0].id : prev));
      }
      if (afdRes.ok) {
        const j = await afdRes.json();
        setAfdelingList(
          (j.data || []).map((a: AfdelingRecord) => ({
            ...a,
            id: Number(a.id),
            kebun_id: Number(a.kebun_id),
          }))
        );
      }
      if (lyrRes.ok) {
        const j = await lyrRes.json();
        const lRows: LayerPeta[] = j.data || [];
        setLayersList(lRows);
        setAnalisaLayerId((prev) => (prev === null && lRows.length > 0 ? lRows[0].id : prev));
      }
      if (hisRes.ok) {
        const j = await hisRes.json();
        setAuditLogs(j.data?.activity_logs || []);
      }
      if (stRes.ok) {
        const j = await stRes.json();
        setStats(j.data || null);
      }
      if (hakRes.ok) {
        const j = await hakRes.json();
        setHakSementaraList(j.data || []);
      }
    } catch {
      setBanner({
        type: 'error',
        text: 'Gagal memuat sebagian data dari server database.',
      });
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAllData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAllData]);

  // Perbarui statistik KPI Hasil & Analisa saat filter berubah
  useEffect(() => {
    let ignore = false;
    async function loadFilteredStats() {
      try {
        const params: string[] = [];
        if (analisaKebunId) params.push(`kebun_id=${analisaKebunId}`);
        else if (analisaPerusahaan) {
          params.push(`perusahaan=${encodeURIComponent(analisaPerusahaan)}`);
        }
        if (analisaLayerId) params.push(`layer_id=${analisaLayerId}`);
        const q = params.length > 0 ? `?${params.join('&')}` : '';
        const res = await fetch(`/api/stats${q}`, { cache: 'no-store' });
        if (!ignore && res.ok) {
          const j = await res.json();
          setStats(j.data || null);
        }
      } catch {
        // Abaikan kegagalan sementara
      }
    }
    loadFilteredStats();
    return () => {
      ignore = true;
    };
  }, [analisaPerusahaan, analisaKebunId, analisaLayerId]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  // Filter Layers untuk Hasil & Analisa
  const filteredAnalisaKebun = useMemo(() => {
    if (!analisaPerusahaan) return kebunList;
    return kebunList.filter((k) => matchPerusahaanFilter(k.perusahaan, analisaPerusahaan));
  }, [kebunList, analisaPerusahaan]);

  const filteredAnalisaLayers = useMemo(() => {
    return layersList.filter((l) => {
      const k = kebunList.find((item) => item.id === Number(l.kebun_id));
      if (analisaPerusahaan && !matchPerusahaanFilter(l.perusahaan || k?.perusahaan, analisaPerusahaan)) {
        return false;
      }
      if (analisaKebunId && Number(l.kebun_id) !== analisaKebunId) {
        return false;
      }
      return true;
    });
  }, [layersList, kebunList, analisaPerusahaan, analisaKebunId]);

  const effectiveAnalisaAfdeling = useMemo(() => {
    const base = analisaKebunId
      ? afdelingList.filter((a) => a.kebun_id === analisaKebunId)
      : afdelingList;
    const merged = [...base];
    const breakdown = stats?.afdeling_breakdown || [];
    const targetKbn =
      analisaKebunId ||
      (analisaLayerId
        ? Number(layersList.find((l) => l.id === analisaLayerId)?.kebun_id || 0)
        : 0);

    breakdown.forEach((b, idx) => {
      const exists = merged.some(
        (a) =>
          (!targetKbn || Number(a.kebun_id) === targetKbn) &&
          a.nama_afdeling.trim().toLowerCase() === b.name.trim().toLowerCase()
      );
      if (!exists) {
        merged.push({
          id: -(idx + 1),
          kebun_id: targetKbn,
          kode_afdeling: `${b.count} blok · ${b.luas_ukur_ha} Ha`,
          nama_afdeling: b.name,
          keterangan: 'Klaster otomatis shapefile (.dbf)',
          dibuat_pada: null,
        });
      }
    });
    return merged;
  }, [afdelingList, analisaKebunId, analisaLayerId, layersList, stats]);

  // Ringkasan Data Perusahaan (PT RPN Group)
  const perusahaanSummaries = useMemo(() => {
    return RPN_ENTITIES.map((ent) => {
      const unitKebun = kebunList.filter((k) => matchPerusahaanFilter(k.perusahaan, ent.label));
      const unitLayers = layersList.filter((l) => {
        const k = kebunList.find((item) => item.id === Number(l.kebun_id));
        return matchPerusahaanFilter(l.perusahaan || k?.perusahaan, ent.label);
      });
      const unitAfdeling = afdelingList.filter((a) =>
        unitKebun.some((k) => k.id === a.kebun_id)
      );
      const provinsiSet = new Set(
        unitKebun.map((k) => (k.provinsi || k.wilayah || '').trim()).filter(Boolean)
      );
      const totalFitur = unitLayers.reduce((acc, l) => acc + (Number(l.jumlah_fitur) || 0), 0);

      return {
        ...ent,
        kebunItems: unitKebun,
        kebunCount: unitKebun.length,
        layerCount: unitLayers.length,
        afdelingCount: unitAfdeling.length,
        provinsiList: Array.from(provinsiSet),
        totalFitur,
      };
    });
  }, [kebunList, layersList, afdelingList]);

  // Filter Data Kebun
  const filteredKebunRecords = useMemo(() => {
    return kebunList.filter((k) => {
      if (kebunPerusahaanFilter && !matchPerusahaanFilter(k.perusahaan, kebunPerusahaanFilter)) {
        return false;
      }
      if (!kebunSearch.trim()) return true;
      const q = kebunSearch.toLowerCase();
      return (
        k.nama_kebun.toLowerCase().includes(q) ||
        k.kode_kebun.toLowerCase().includes(q) ||
        (k.wilayah || '').toLowerCase().includes(q) ||
        (k.provinsi || '').toLowerCase().includes(q) ||
        (k.kabupaten_kota || '').toLowerCase().includes(q) ||
        (k.komoditas || '').toLowerCase().includes(q)
      );
    });
  }, [kebunList, kebunPerusahaanFilter, kebunSearch]);

  // Filter Manajemen Pengguna
  const filteredKaryawan = useMemo(() => {
    return karyawanList.filter((item) => {
      if (roleFilter !== 'all' && item.peran !== roleFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.nama.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.kode_karyawan.toLowerCase().includes(q) ||
        String(item.id).includes(q)
      );
    });
  }, [karyawanList, roleFilter, searchQuery]);

  // Filter Log Audit
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const badge = classifyAuditBadge(log.aktivitas);
      if (auditCategory !== 'all' && badge.category !== auditCategory) return false;
      if (!auditSearch.trim()) return true;
      const q = auditSearch.toLowerCase();
      return (
        log.aktivitas.toLowerCase().includes(q) ||
        (log.keterangan || '').toLowerCase().includes(q) ||
        log.nama_pengguna.toLowerCase().includes(q) ||
        log.role.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditCategory, auditSearch]);

  const statsSummary = useMemo(() => {
    const total = karyawanList.length;
    const totalAdmin = karyawanList.filter((k) => k.peran === 'admin').length;
    const totalStaff = karyawanList.filter((k) => k.peran !== 'admin').length;
    const totalAktif = karyawanList.filter((k) => k.aktif).length;
    return { total, totalAdmin, totalStaff, totalAktif };
  }, [karyawanList]);

  // Handler Upload Foto Profil Sendiri
  const handleSelfPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;

    setUploadingSelfPhoto(true);
    try {
      const dataUrl = await resizeImageToAvatarDataUrl(file);
      const res = await fetch('/api/karyawan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          foto_profil: dataUrl,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({
          type: 'error',
          text: json?.message || 'Gagal menyimpan foto profil.',
        });
        return;
      }
      await refreshUser();
      await fetchAllData();
      setBanner({
        type: 'success',
        text: 'Foto profil berhasil diperbarui.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: (err as Error).message || 'Gagal memproses gambar.',
      });
    } finally {
      setUploadingSelfPhoto(false);
    }
  };

  // Handlers Data Kebun & Afdeling
  const openCreateKebunModal = () => {
    setEditingKebun(null);
    setFormKodeKebun(`KBN-${Date.now().toString().slice(-4)}`);
    setFormNamaKebun('');
    setFormPerusahaanKebun(RPN_ENTITY_OPTIONS[0]);
    setFormProvinsiKebun('Jawa Timur');
    setFormKabupatenKebun('');
    setFormKomoditasKebun('Tebu');
    setShowAddKebunModal(true);
  };

  const openEditKebunModal = (k: KebunRecord) => {
    setEditingKebun(k);
    setFormKodeKebun(k.kode_kebun);
    setFormNamaKebun(k.nama_kebun);
    setFormPerusahaanKebun(normalizePerusahaanName(k.perusahaan) || RPN_ENTITY_OPTIONS[0]);
    setFormProvinsiKebun(k.provinsi || 'Jawa Timur');
    setFormKabupatenKebun(k.kabupaten_kota || '');
    setFormKomoditasKebun(k.komoditas || '');
    setShowAddKebunModal(true);
  };

  const handleSaveKebun = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formNamaKebun.trim() || !formKodeKebun.trim()) {
      setBanner({ type: 'error', text: 'Kode Kebun dan Nama Kebun wajib diisi.' });
      return;
    }
    setSavingKebun(true);
    try {
      const fullWilayah = formKabupatenKebun.trim()
        ? `${formKabupatenKebun.trim()}, ${formProvinsiKebun}`
        : formProvinsiKebun;

      const method = editingKebun ? 'PATCH' : 'POST';
      const payload = editingKebun
        ? {
            id: editingKebun.id,
            kode_kebun: formKodeKebun.trim(),
            nama_kebun: formNamaKebun.trim(),
            perusahaan: formPerusahaanKebun,
            provinsi: formProvinsiKebun,
            kabupaten_kota: formKabupatenKebun.trim() || null,
            wilayah: fullWilayah,
            komoditas: formKomoditasKebun.trim() || null,
          }
        : {
            kode_kebun: formKodeKebun.trim(),
            nama_kebun: formNamaKebun.trim(),
            perusahaan: formPerusahaanKebun,
            provinsi: formProvinsiKebun,
            kabupaten_kota: formKabupatenKebun.trim() || null,
            wilayah: fullWilayah,
            komoditas: formKomoditasKebun.trim() || null,
          };

      const res = await fetch('/api/kebun', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({ type: 'error', text: json?.message || 'Gagal menyimpan data kebun.' });
        setSavingKebun(false);
        return;
      }
      setBanner({
        type: 'success',
        text: editingKebun
          ? `Data kebun "${formNamaKebun}" berhasil diperbarui.`
          : `Unit kebun "${formNamaKebun}" berhasil ditambahkan.`,
      });
      setShowAddKebunModal(false);
      await fetchAllData();
    } catch {
      setBanner({ type: 'error', text: 'Gagal menghubungi server saat menyimpan kebun.' });
    } finally {
      setSavingKebun(false);
    }
  };

  const handleDeleteKebun = async (k: KebunRecord) => {
    if (!window.confirm(`Hapus unit kebun "${k.nama_kebun}" (${k.kode_kebun})?`)) return;
    try {
      const res = await fetch(`/api/kebun?id=${k.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({ type: 'error', text: json?.message || 'Gagal menghapus kebun.' });
        return;
      }
      setBanner({ type: 'success', text: `Kebun "${k.nama_kebun}" berhasil dihapus.` });
      await fetchAllData();
    } catch {
      setBanner({ type: 'error', text: 'Gagal menghapus data kebun.' });
    }
  };

  const handleAddAfdeling = async (e: React.FormEvent<HTMLFormElement>, kebunId: number) => {
    e.preventDefault();
    if (!newAfdNama.trim()) {
      setBanner({ type: 'error', text: 'Nama Afdeling wajib diisi.' });
      return;
    }
    const kode =
      newAfdKode.trim() ||
      `AFD-${newAfdNama.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'A'}-${Date.now().toString().slice(-3)}`;

    setSavingAfd(true);
    try {
      const res = await fetch('/api/afdeling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kebun_id: kebunId,
          kode_afdeling: kode,
          nama_afdeling: newAfdNama.trim(),
          keterangan: newAfdKeterangan.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({ type: 'error', text: json?.message || 'Gagal menambahkan afdeling.' });
        setSavingAfd(false);
        return;
      }
      setNewAfdKode('');
      setNewAfdNama('');
      setNewAfdKeterangan('');
      setBanner({
        type: 'success',
        text: `Afdeling "${newAfdNama.trim()}" berhasil ditambahkan ke kebun.`,
      });
      await fetchAllData();
    } catch {
      setBanner({ type: 'error', text: 'Gagal menambahkan afdeling.' });
    } finally {
      setSavingAfd(false);
    }
  };

  const handleDeleteAfdeling = async (afd: AfdelingRecord) => {
    if (!window.confirm(`Hapus "${afd.nama_afdeling}" (${afd.kode_afdeling})?`)) return;
    try {
      const res = await fetch(`/api/afdeling?id=${afd.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({ type: 'error', text: json?.message || 'Gagal menghapus afdeling.' });
        return;
      }
      setBanner({ type: 'success', text: `Afdeling "${afd.nama_afdeling}" berhasil dihapus.` });
      await fetchAllData();
    } catch {
      setBanner({ type: 'error', text: 'Gagal menghapus afdeling.' });
    }
  };

  // Handlers Manajemen Pengguna & Create Account
  const handleSelectNewRole = (role: Peran) => {
    setNewPeran(role);
    setNewHakAkses(
      role === 'admin' ? { ...DEFAULT_HAK_AKSES_ADMIN } : { ...DEFAULT_HAK_AKSES_KARYAWAN }
    );
  };

  const handleCreateAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBanner(null);

    if (!newNama.trim() || !newPassword) {
      setBanner({
        type: 'error',
        text: 'Nama / Username dan Password wajib diisi.',
      });
      return;
    }

    const effectiveIdOrUsername = newEmail.trim() || newNama.trim();

    setCreating(true);
    try {
      const res = await fetch('/api/karyawan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama: newNama.trim(),
          email: effectiveIdOrUsername,
          password: newPassword,
          peran: newPeran,
          aktif: newAktif,
          foto_profil: newFotoProfil,
          hak_akses: newHakAkses,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setBanner({
          type: 'error',
          text: json?.message || 'Gagal membuat akun baru.',
        });
        setCreating(false);
        return;
      }

      setBanner({
        type: 'success',
        text: json?.message || `Akun "${newNama.trim()}" berhasil dibuat di database.`,
      });
      setNewNama('');
      setNewEmail('');
      setNewPassword('');
      setNewPeran('pengguna');
      setNewAktif(true);
      setNewFotoProfil(null);
      setNewHakAkses({ ...DEFAULT_HAK_AKSES_KARYAWAN });
      await fetchAllData();
      setActiveMenu('manajemen_pengguna');
    } catch {
      setBanner({
        type: 'error',
        text: 'Kesalahan jaringan saat menyimpan akun ke database.',
      });
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (item: KaryawanItem) => {
    setEditTarget(item);
    setEditNama(item.nama);
    setEditEmail(item.email);
    setEditPeran(item.peran);
    setEditAktif(item.aktif);
    setEditPassword('');
    setShowEditPassword(false);
    setEditFotoProfil(item.foto_profil ?? null);
    setEditHakAkses(normalizeHakAkses(item.hak_akses, item.peran));
  };

  const handleSaveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);
    setBanner(null);

    try {
      const res = await fetch('/api/karyawan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editTarget.id,
          nama: editNama.trim(),
          email: editEmail.trim(),
          peran: editPeran,
          aktif: editAktif,
          foto_profil: editFotoProfil,
          hak_akses: editHakAkses,
          password: editPassword.trim() ? editPassword : '',
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({
          type: 'error',
          text: json?.message || 'Gagal menyimpan perubahan akun.',
        });
        setSavingEdit(false);
        return;
      }

      setBanner({
        type: 'success',
        text: json?.message || `Perubahan akun "${editNama}" berhasil disimpan.`,
      });
      if (editTarget.id === user?.id) {
        await refreshUser();
      }
      setEditTarget(null);
      await fetchAllData();
    } catch {
      setBanner({
        type: 'error',
        text: 'Gagal terhubung ke server saat memperbarui akun.',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleStatus = async (item: KaryawanItem) => {
    if (!canManage) return;
    try {
      const res = await fetch('/api/karyawan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          aktif: !item.aktif,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({
          type: 'error',
          text: json?.message || 'Gagal mengubah status akun.',
        });
        return;
      }
      setBanner({
        type: 'success',
        text: `Status akun "${item.nama}" diubah menjadi ${!item.aktif ? 'Aktif' : 'Nonaktif'}.`,
      });
      await fetchAllData();
    } catch {
      setBanner({
        type: 'error',
        text: 'Gagal mengubah status akun.',
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/karyawan?id=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({
          type: 'error',
          text: json?.message || 'Gagal menghapus akun pengguna.',
        });
        setDeleting(false);
        return;
      }
      setBanner({
        type: 'success',
        text: json?.message || `Akun "${deleteTarget.nama}" berhasil dihapus dari database.`,
      });
      setDeleteTarget(null);
      await fetchAllData();
    } catch {
      setBanner({
        type: 'error',
        text: 'Gagal menghapus akun pengguna.',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleRequestHakSementara = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmittingHakSementara(true);
    setBanner(null);
    try {
      const res = await fetch('/api/hak-sementara', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jenis_hak: selectedJenisHak,
          alasan: alasanHakSementara.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({
          type: 'error',
          text: json?.message || json?.pesan || 'Gagal mengirim permintaan hak akses sementara.',
        });
        setSubmittingHakSementara(false);
        return;
      }
      setAlasanHakSementara('');
      setBanner({
        type: 'success',
        text:
          json?.message ||
          json?.pesan ||
          'Permintaan hak sementara berhasil dikirim. Menunggu validasi Administrator.',
      });
      await fetchAllData();
    } catch {
      setBanner({
        type: 'error',
        text: 'Gagal menghubungi server saat mengirim permintaan hak sementara.',
      });
    } finally {
      setSubmittingHakSementara(false);
    }
  };

  const handleConfirmHakSementara = async (
    id: number,
    action: 'setujui' | 'tolak' | 'cabut'
  ) => {
    setProcessingHakId(id);
    setBanner(null);
    try {
      const res = await fetch('/api/hak-sementara', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBanner({
          type: 'error',
          text: json?.message || json?.pesan || 'Gagal memproses konfirmasi hak sementara.',
        });
        setProcessingHakId(null);
        return;
      }
      setBanner({
        type: 'success',
        text: json?.message || json?.pesan || 'Status hak sementara berhasil diperbarui.',
      });
      await refreshUser();
      await fetchAllData();
    } catch {
      setBanner({
        type: 'error',
        text: 'Gagal menghubungi server saat memproses hak sementara.',
      });
    } finally {
      setProcessingHakId(null);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-[#0A0E1A] text-[#F0F6FC] flex flex-col lg:flex-row font-sans antialiased selection:bg-[#00D2FF]/30">
      {/* SIDEBAR NAVIGASI UTAMA */}
      <aside className="w-full lg:w-64 xl:w-72 bg-[#0D1322] border-b lg:border-b-0 lg:border-r border-[#1E2942] flex flex-col justify-between shrink-0 select-none">
        <div>
          {/* Brand Header */}
          <div className="h-14 px-4 border-b border-[#1E2942] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#0E3A5D] border border-[#00D2FF]/50 flex items-center justify-center text-[#00D2FF] shadow-xs shrink-0">
                <IconTree className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold tracking-wider text-[#F0F6FC] text-xs sm:text-sm uppercase truncate">
                    GIS Portal
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#0E3A5D]/80 border border-[#00B4D8]/60 text-[#00D2FF] font-mono">
                    PT RPN
                  </span>
                </div>
                <p className="text-[10px] text-[#8B9BB4] truncate">
                  Pusat Analisa, Data &amp; Pengguna
                </p>
              </div>
            </div>
          </div>

          {/* Kartu Pill Profil Pengguna Aktif */}
          <div className="px-3 pt-3.5">
            <input
              ref={selfPhotoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleSelfPhotoChange}
              className="hidden"
            />
            <div className="p-2 pr-3.5 rounded-full bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF]/50 flex items-center justify-between gap-2.5 shadow-sm transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  disabled={uploadingSelfPhoto}
                  onClick={() => selfPhotoInputRef.current?.click()}
                  className="relative w-10 h-10 rounded-full bg-[#0E3A5D] border border-[#00D2FF]/60 text-[#00D2FF] font-bold text-xs flex items-center justify-center overflow-hidden shrink-0 group cursor-pointer"
                  title="Klik untuk upload atau ganti foto profil Anda"
                >
                  {user?.foto_profil ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.foto_profil}
                      alt={user.nama}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{user?.nama ? user.nama.substring(0, 2).toUpperCase() : 'FA'}</span>
                  )}
                  <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                    <IconCamera className="w-3.5 h-3.5" />
                  </span>
                </button>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate leading-tight">
                    {user?.nama || 'fahri'}
                  </div>
                  <div className="text-[11px] text-[#00D2FF] font-medium leading-tight mt-0.5">
                    {user?.peran === 'admin' ? 'Admin' : 'Karyawan'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={uploadingSelfPhoto}
                onClick={() => selfPhotoInputRef.current?.click()}
                className="px-2.5 py-1 rounded-full bg-[#0D1322] hover:bg-[#19233A] border border-[#1E2942] hover:border-[#00D2FF]/50 text-[10px] font-semibold text-[#00D2FF] flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                title="Upload foto profil baru"
              >
                <IconCamera className="w-3 h-3" />
                <span>{uploadingSelfPhoto ? '...' : 'Foto'}</span>
              </button>
            </div>
          </div>

          {/* Menu Navigasi Sidebar */}
          <nav className="p-3 space-y-1" aria-label="Menu Dashboard">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#566680]">
              Peta &amp; Analisa Spasial
            </div>

            {/* 1. Menu GIS (Kembali ke Peta Monitoring) */}
            <Link
              href="/"
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border border-transparent hover:border-[#1E2942] transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#12192B] group-hover:bg-[#0E3A5D] text-[#00D2FF] flex items-center justify-center border border-[#1E2942] group-hover:border-[#00D2FF]/40 transition-colors">
                  <IconGlobeMap className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-[#F0F6FC] group-hover:text-[#00D2FF] transition-colors">
                    GIS
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] font-normal">
                    Kembali ke Peta Monitoring
                  </div>
                </div>
              </div>
            </Link>

            {/* 2. Menu Hasil & Analisa */}
            <button
              type="button"
              onClick={() => setActiveMenu('hasil_analisa')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                activeMenu === 'hasil_analisa'
                  ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                  : 'text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                    activeMenu === 'hasil_analisa'
                      ? 'bg-[#00D2FF]/15 border-[#00D2FF]/40 text-[#00D2FF]'
                      : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4]'
                  }`}
                >
                  <IconChartBar className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold">Hasil &amp; Analisa</div>
                  <div className="text-[10px] text-[#8B9BB4] font-normal">
                    Diagram Blok, Produksi &amp; Tabel
                  </div>
                </div>
              </div>
            </button>

            <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#566680]">
              Master Perkebunan
            </div>

            {/* 3. Menu Data Perusahaan */}
            <button
              type="button"
              onClick={() => setActiveMenu('data_perusahaan')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                activeMenu === 'data_perusahaan'
                  ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                  : 'text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                    activeMenu === 'data_perusahaan'
                      ? 'bg-[#00D2FF]/15 border-[#00D2FF]/40 text-[#00D2FF]'
                      : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4]'
                  }`}
                >
                  <IconBuilding className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold">Data Perusahaan</div>
                  <div className="text-[10px] text-[#8B9BB4] font-normal">
                    Puslit PT RPN &amp; Komoditas
                  </div>
                </div>
              </div>
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-[#0D1322] border border-[#1E2942] text-[#8B9BB4]">
                {RPN_ENTITIES.length}
              </span>
            </button>

            {/* 4. Menu Data Kebun (Beserta Afdeling) */}
            <button
              type="button"
              onClick={() => setActiveMenu('data_kebun')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                activeMenu === 'data_kebun'
                  ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                  : 'text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                    activeMenu === 'data_kebun'
                      ? 'bg-[#10B981]/15 border-[#10B981]/40 text-[#10B981]'
                      : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4]'
                  }`}
                >
                  <IconLayers className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold">Data Kebun</div>
                  <div className="text-[10px] text-[#8B9BB4] font-normal">
                    Unit Kebun &amp; Data Afdeling
                  </div>
                </div>
              </div>
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-[#0D1322] border border-[#1E2942] text-[#8B9BB4]">
                {kebunList.length}
              </span>
            </button>

            <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#566680]">
              Akses &amp; Keamanan Sistem
            </div>

            {/* Menu Hak Sementara (Tersedia untuk Karyawan mengajukan & Admin memvalidasi) */}
            <button
              type="button"
              onClick={() => setActiveMenu('hak_sementara')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                activeMenu === 'hak_sementara'
                  ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                  : 'text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                    activeMenu === 'hak_sementara'
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                      : 'bg-[#12192B] border-[#1E2942] text-amber-400'
                  }`}
                >
                  <IconShieldKey className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold">
                    {canManage ? 'Konfirmasi Hak Sementara' : 'Hak Sementara'}
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] font-normal">
                    {canManage ? 'Validasi Izin Upload & Edit' : 'Minta Izin Upload / Edit'}
                  </div>
                </div>
              </div>
              {pendingHakCount > 0 ? (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold font-mono bg-amber-500 text-[#0A0E1A]">
                  {pendingHakCount}
                </span>
              ) : activeApprovedHakCount > 0 ? (
                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#10B981]/20 border border-[#10B981]/40 text-[#10B981]">
                  Aktif
                </span>
              ) : null}
            </button>

            {/* 5. Menu Manajemen Pengguna (Hanya Admin / Kelola Karyawan) */}
            {canManage && (
              <button
                type="button"
                onClick={() => setActiveMenu('manajemen_pengguna')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                  activeMenu === 'manajemen_pengguna'
                    ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                    : 'text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                      activeMenu === 'manajemen_pengguna'
                        ? 'bg-[#00D2FF]/15 border-[#00D2FF]/40 text-[#00D2FF]'
                        : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4]'
                    }`}
                  >
                    <IconUsers className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold">Manajemen Pengguna</div>
                    <div className="text-[10px] text-[#8B9BB4] font-normal">
                      Daftar Akun, ID &amp; Hak Akses
                    </div>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-[#0D1322] border border-[#1E2942] text-[#8B9BB4]">
                  {karyawanList.length}
                </span>
              </button>
            )}

            {/* 6. Menu Create Account (Hanya Admin / Kelola Karyawan) */}
            {canManage && (
              <button
                type="button"
                onClick={() => setActiveMenu('create_account')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                  activeMenu === 'create_account'
                    ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                    : 'text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                      activeMenu === 'create_account'
                        ? 'bg-[#10B981]/15 border-[#10B981]/40 text-[#10B981]'
                        : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4]'
                    }`}
                  >
                    <IconUserPlus className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold">Create Account</div>
                    <div className="text-[10px] text-[#8B9BB4] font-normal">
                      Buat Akun &amp; Atur Hak Akses
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-[#10B981]">+ Baru</span>
              </button>
            )}

            {/* 7. Menu Log Audit (Hanya Admin / Kelola Karyawan) */}
            {canManage && (
              <button
                type="button"
                onClick={() => setActiveMenu('log_audit')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                  activeMenu === 'log_audit'
                    ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                    : 'text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                      activeMenu === 'log_audit'
                        ? 'bg-[#00D2FF]/15 border-[#00D2FF]/40 text-[#00D2FF]'
                        : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4]'
                    }`}
                  >
                    <IconHistory className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold">Log Audit</div>
                    <div className="text-[10px] text-[#8B9BB4] font-normal">
                      Aktivitas Upload, Hapus &amp; Akun
                    </div>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-[#0D1322] border border-[#1E2942] text-[#8B9BB4]">
                  {auditLogs.length}
                </span>
              </button>
            )}

            {/* 8. Menu Backup & Riwayat (Hanya jika memiliki izin Kelola Pengguna atau Hapus Data) */}
            {canAccessBackup && (
              <button
                type="button"
                onClick={() => setActiveMenu('backup_riwayat')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                  activeMenu === 'backup_riwayat'
                    ? 'bg-[#132238] text-[#00D2FF] border-[#00D2FF]/60 shadow-sm'
                    : 'text-[#8B9BB4] hover:text-white hover:bg-[#12192B] border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                      activeMenu === 'backup_riwayat'
                        ? 'bg-[#00D2FF]/15 border-[#00D2FF]/40 text-[#00D2FF]'
                        : 'bg-[#12192B] border-[#1E2942] text-[#8B9BB4]'
                    }`}
                  >
                    <IconSettings className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold">Backup &amp; Riwayat</div>
                    <div className="text-[10px] text-[#8B9BB4] font-normal">
                      Cadangan &amp; Tempat Sampah
                    </div>
                  </div>
                </div>
              </button>
            )}
          </nav>
        </div>

        {/* Footer Sidebar Paling Bawah: Tombol Exit / Keluar */}
        <div className="p-3.5 border-t border-[#1E2942] bg-[#090D18] space-y-2.5">
          <div className="flex items-center justify-between text-[10px] text-[#8B9BB4] px-1">
            <span className="flex items-center gap-1.5">
              <IconDatabase className="w-3.5 h-3.5 text-[#10B981]" />
              <span>PostgreSQL Connected</span>
            </span>
            <span className="font-mono text-[#00D2FF]">PostGIS</span>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="w-full py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 hover:border-rose-500/60 text-xs font-bold text-rose-300 hover:text-white flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            title="Keluar dari sesi akun"
          >
            <IconLogoutExit className="w-4 h-4" />
            <span>Keluar / Exit</span>
          </button>
        </div>
      </aside>

      {/* AREA KONTEN UTAMA */}
      <main className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <header className="h-14 px-4 sm:px-6 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between gap-4 shrink-0">
          <div>
            <h1 className="text-sm sm:text-base font-bold text-white tracking-wide">
              {activeMenu === 'hasil_analisa' && 'Hasil & Analisa Spasial Perkebunan'}
              {activeMenu === 'data_perusahaan' && 'Data Perusahaan & Puslit PT RPN'}
              {activeMenu === 'data_kebun' && 'Data Unit Kebun & Daftar Afdeling'}
              {activeMenu === 'hak_sementara' &&
                (canManage
                  ? 'Konfirmasi & Validasi Hak Akses Sementara Karyawan'
                  : 'Pengajuan Hak Akses Sementara (Upload & Edit Data)')}
              {activeMenu === 'manajemen_pengguna' && 'Manajemen Pengguna & Hak Akses'}
              {activeMenu === 'create_account' && 'Create Account & Pengaturan Hak Akses'}
              {activeMenu === 'log_audit' && 'Log Audit Aktivitas Sistem'}
              {activeMenu === 'backup_riwayat' && 'Backup Basis Data & Tempat Sampah Spasial'}
            </h1>
            <p className="text-[11px] text-[#8B9BB4] hidden sm:block">
              {activeMenu === 'hasil_analisa' &&
                'Diagram analisis atribut shapefile (.dbf), profil luas blok, estimasi produksi, dan tabel atribut.'}
              {activeMenu === 'data_perusahaan' &&
                'Daftar entitas perusahaan/puslit di bawah naungan PT Riset Perkebunan Nusantara beserta cakupan kebunnya.'}
              {activeMenu === 'data_kebun' &&
                'Kelola data unit kebun beserta daftar afdeling di dalam masing-masing kebun.'}
              {activeMenu === 'hak_sementara' &&
                (canManage
                  ? 'Setujui, tolak, atau cabut kembali izin sementara Upload Data GIS dan Edit Data yang diajukan oleh Karyawan.'
                  : 'Ajukan izin sementara kepada Administrator untuk membuka fitur Upload Data GIS atau Edit Data & Layer.')}
              {activeMenu === 'manajemen_pengguna' &&
                'Kelola akun admin dan karyawan yang terhubung langsung dengan database PostgreSQL.'}
              {activeMenu === 'create_account' &&
                'Buat akun pengguna baru dengan ID/Username bebas dan atur izin akses fitur GIS.'}
              {activeMenu === 'log_audit' &&
                'Rekam jejak seluruh kegiatan upload, penghapusan, perubahan data kebun, dan manajemen akun.'}
              {activeMenu === 'backup_riwayat' &&
                'Unduh cadangan basis data spasial (.json) dan kelola penghapusan permanen tempat sampah.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {activeMenu === 'data_kebun' && canEditData && (
              <button
                type="button"
                onClick={openCreateKebunModal}
                className="px-3.5 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#059669] text-[#05130D] font-bold text-xs shadow-sm transition-all cursor-pointer"
              >
                + Tambah Kebun
              </button>
            )}
            {activeMenu === 'manajemen_pengguna' && canManage && (
              <button
                type="button"
                onClick={() => setActiveMenu('create_account')}
                className="px-3.5 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#059669] text-[#05130D] font-bold text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <IconUserPlus className="w-3.5 h-3.5" />
                <span>Create Account</span>
              </button>
            )}
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] hover:border-[#00D2FF]/50 text-xs font-semibold text-[#00D2FF] transition-colors flex items-center gap-1.5"
            >
              <IconGlobeMap className="w-3.5 h-3.5" />
              <span>Buka Peta GIS</span>
            </Link>
          </div>
        </header>

        <div className="p-4 sm:p-6 space-y-5 max-w-6xl w-full mx-auto">
          {banner && (
            <div
              role="alert"
              className={`p-3.5 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-3 ${
                banner.type === 'success'
                  ? 'bg-[#10B981]/15 border-[#10B981]/40 text-[#A7F3D0]'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-200'
              }`}
            >
              <span>{banner.text}</span>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="p-1 rounded hover:bg-black/20 text-current cursor-pointer"
                aria-label="Tutup pesan"
              >
                <IconClose className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* VIEW 1: HASIL & ANALISA (DIAGRAM & TABEL ATRIBUT SHAPEFILE) */}
          {activeMenu === 'hasil_analisa' && (
            <div className="space-y-4">
              {/* Filter Bar Hasil & Analisa */}
              <div className="p-4 rounded-2xl bg-[#0D1322] border border-[#1E2942] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Perusahaan / Puslit
                  </label>
                  <select
                    value={analisaPerusahaan}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAnalisaPerusahaan(val);
                      setAnalisaKebunId(null);
                      setAnalisaAfdelingId(null);
                      const matching = layersList.filter((l) => {
                        const k = kebunList.find((item) => item.id === Number(l.kebun_id));
                        return !val || matchPerusahaanFilter(l.perusahaan || k?.perusahaan, val);
                      });
                      setAnalisaLayerId(matching[0]?.id ?? null);
                    }}
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-[#0D1322]">Semua Perusahaan (PT RPN)</option>
                    {RPN_ENTITY_OPTIONS.map((p) => (
                      <option key={p} value={p} className="bg-[#0D1322]">
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Unit Kebun
                  </label>
                  <select
                    value={analisaKebunId || ''}
                    onChange={(e) => {
                      const nextKbn = e.target.value ? Number(e.target.value) : null;
                      setAnalisaKebunId(nextKbn);
                      setAnalisaAfdelingId(null);
                      const matching = layersList.filter((l) =>
                        nextKbn ? Number(l.kebun_id) === nextKbn : true
                      );
                      setAnalisaLayerId(matching[0]?.id ?? null);
                    }}
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-[#0D1322]">Semua Kebun</option>
                    {filteredAnalisaKebun.map((k) => (
                      <option key={k.id} value={k.id} className="bg-[#0D1322]">
                        {k.nama_kebun} ({k.provinsi || k.wilayah || '-'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Layer Spasial (.shp)
                  </label>
                  <select
                    value={analisaLayerId || ''}
                    onChange={(e) => {
                      setAnalisaLayerId(e.target.value ? Number(e.target.value) : null);
                      setAnalisaFeatureId(null);
                    }}
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    {filteredAnalisaLayers.length === 0 ? (
                      <option value="" className="bg-[#0D1322]">Tidak ada layer</option>
                    ) : (
                      filteredAnalisaLayers.map((l) => (
                        <option key={l.id} value={l.id} className="bg-[#0D1322]">
                          {l.nama_layer} ({l.jumlah_fitur} poligon)
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#8B9BB4] mb-1">
                    Filter Klaster Afdeling
                  </label>
                  <select
                    value={analisaAfdelingId || ''}
                    onChange={(e) =>
                      setAnalisaAfdelingId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-[#0D1322]">Semua Afdeling</option>
                    {effectiveAnalisaAfdeling.map((a) => (
                      <option key={a.id} value={a.id} className="bg-[#0D1322]">
                        {a.nama_afdeling} ({a.kode_afdeling})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Ringkasan KPI Spasial & Produksi */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-xl bg-[#0D1322] border border-[#1E2942]">
                  <div className="text-[11px] text-[#8B9BB4] font-semibold">Luas Ukur GIS (PostGIS)</div>
                  <div className="text-xl sm:text-2xl font-extrabold text-[#00D2FF] mt-1 font-mono">
                    {(stats?.total_luas_ha || 0).toLocaleString('id-ID', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    Ha
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] mt-1">
                    {stats?.total_fitur || 0} Poligon Blok Aktif
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0D1322] border border-[#1E2942]">
                  <div className="text-[11px] text-[#8B9BB4] font-semibold">Luas Baku Dokumen</div>
                  <div className="text-xl sm:text-2xl font-extrabold text-white mt-1 font-mono">
                    {(stats?.total_luas_baku_ha || stats?.total_luas_ha || 0).toLocaleString(
                      'id-ID',
                      { maximumFractionDigits: 2 }
                    )}{' '}
                    Ha
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] mt-1">
                    Komoditas: <span className="text-[#10B981] font-semibold">{stats?.komoditas || 'Perkebunan'}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0D1322] border border-[#1E2942]">
                  <div className="text-[11px] text-[#8B9BB4] font-semibold">
                    Estimasi Hasil Panen ({stats?.commodity_profile?.yieldUnit || 'Ton'})
                  </div>
                  <div className="text-xl sm:text-2xl font-extrabold text-[#10B981] mt-1 font-mono">
                    {(stats?.estimasi_panen_ton || 0).toLocaleString('id-ID', {
                      maximumFractionDigits: 1,
                    })}{' '}
                    Ton
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] mt-1">
                    Standar Produktivitas {stats?.commodity_profile?.yieldPerHa || '-'} Ton/Ha
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0D1322] border border-[#1E2942]">
                  <div className="text-[11px] text-[#8B9BB4] font-semibold">
                    {stats?.commodity_profile?.processedLabel || 'Proyeksi Hasil Olahan'}
                  </div>
                  <div className="text-xl sm:text-2xl font-extrabold text-amber-400 mt-1 font-mono">
                    {(stats?.estimasi_olahan_ton || 0).toLocaleString('id-ID', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    Ton
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] mt-1">
                    Total {stats?.total_kebun || kebunList.length} Kebun · {stats?.total_layer || layersList.length} Layer
                  </div>
                </div>
              </div>

              {/* Panel Diagram Visualisasi & Tabel Atribut */}
              {!canViewMap ? (
                <div className="p-8 rounded-2xl bg-[#0D1322] border border-[#1E2942] text-center space-y-3">
                  <div className="text-sm font-bold text-white">
                    Akses Lihat Peta &amp; Statistik Spasial Belum Diaktifkan
                  </div>
                  <p className="text-xs text-[#8B9BB4] max-w-md mx-auto leading-relaxed">
                    Akun Anda belum memiliki izin <strong className="text-[#00D2FF]">Lihat Peta &amp; Statistik Spasial</strong>. Hubungi Administrator untuk mengaktifkan hak akses ini.
                  </p>
                </div>
              ) : (
                <MonitoringBottomPanel
                  embedded={true}
                  isOpen={true}
                  layers={filteredAnalisaLayers}
                  selectedLayerId={analisaLayerId}
                  onSelectLayer={(id) => setAnalisaLayerId(id)}
                  selectedFeatureId={analisaFeatureId}
                  onSelectFeature={(id) => setAnalisaFeatureId(id)}
                  selectedKebunId={analisaKebunId}
                  selectedAfdelingId={analisaAfdelingId}
                  kebunList={kebunList}
                  afdelingList={effectiveAnalisaAfdeling}
                  stats={stats}
                  onFeatureDeleted={canDeleteData ? () => fetchAllData() : undefined}
                />
              )}
            </div>
          )}

          {/* VIEW 2: DATA PERUSAHAAN (TERPISAH DARI DATA KEBUN) */}
          {activeMenu === 'data_perusahaan' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {perusahaanSummaries.map((ent) => (
                  <div
                    key={ent.code}
                    className="p-5 rounded-2xl bg-[#0D1322] border border-[#1E2942] flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-xs text-[#0A0E1A] shrink-0"
                            style={{ backgroundColor: ent.color }}
                          >
                            {ent.code}
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-white">{ent.label}</h3>
                            <p className="text-[11px] text-[#8B9BB4]">
                              {ent.fullName} · Komoditas:{' '}
                              <span className="text-white font-semibold">{ent.commodityLabel}</span>
                            </p>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-[#12192B] border border-[#1E2942] text-[10px] font-mono text-[#00D2FF]">
                          {ent.kebunCount} Unit Kebun
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2.5 pt-1">
                        <div className="p-2.5 rounded-xl bg-[#12192B] border border-[#1E2942]">
                          <div className="text-[10px] text-[#8B9BB4]">Wilayah Provinsi</div>
                          <div className="text-sm font-bold text-white font-mono mt-0.5">
                            {ent.provinsiList.length || 0}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-[#12192B] border border-[#1E2942]">
                          <div className="text-[10px] text-[#8B9BB4]">Layer GIS</div>
                          <div className="text-sm font-bold text-[#00D2FF] font-mono mt-0.5">
                            {ent.layerCount} SHP
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-[#12192B] border border-[#1E2942]">
                          <div className="text-[10px] text-[#8B9BB4]">Poligon Blok</div>
                          <div className="text-sm font-bold text-[#10B981] font-mono mt-0.5">
                            {ent.totalFitur}
                          </div>
                        </div>
                      </div>

                      {/* Daftar Kebun di bawah Perusahaan ini */}
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[11px] font-semibold text-[#8B9BB4]">
                          Unit Kebun di bawah {ent.code}:
                        </div>
                        {ent.kebunItems.length === 0 ? (
                          <div className="p-2.5 rounded-xl bg-[#12192B]/50 border border-[#1E2942] text-[11px] text-[#566680] italic">
                            Belum ada unit kebun yang terdaftar pada {ent.code}.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {ent.kebunItems.map((k) => (
                              <div
                                key={k.id}
                                className="px-3 py-2 rounded-xl bg-[#12192B] border border-[#1E2942] flex items-center justify-between text-xs"
                              >
                                <div className="min-w-0">
                                  <span className="font-bold text-white">{k.nama_kebun}</span>
                                  <span className="text-[10px] text-[#8B9BB4] ml-2">
                                    ({k.wilayah || k.provinsi || '-'})
                                  </span>
                                </div>
                                <span className="text-[10px] font-mono text-[#10B981] shrink-0">
                                  {k.komoditas || ent.commodityLabel}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-[#1E2942] flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setKebunPerusahaanFilter(ent.label);
                          setActiveMenu('data_kebun');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-[11px] font-semibold text-[#00D2FF] transition-colors cursor-pointer"
                      >
                        Kelola Kebun &amp; Afdeling ({ent.kebunCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAnalisaPerusahaan(ent.label);
                          setAnalisaKebunId(null);
                          setActiveMenu('hasil_analisa');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#00D2FF]/15 hover:bg-[#00D2FF]/25 border border-[#00D2FF]/40 text-[11px] font-bold text-[#00D2FF] transition-colors cursor-pointer"
                      >
                        Lihat Diagram Analisa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VIEW 3: DATA KEBUN & DATA AFDELING SETIAP KEBUN */}
          {activeMenu === 'data_kebun' && (
            <div className="space-y-4">
              {/* Filter Bar Data Kebun */}
              <div className="p-4 rounded-2xl bg-[#0D1322] border border-[#1E2942] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <IconSearch className="w-4 h-4 text-[#8B9BB4] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={kebunSearch}
                    onChange={(e) => setKebunSearch(e.target.value)}
                    placeholder="Cari nama kebun, kode kebun, provinsi, kabupaten, atau komoditas..."
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder:text-[#566680] focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={kebunPerusahaanFilter}
                    onChange={(e) => setKebunPerusahaanFilter(e.target.value)}
                    className="bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-[#0D1322]">Semua Perusahaan</option>
                    {RPN_ENTITY_OPTIONS.map((p) => (
                      <option key={p} value={p} className="bg-[#0D1322]">
                        {p}
                      </option>
                    ))}
                  </select>
                  {kebunPerusahaanFilter && (
                    <button
                      type="button"
                      onClick={() => setKebunPerusahaanFilter('')}
                      className="px-2.5 py-2 rounded-xl bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-xs text-[#8B9BB4] hover:text-white cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* Daftar Kartu Unit Kebun + Data Afdeling di dalamnya */}
              {filteredKebunRecords.length === 0 ? (
                <div className="p-10 rounded-2xl bg-[#0D1322] border border-[#1E2942] text-center text-xs text-[#8B9BB4]">
                  Tidak ada data unit kebun yang ditemukan.
                </div>
              ) : (
                <div className="space-y-3.5">
                  {filteredKebunRecords.map((k) => {
                    const isExpanded = expandedKebunId === k.id;
                    const kebunAfdelings = afdelingList.filter((a) => a.kebun_id === k.id);
                    const kebunLayers = layersList.filter((l) => Number(l.kebun_id) === k.id);
                    const totalPoligon = kebunLayers.reduce(
                      (acc, l) => acc + (Number(l.jumlah_fitur) || 0),
                      0
                    );

                    return (
                      <div
                        key={k.id}
                        className="rounded-2xl bg-[#0D1322] border border-[#1E2942] overflow-hidden"
                      >
                        {/* Header Baris Kebun */}
                        <div
                          onClick={() => setExpandedKebunId(isExpanded ? null : k.id)}
                          className="p-4 hover:bg-[#12192B]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer transition-colors"
                        >
                          <div className="flex items-start sm:items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-[#10B981]/15 border border-[#10B981]/40 text-[#10B981] font-extrabold text-xs flex items-center justify-center shrink-0 font-mono">
                              #{k.id}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-sm font-bold text-white">{k.nama_kebun}</h3>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#12192B] border border-[#1E2942] text-[#00D2FF]">
                                  {k.kode_kebun}
                                </span>
                                {k.komoditas && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#10B981]/15 border border-[#10B981]/40 text-[#10B981]">
                                    {k.komoditas}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-[#8B9BB4] mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span>
                                  Perusahaan:{' '}
                                  <strong className="text-[#E2E8F0]">
                                    {k.perusahaan || 'PT RPN'}
                                  </strong>
                                </span>
                                <span>·</span>
                                <span>
                                  Provinsi:{' '}
                                  <strong className="text-[#00D2FF]">
                                    {k.provinsi || k.wilayah || '-'}
                                  </strong>
                                </span>
                                {k.kabupaten_kota && (
                                  <>
                                    <span>·</span>
                                    <span>
                                      Kab/Kota:{' '}
                                      <strong className="text-[#E2E8F0]">{k.kabupaten_kota}</strong>
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div
                            className="flex items-center gap-2 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => setExpandedKebunId(isExpanded ? null : k.id)}
                              className="px-3 py-1.5 rounded-lg bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-xs font-semibold text-[#00D2FF] cursor-pointer"
                            >
                              {kebunAfdelings.length} Afdeling · {kebunLayers.length} Layer ({totalPoligon} Blok)
                            </button>

                            {canEditData && (
                              <button
                                type="button"
                                onClick={() => openEditKebunModal(k)}
                                className="p-1.5 rounded-lg bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-[#8B9BB4] hover:text-[#00D2FF] cursor-pointer"
                                title="Edit Data Kebun"
                              >
                                <IconPencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDeleteData && (
                              <button
                                type="button"
                                onClick={() => handleDeleteKebun(k)}
                                className="p-1.5 rounded-lg bg-[#12192B] hover:bg-rose-500/20 border border-[#1E2942] text-[#8B9BB4] hover:text-rose-400 cursor-pointer"
                                title="Hapus Unit Kebun"
                              >
                                <IconTrash className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Bagian Dalam: Data Afdeling Setiap Kebun */}
                        {isExpanded && (
                          <div className="p-4 bg-[#090D18] border-t border-[#1E2942] space-y-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="text-xs font-bold text-[#00D2FF] uppercase tracking-wider">
                                  Daftar Afdeling pada {k.nama_kebun}
                                </h4>
                                <p className="text-[11px] text-[#8B9BB4]">
                                  Data afdeling yang terdaftar di database untuk unit kebun ini.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setAnalisaKebunId(k.id);
                                  setAnalisaLayerId(kebunLayers[0]?.id ?? null);
                                  setActiveMenu('hasil_analisa');
                                }}
                                className="px-3 py-1 rounded-lg bg-[#00D2FF]/15 hover:bg-[#00D2FF]/25 border border-[#00D2FF]/40 text-[11px] font-bold text-[#00D2FF] cursor-pointer"
                              >
                                Buka Analisa Kebun Ini
                              </button>
                            </div>

                            {kebunAfdelings.length === 0 ? (
                              <div className="p-3 rounded-xl bg-[#0D1322] border border-[#1E2942] text-xs text-[#8B9BB4]">
                                Belum ada afdeling di tabel database untuk {k.nama_kebun}. Anda dapat menambahkan afdeling di bawah ini.
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                {kebunAfdelings.map((afd) => (
                                  <div
                                    key={afd.id}
                                    className="p-3 rounded-xl bg-[#0D1322] border border-[#1E2942] flex items-center justify-between gap-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-xs font-bold text-white truncate">
                                        {afd.nama_afdeling}
                                      </div>
                                      <div className="text-[10px] font-mono text-[#00D2FF] mt-0.5">
                                        Kode: {afd.kode_afdeling}
                                      </div>
                                      {afd.keterangan && (
                                        <div className="text-[10px] text-[#8B9BB4] truncate mt-0.5">
                                          {afd.keterangan}
                                        </div>
                                      )}
                                    </div>
                                    {canDeleteData && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteAfdeling(afd)}
                                        className="p-1.5 rounded-lg bg-[#12192B] hover:bg-rose-500/20 border border-[#1E2942] text-[#8B9BB4] hover:text-rose-400 shrink-0 cursor-pointer"
                                        title={`Hapus ${afd.nama_afdeling}`}
                                      >
                                        <IconTrash className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Form Tambah Afdeling ke Kebun Ini */}
                            {canEditData && (
                              <form
                                onSubmit={(e) => handleAddAfdeling(e, k.id)}
                                className="p-3.5 rounded-xl bg-[#0D1322] border border-[#1E2942] grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end"
                              >
                                <div>
                                  <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                                    Nama Afdeling Baru *
                                  </label>
                                  <input
                                    type="text"
                                    value={newAfdNama}
                                    onChange={(e) => setNewAfdNama(e.target.value)}
                                    placeholder="Contoh: Afdeling I / Rayon A"
                                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                                    required
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                                    Kode Afdeling (Opsional)
                                  </label>
                                  <input
                                    type="text"
                                    value={newAfdKode}
                                    onChange={(e) => setNewAfdKode(e.target.value)}
                                    placeholder="Otomatis jika kosong"
                                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-semibold text-[#8B9BB4] mb-1">
                                    Keterangan
                                  </label>
                                  <input
                                    type="text"
                                    value={newAfdKeterangan}
                                    onChange={(e) => setNewAfdKeterangan(e.target.value)}
                                    placeholder="Keterangan afdeling"
                                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                                  />
                                </div>
                                <button
                                  type="submit"
                                  disabled={savingAfd}
                                  className="px-3 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#059669] text-[#05130D] font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {savingAfd ? 'Menyimpan...' : '+ Tambah Afdeling'}
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* VIEW 3B: HAK SEMENTARA (PENGAJUAN KARYAWAN & VALIDASI ADMIN) */}
          {activeMenu === 'hak_sementara' && (
            <div className="space-y-5">
              {/* Form Pengajuan Hak Sementara (Untuk Karyawan / Staff) */}
              {!canManage && (
                <form
                  onSubmit={handleRequestHakSementara}
                  className="p-5 rounded-2xl bg-[#0D1322] border border-[#1E2942] space-y-4"
                >
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Ajukan Permintaan Hak Akses Sementara kepada Admin
                    </h3>
                    <p className="text-[11px] text-[#8B9BB4] mt-0.5">
                      Pilih salah satu dari 2 hak akses sementara di bawah ini. Setelah disetujui Admin, tombol fitur akan otomatis terbuka di halaman Peta GIS dan Dashboard.
                    </p>
                  </div>

                  {/* 2 Pilihan Jenis Hak Sementara */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div
                      onClick={() => setSelectedJenisHak('upload_layer')}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                        selectedJenisHak === 'upload_layer'
                          ? 'bg-[#132238] border-[#00D2FF] shadow-md shadow-[#00D2FF]/10'
                          : 'bg-[#12192B] border-[#1E2942] hover:border-[#2C3B59]'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-white">
                            1. Hak Upload Data GIS (Upload Layer)
                          </span>
                          {canUploadLayer && (
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/40">
                              Sudah Aktif
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#8B9BB4] leading-relaxed">
                          Membuka tombol <strong className="text-[#00D2FF]">+ Upload Data</strong> di halaman peta untuk mengunggah arsip ZIP Shapefile (.shp), GeoJSON, atau GeoTIFF baru.
                        </p>
                      </div>
                      <input
                        type="radio"
                        name="jenis_hak"
                        checked={selectedJenisHak === 'upload_layer'}
                        onChange={() => setSelectedJenisHak('upload_layer')}
                        className="mt-1 accent-[#00D2FF]"
                      />
                    </div>

                    <div
                      onClick={() => setSelectedJenisHak('edit_data')}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                        selectedJenisHak === 'edit_data'
                          ? 'bg-[#132238] border-[#00D2FF] shadow-md shadow-[#00D2FF]/10'
                          : 'bg-[#12192B] border-[#1E2942] hover:border-[#2C3B59]'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-white">
                            2. Hak Edit Data, Poligon &amp; Kebun (Edit Data)
                          </span>
                          {canEditData && (
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/40">
                              Sudah Aktif
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#8B9BB4] leading-relaxed">
                          Membuka fitur <strong className="text-[#00D2FF]">Ganti Nama Layer</strong>, <strong className="text-[#00D2FF]">Digitasi Petak Baru</strong> di peta, serta <strong className="text-[#00D2FF]">Tambah/Edit Kebun &amp; Afdeling</strong>.
                        </p>
                      </div>
                      <input
                        type="radio"
                        name="jenis_hak"
                        checked={selectedJenisHak === 'edit_data'}
                        onChange={() => setSelectedJenisHak('edit_data')}
                        className="mt-1 accent-[#00D2FF]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                        Alasan / Keperluan Pengajuan (Opsional)
                      </label>
                      <input
                        type="text"
                        value={alasanHakSementara}
                        onChange={(e) => setAlasanHakSementara(e.target.value)}
                        placeholder="Contoh: Perlu upload data shapefile kebun baru atau revisi nama layer..."
                        className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-[#566680] focus:outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submittingHakSementara}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#00D2FF] to-[#10B981] hover:opacity-95 text-[#05131A] font-extrabold text-xs shadow-lg shadow-[#00D2FF]/20 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {submittingHakSementara
                        ? 'Mengirim Permintaan...'
                        : `Minta ${
                            selectedJenisHak === 'upload_layer'
                              ? 'Hak Upload Data GIS'
                              : 'Hak Edit Data & Layer'
                          }`}
                    </button>
                  </div>
                </form>
              )}

              {/* Tabel Daftar Permintaan Hak Sementara */}
              <div className="p-5 rounded-2xl bg-[#0D1322] border border-[#1E2942] space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      {canManage
                        ? 'Daftar Permintaan Hak Akses Sementara Karyawan'
                        : 'Riwayat Pengajuan Hak Sementara Anda'}
                    </h3>
                    <p className="text-[11px] text-[#8B9BB4]">
                      {canManage
                        ? 'Klik "Setujui & Aktifkan" untuk membuka akses karyawan, atau "Cabut Hak" untuk mengembalikan batasan semula.'
                        : 'Status pengajuan Anda akan otomatis berubah menjadi Disetujui & Aktif setelah dikonfirmasi Admin.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {pendingHakCount > 0 && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold">
                        {pendingHakCount} Menunggu Konfirmasi
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => fetchAllData()}
                      className="px-3 py-1.5 rounded-xl bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-xs text-[#8B9BB4] hover:text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <IconRefresh className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-[#1E2942]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#12192B] text-[#8B9BB4] border-b border-[#1E2942] text-[11px] uppercase tracking-wider">
                        <th className="py-3 px-4 font-bold">Waktu Pengajuan</th>
                        <th className="py-3 px-4 font-bold">Nama Karyawan</th>
                        <th className="py-3 px-4 font-bold">Jenis Hak Diminta</th>
                        <th className="py-3 px-4 font-bold">Alasan / Keperluan</th>
                        <th className="py-3 px-4 font-bold">Status</th>
                        {canManage && <th className="py-3 px-4 font-bold text-right">Konfirmasi Admin</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E2942]/70">
                      {hakSementaraList.length === 0 ? (
                        <tr>
                          <td colSpan={canManage ? 6 : 5} className="py-10 text-center text-[#8B9BB4]">
                            Belum ada pengajuan hak akses sementara.
                          </td>
                        </tr>
                      ) : (
                        hakSementaraList.map((item) => {
                          const isUpload = item.jenis_hak === 'upload_layer';
                          const isBusy = processingHakId === item.id;
                          return (
                            <tr key={item.id} className="hover:bg-[#12192B]/60 transition-colors">
                              <td className="py-3 px-4 font-mono text-[11px] text-[#8B9BB4] whitespace-nowrap">
                                {formatWaktuLengkap(item.dibuat_pada)}
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-bold text-white">{item.nama_pengguna}</div>
                                <div className="text-[10px] font-mono text-[#8B9BB4]">
                                  ID: {item.email}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-flex px-2.5 py-0.5 rounded-md text-[11px] font-bold border ${
                                    isUpload
                                      ? 'bg-[#00D2FF]/15 text-[#00D2FF] border-[#00D2FF]/40'
                                      : 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                                  }`}
                                >
                                  {isUpload ? 'Hak Upload Data GIS' : 'Hak Edit Data & Layer'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-[#E2E8F0]">
                                {item.alasan || <span className="text-[#566680] italic">Tidak ada catatan</span>}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                {item.status === 'pending' && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                    <span>Menunggu Konfirmasi</span>
                                  </span>
                                )}
                                {item.status === 'disetujui' && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    <span>Disetujui &amp; Aktif</span>
                                  </span>
                                )}
                                {item.status === 'ditolak' && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/40">
                                    <span>Ditolak</span>
                                  </span>
                                )}
                                {item.status === 'dicabut' && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-500/20 text-slate-300 border border-slate-500/40">
                                    <span>Dicabut Kembali</span>
                                  </span>
                                )}
                              </td>
                              {canManage && (
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5">
                                    {item.status === 'pending' && (
                                      <>
                                        <button
                                          type="button"
                                          disabled={isBusy}
                                          onClick={() => handleConfirmHakSementara(item.id, 'setujui')}
                                          className="px-3 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#059669] text-[#05130D] font-extrabold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                          Setujui &amp; Aktifkan
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isBusy}
                                          onClick={() => handleConfirmHakSementara(item.id, 'tolak')}
                                          className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                          Tolak
                                        </button>
                                      </>
                                    )}
                                    {item.status === 'disetujui' && (
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleConfirmHakSementara(item.id, 'cabut')}
                                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                                      >
                                        Cabut Hak Sementara
                                      </button>
                                    )}
                                    {(item.status === 'ditolak' || item.status === 'dicabut') && (
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleConfirmHakSementara(item.id, 'setujui')}
                                        className="px-2.5 py-1.5 rounded-lg bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-[#00D2FF] font-semibold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                                      >
                                        Aktifkan Kembali
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
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

          {/* VIEW 4: MANAJEMEN PENGGUNA */}
          {activeMenu === 'manajemen_pengguna' && canManage && (
            <div className="space-y-5">
              {pendingHakCount > 0 && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-amber-300">
                      Terdapat {pendingHakCount} Permintaan Hak Sementara Karyawan Menunggu Konfirmasi Anda
                    </div>
                    <p className="text-[11px] text-amber-200/80">
                      Karyawan mengajukan izin sementara untuk Upload Data GIS atau Edit Data &amp; Layer.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('hak_sementara')}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0A0E1A] font-extrabold text-xs transition-colors cursor-pointer shrink-0"
                  >
                    Buka Konfirmasi Hak Sementara ({pendingHakCount})
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-xl bg-[#0D1322] border border-[#1E2942]">
                  <div className="text-[11px] text-[#8B9BB4] font-semibold">Total Pengguna</div>
                  <div className="text-2xl font-extrabold text-white mt-1 font-mono">
                    {statsSummary.total}
                  </div>
                  <div className="text-[10px] text-[#00D2FF] mt-1">Tersimpan di Database</div>
                </div>
                <div className="p-4 rounded-xl bg-[#0D1322] border border-[#1E2942]">
                  <div className="text-[11px] text-[#8B9BB4] font-semibold">Role Administrator</div>
                  <div className="text-2xl font-extrabold text-[#00D2FF] mt-1 font-mono">
                    {statsSummary.totalAdmin}
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] mt-1">Akses Penuh Sistem</div>
                </div>
                <div className="p-4 rounded-xl bg-[#0D1322] border border-[#1E2942]">
                  <div className="text-[11px] text-[#8B9BB4] font-semibold">Role Karyawan / Staff</div>
                  <div className="text-2xl font-extrabold text-[#10B981] mt-1 font-mono">
                    {statsSummary.totalStaff}
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] mt-1">Akses Sesuai Konfigurasi</div>
                </div>
                <div className="p-4 rounded-xl bg-[#0D1322] border border-[#1E2942]">
                  <div className="text-[11px] text-[#8B9BB4] font-semibold">Status Akun Aktif</div>
                  <div className="text-2xl font-extrabold text-emerald-400 mt-1 font-mono">
                    {statsSummary.totalAktif}
                  </div>
                  <div className="text-[10px] text-[#8B9BB4] mt-1">Dapat Login ke Sistem</div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#0D1322] border border-[#1E2942] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-md">
                    <IconSearch className="w-4 h-4 text-[#8B9BB4] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari Nama, ID Pengguna (EMP-0001), atau ID Login..."
                      className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder:text-[#566680] focus:outline-none transition-colors"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={roleFilter}
                      onChange={(e) => setRoleFilter(e.target.value as 'all' | Peran)}
                      className="bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                    >
                      <option value="all" className="bg-[#0D1322]">Semua Role</option>
                      <option value="admin" className="bg-[#0D1322]">Admin</option>
                      <option value="pengguna" className="bg-[#0D1322]">Karyawan / Staff</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => fetchAllData()}
                      className="px-3 py-2 rounded-xl bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-xs text-[#8B9BB4] hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Muat ulang dari database"
                    >
                      <IconRefresh className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
                      <span className="hidden sm:inline">Refresh</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-[#1E2942]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#12192B] text-[#8B9BB4] border-b border-[#1E2942] text-[11px] uppercase tracking-wider">
                        <th className="py-3 px-4 font-bold">ID &amp; Nama Pengguna</th>
                        <th className="py-3 px-4 font-bold">ID Login / Username</th>
                        <th className="py-3 px-4 font-bold">Role</th>
                        <th className="py-3 px-4 font-bold">Hak Akses Fitur GIS</th>
                        <th className="py-3 px-4 font-bold">Status</th>
                        {canManage && <th className="py-3 px-4 font-bold text-right">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E2942]/70 bg-[#0D1322]">
                      {loadingData ? (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-[#8B9BB4]">
                            Memuat data pengguna dari database...
                          </td>
                        </tr>
                      ) : filteredKaryawan.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-[#8B9BB4]">
                            Tidak ada pengguna yang cocok dengan pencarian.
                          </td>
                        </tr>
                      ) : (
                        filteredKaryawan.map((item) => {
                          const isCurrentUser = item.id === user?.id;
                          const perms = normalizeHakAkses(item.hak_akses, item.peran);

                          return (
                            <tr key={item.id} className="hover:bg-[#12192B]/60 transition-colors">
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-full bg-[#0E3A5D] border border-[#00D2FF]/50 text-[#00D2FF] font-bold text-xs flex items-center justify-center overflow-hidden shrink-0">
                                    {item.foto_profil ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={item.foto_profil}
                                        alt={item.nama}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <span>{item.nama.substring(0, 2).toUpperCase()}</span>
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-bold text-white flex items-center gap-1.5">
                                      <span>{item.nama}</span>
                                      {isCurrentUser && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-[#00D2FF]/15 text-[#00D2FF] border border-[#00D2FF]/30">
                                          Anda
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] font-mono text-[#8B9BB4] mt-0.5">
                                      ID: <span className="text-[#00D2FF]">{item.kode_karyawan}</span> (#{item.id}) · Dibuat {formatTanggal(item.dibuat_pada)}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="py-3.5 px-4 font-mono text-xs text-[#E2E8F0]">
                                {item.email}
                              </td>

                              <td className="py-3.5 px-4">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide border ${
                                    item.peran === 'admin'
                                      ? 'bg-[#00D2FF]/15 text-[#00D2FF] border-[#00D2FF]/40'
                                      : 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/40'
                                  }`}
                                >
                                  {item.peran === 'admin' ? 'Admin' : 'Karyawan'}
                                </span>
                              </td>

                              <td className="py-3.5 px-4">
                                <div className="flex flex-wrap gap-1 max-w-xs">
                                  {PERMISSION_ITEMS.map((p) => {
                                    const enabled = perms[p.key];
                                    return (
                                      <span
                                        key={p.key}
                                        className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                                          enabled
                                            ? 'bg-[#12192B] text-[#F0F6FC] border-[#00D2FF]/40'
                                            : 'bg-[#090D18] text-[#566680] border-[#1E2942] line-through'
                                        }`}
                                        title={`${p.title}: ${enabled ? 'Diizinkan' : 'Tidak Diizinkan'}`}
                                      >
                                        {p.shortLabel}
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>

                              <td className="py-3.5 px-4">
                                <button
                                  type="button"
                                  disabled={!canManage || isCurrentUser}
                                  onClick={() => handleToggleStatus(item)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                                    item.aktif
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                      : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                                  } ${
                                    canManage && !isCurrentUser
                                      ? 'cursor-pointer hover:opacity-85'
                                      : 'cursor-default'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                      item.aktif ? 'bg-emerald-400' : 'bg-rose-400'
                                    }`}
                                  />
                                  <span>{item.aktif ? 'Aktif' : 'Nonaktif'}</span>
                                </button>
                              </td>

                              {canManage && (
                                <td className="py-3.5 px-4 text-right">
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openEditModal(item)}
                                      className="px-2.5 py-1.5 rounded-lg bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] hover:border-[#00D2FF]/50 text-[#00D2FF] text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                    >
                                      <IconPencil className="w-3 h-3" />
                                      <span>Edit Akses</span>
                                    </button>
                                    {!isCurrentUser && (
                                      <button
                                        type="button"
                                        onClick={() => setDeleteTarget(item)}
                                        className="p-1.5 rounded-lg bg-[#12192B] hover:bg-rose-500/20 border border-[#1E2942] hover:border-rose-500/40 text-[#8B9BB4] hover:text-rose-400 transition-colors cursor-pointer"
                                        title={`Hapus akun ${item.nama}`}
                                      >
                                        <IconTrash className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
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

          {/* VIEW 5: CREATE ACCOUNT */}
          {activeMenu === 'create_account' && canManage && (
            <form
              onSubmit={handleCreateAccount}
              className="grid grid-cols-1 lg:grid-cols-12 gap-5"
              noValidate
            >
              <div className="lg:col-span-5 p-5 rounded-2xl bg-[#0D1322] border border-[#1E2942] space-y-4 h-fit">
                <div className="border-b border-[#1E2942] pb-3">
                  <h2 className="text-sm font-bold text-white">Buat Akun Pengguna Baru</h2>
                  <p className="text-[11px] text-[#8B9BB4] mt-0.5">
                    Bebas menggunakan ID atau Username apa saja tanpa wajib format Google/Gmail.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-[#12192B] border border-[#1E2942] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-[#0E3A5D] border border-[#00D2FF]/60 text-[#00D2FF] font-bold text-sm flex items-center justify-center overflow-hidden shrink-0">
                      {newFotoProfil ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={newFotoProfil}
                          alt="Preview Foto Profil"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{newNama ? newNama.substring(0, 2).toUpperCase() : 'FP'}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">Foto Profil (Opsional)</div>
                      <div className="text-[10px] text-[#8B9BB4]">Format JPG, PNG, atau WebP</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      ref={createPhotoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        try {
                          const dataUrl = await resizeImageToAvatarDataUrl(file);
                          setNewFotoProfil(dataUrl);
                        } catch (err) {
                          setBanner({ type: 'error', text: (err as Error).message });
                        }
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => createPhotoInputRef.current?.click()}
                      className="px-2.5 py-1.5 rounded-lg bg-[#0D1322] hover:bg-[#19233A] border border-[#1E2942] hover:border-[#00D2FF]/50 text-[11px] font-semibold text-[#00D2FF] flex items-center gap-1 cursor-pointer"
                    >
                      <IconCamera className="w-3.5 h-3.5" />
                      <span>Upload</span>
                    </button>
                    {newFotoProfil && (
                      <button
                        type="button"
                        onClick={() => setNewFotoProfil(null)}
                        className="p-1.5 rounded-lg bg-[#0D1322] hover:bg-rose-500/20 border border-[#1E2942] text-[#8B9BB4] hover:text-rose-400 cursor-pointer"
                        title="Hapus foto"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1.5">
                    Nama / Username Pengguna <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={newNama}
                    onChange={(e) => setNewNama(e.target.value)}
                    placeholder="Contoh: karyawan, budi_santoso, atau nama bebas"
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-[#566680] focus:outline-none transition-colors"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1.5">
                    ID Akun / Username Login
                  </label>
                  <input
                    type="text"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Contoh: karyawan123, EMP-02, atau ID bebas"
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-[#566680] focus:outline-none transition-colors"
                  />
                  <p className="text-[10px] text-[#8B9BB4] mt-1">
                    Bebas menggunakan ID atau username apa saja untuk login.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1.5">
                    Password Akun <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimal 4 karakter"
                      className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-white placeholder:text-[#566680] focus:outline-none transition-colors"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((p) => !p)}
                      className="absolute right-2.5 p-1 text-[#8B9BB4] hover:text-white cursor-pointer"
                    >
                      {showNewPassword ? (
                        <IconEye className="w-4 h-4" />
                      ) : (
                        <IconEyeOff className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-[#E2E8F0] mb-1.5">
                      Pilih Role
                    </label>
                    <select
                      value={newPeran}
                      onChange={(e) => handleSelectNewRole(e.target.value as Peran)}
                      className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
                    >
                      <option value="pengguna" className="bg-[#0D1322]">Karyawan / Staff</option>
                      <option value="admin" className="bg-[#0D1322]">Admin</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#E2E8F0] mb-1.5">
                      Status Akun
                    </label>
                    <select
                      value={newAktif ? 'aktif' : 'nonaktif'}
                      onChange={(e) => setNewAktif(e.target.value === 'aktif')}
                      className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
                    >
                      <option value="aktif" className="bg-[#0D1322]">Aktif (Bisa Login)</option>
                      <option value="nonaktif" className="bg-[#0D1322]">Nonaktif</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 p-5 rounded-2xl bg-[#0D1322] border border-[#1E2942] flex flex-col justify-between space-y-5">
                <div className="space-y-4">
                  <div className="border-b border-[#1E2942] pb-3 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-white">Pengaturan Hak Akses Fitur GIS</h2>
                      <p className="text-[11px] text-[#8B9BB4] mt-0.5">
                        Otomatis menyesuaikan pilihan Role ({newPeran === 'admin' ? 'Admin' : 'Karyawan'}), atau atur manual.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setNewHakAkses({ ...DEFAULT_HAK_AKSES_ADMIN })}
                        className="px-2.5 py-1 rounded-lg bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-[10px] font-semibold text-[#00D2FF] cursor-pointer"
                      >
                        Aktifkan Semua
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewHakAkses({ ...DEFAULT_HAK_AKSES_KARYAWAN })}
                        className="px-2.5 py-1 rounded-lg bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-[10px] font-semibold text-[#8B9BB4] cursor-pointer"
                      >
                        Default Staff
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-[#1E2942]/70 rounded-xl border border-[#1E2942] bg-[#12192B]/50 overflow-hidden">
                    {PERMISSION_ITEMS.map((perm) => {
                      const checked = newHakAkses[perm.key];
                      return (
                        <div
                          key={perm.key}
                          onClick={() =>
                            setNewHakAkses((prev) => ({
                              ...prev,
                              [perm.key]: !prev[perm.key],
                            }))
                          }
                          className="p-3.5 flex items-center justify-between gap-4 hover:bg-[#12192B] transition-colors cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white">{perm.title}</div>
                            <div className="text-[11px] text-[#8B9BB4] mt-0.5">
                              {perm.description}
                            </div>
                          </div>

                          <button
                            type="button"
                            role="switch"
                            aria-checked={checked}
                            onClick={(e) => {
                              e.stopPropagation();
                              setNewHakAkses((prev) => ({
                                ...prev,
                                [perm.key]: !prev[perm.key],
                              }));
                            }}
                            className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center cursor-pointer ${
                              checked
                                ? 'bg-[#00D2FF] justify-end'
                                : 'bg-[#090D18] border border-[#1E2942] justify-start'
                            }`}
                          >
                            <span
                              className={`w-5 h-5 rounded-full shadow-sm transition-transform ${
                                checked ? 'bg-[#051320]' : 'bg-[#566680]'
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-3 border-t border-[#1E2942] flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveMenu('manajemen_pengguna')}
                    className="px-4 py-2.5 rounded-xl bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-xs font-semibold text-[#8B9BB4] hover:text-white transition-colors cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={creating || !canManage}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#00D2FF] to-[#10B981] hover:opacity-95 text-[#05131A] font-extrabold text-xs shadow-lg shadow-[#00D2FF]/20 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <IconCheck className="w-4 h-4" />
                    <span>{creating ? 'Menyimpan ke Database...' : 'Simpan & Buat Akun'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* VIEW 6: LOG AUDIT AKTIVITAS SISTEM */}
          {activeMenu === 'log_audit' && canManage && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#0D1322] border border-[#1E2942] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <IconSearch className="w-4 h-4 text-[#8B9BB4] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Cari nama pengguna, aktivitas (upload, hapus, login), atau keterangan..."
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder:text-[#566680] focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={auditCategory}
                    onChange={(e) => setAuditCategory(e.target.value)}
                    className="bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="all" className="bg-[#0D1322]">Semua Jenis Aktivitas</option>
                    <option value="upload" className="bg-[#0D1322]">Upload Data GIS</option>
                    <option value="delete" className="bg-[#0D1322]">Penghapusan Data</option>
                    <option value="kebun" className="bg-[#0D1322]">Data Kebun &amp; Layer</option>
                    <option value="account" className="bg-[#0D1322]">Manajemen Pengguna</option>
                    <option value="auth" className="bg-[#0D1322]">Login &amp; Sesi</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => fetchAllData()}
                    className="px-3 py-2 rounded-xl bg-[#12192B] hover:bg-[#19233A] border border-[#1E2942] text-xs text-[#8B9BB4] hover:text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <IconRefresh className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              <div className="rounded-2xl bg-[#0D1322] border border-[#1E2942] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#12192B] text-[#8B9BB4] border-b border-[#1E2942] text-[11px] uppercase tracking-wider">
                        <th className="py-3 px-4 font-bold">Waktu Kejadian</th>
                        <th className="py-3 px-4 font-bold">Pelaku (Admin / Karyawan)</th>
                        <th className="py-3 px-4 font-bold">Kategori Aktivitas</th>
                        <th className="py-3 px-4 font-bold">Rincian Kegiatan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E2942]/70">
                      {filteredAuditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-10 text-center text-[#8B9BB4]">
                            Belum ada catatan log audit yang cocok dengan filter.
                          </td>
                        </tr>
                      ) : (
                        filteredAuditLogs.map((log) => {
                          const badge = classifyAuditBadge(log.aktivitas);
                          return (
                            <tr key={log.id} className="hover:bg-[#12192B]/60 transition-colors">
                              <td className="py-3 px-4 font-mono text-[11px] text-[#8B9BB4] whitespace-nowrap">
                                {formatWaktuLengkap(log.dibuat_pada)}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-white">{log.nama_pengguna}</span>
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase border ${
                                      log.role === 'admin'
                                        ? 'bg-[#00D2FF]/15 text-[#00D2FF] border-[#00D2FF]/30'
                                        : 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30'
                                    }`}
                                  >
                                    {log.role === 'admin' ? 'Admin' : 'Karyawan'}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${badge.className}`}
                                >
                                  {badge.label}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-[#E2E8F0]">
                                {log.keterangan || `Melakukan aktivitas ${log.aktivitas}`}
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

          {/* VIEW 7: BACKUP & RIWAYAT */}
          {activeMenu === 'backup_riwayat' && canAccessBackup && (
            <SettingsModal
              isOpen={true}
              embedded={true}
              initialTab="backup"
              onDataChanged={() => fetchAllData()}
            />
          )}
        </div>
      </main>

      {/* MODAL TAMBAH / EDIT UNIT KEBUN */}
      {showAddKebunModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0D1322] border border-[#1E2942] rounded-2xl shadow-2xl overflow-hidden text-[#F0F6FC]">
            <div className="px-5 py-4 bg-[#090D18] border-b border-[#1E2942] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingKebun ? `Edit Data Kebun: ${editingKebun.nama_kebun}` : 'Tambah Unit Kebun Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddKebunModal(false)}
                className="p-1.5 rounded-lg bg-[#12192B] hover:bg-[#1E2942] text-[#8B9BB4] hover:text-white cursor-pointer"
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveKebun} className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Nama Unit Kebun *
                  </label>
                  <input
                    type="text"
                    value={formNamaKebun}
                    onChange={(e) => setFormNamaKebun(e.target.value)}
                    placeholder="Contoh: Kebun Bakalan"
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Kode Kebun *
                  </label>
                  <input
                    type="text"
                    value={formKodeKebun}
                    onChange={(e) => setFormKodeKebun(e.target.value)}
                    placeholder="Contoh: KBN-BKL-01"
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Perusahaan / Puslit Induk
                  </label>
                  <select
                    value={formPerusahaanKebun}
                    onChange={(e) => setFormPerusahaanKebun(e.target.value)}
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    {RPN_ENTITY_OPTIONS.map((p) => (
                      <option key={p} value={p} className="bg-[#0D1322]">
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Komoditas Kebun
                  </label>
                  <input
                    type="text"
                    value={formKomoditasKebun}
                    onChange={(e) => setFormKomoditasKebun(e.target.value)}
                    placeholder="Contoh: Tebu, Teh, Kelapa Sawit"
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Provinsi *
                  </label>
                  <select
                    value={formProvinsiKebun}
                    onChange={(e) => setFormProvinsiKebun(e.target.value)}
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    {PROVINSI_INDONESIA.map((prov) => (
                      <option key={prov} value={prov} className="bg-[#0D1322]">
                        {prov}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Kabupaten / Kota
                  </label>
                  <input
                    type="text"
                    value={formKabupatenKebun}
                    onChange={(e) => setFormKabupatenKebun(e.target.value)}
                    placeholder="Contoh: Kabupaten Asahan / Pasuruan"
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#1E2942] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddKebunModal(false)}
                  className="px-4 py-2 rounded-xl bg-[#12192B] hover:bg-[#1E2942] text-xs font-semibold text-[#8B9BB4] hover:text-white cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingKebun}
                  className="px-4 py-2 rounded-xl bg-[#00D2FF] hover:bg-[#38BDF8] text-[#051320] text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingKebun ? 'Menyimpan...' : 'Simpan Data Kebun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EDIT AKUN & HAK AKSES */}
      {editTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#0D1322] border border-[#1E2942] rounded-2xl shadow-2xl overflow-hidden text-[#F0F6FC]">
            <div className="px-5 py-4 bg-[#090D18] border-b border-[#1E2942] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Edit Akun &amp; Hak Akses: {editTarget.nama} ({editTarget.kode_karyawan})
                </h3>
                <p className="text-[11px] text-[#8B9BB4]">
                  Perubahan langsung diperbarui pada tabel <code className="text-[#00D2FF]">pengguna</code> di database.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="p-1.5 rounded-lg bg-[#12192B] hover:bg-[#1E2942] text-[#8B9BB4] hover:text-white cursor-pointer"
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-4 max-h-[82dvh] overflow-y-auto">
              <div className="p-3 rounded-xl bg-[#12192B] border border-[#1E2942] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-[#0E3A5D] border border-[#00D2FF]/60 text-[#00D2FF] font-bold text-xs flex items-center justify-center overflow-hidden shrink-0">
                    {editFotoProfil ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={editFotoProfil}
                        alt={editNama}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{editNama ? editNama.substring(0, 2).toUpperCase() : 'FA'}</span>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Foto Profil Akun</div>
                    <div className="text-[10px] text-[#8B9BB4]">
                      Ditampilkan pada tombol profil header &amp; daftar pengguna
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    ref={editPhotoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      try {
                        const dataUrl = await resizeImageToAvatarDataUrl(file);
                        setEditFotoProfil(dataUrl);
                      } catch (err) {
                        setBanner({ type: 'error', text: (err as Error).message });
                      }
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => editPhotoInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-[#0D1322] hover:bg-[#19233A] border border-[#1E2942] hover:border-[#00D2FF]/50 text-[11px] font-semibold text-[#00D2FF] flex items-center gap-1 cursor-pointer"
                  >
                    <IconCamera className="w-3.5 h-3.5" />
                    <span>Ganti Foto</span>
                  </button>
                  {editFotoProfil && (
                    <button
                      type="button"
                      onClick={() => setEditFotoProfil(null)}
                      className="p-1.5 rounded-lg bg-[#0D1322] hover:bg-rose-500/20 border border-[#1E2942] text-[#8B9BB4] hover:text-rose-400 cursor-pointer"
                      title="Hapus foto profil"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Nama / Username Pengguna
                  </label>
                  <input
                    type="text"
                    value={editNama}
                    onChange={(e) => setEditNama(e.target.value)}
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    ID Akun / Username Login
                  </label>
                  <input
                    type="text"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Role Akun
                  </label>
                  <select
                    value={editPeran}
                    onChange={(e) => {
                      const nextRole = e.target.value as Peran;
                      setEditPeran(nextRole);
                      setEditHakAkses(
                        nextRole === 'admin'
                          ? { ...DEFAULT_HAK_AKSES_ADMIN }
                          : { ...DEFAULT_HAK_AKSES_KARYAWAN }
                      );
                    }}
                    className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="pengguna" className="bg-[#0D1322]">Karyawan / Staff</option>
                    <option value="admin" className="bg-[#0D1322]">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E2E8F0] mb-1">
                    Reset Password (Opsional)
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showEditPassword ? 'text' : 'password'}
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="Kosongkan jika tidak diubah"
                      className="w-full bg-[#12192B] border border-[#1E2942] focus:border-[#00D2FF] rounded-xl pl-3 pr-9 py-2 text-xs text-white placeholder:text-[#566680] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword((p) => !p)}
                      className="absolute right-2.5 text-[#8B9BB4] hover:text-white cursor-pointer"
                    >
                      {showEditPassword ? (
                        <IconEye className="w-4 h-4" />
                      ) : (
                        <IconEyeOff className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="text-xs font-bold text-white">Hak Akses Fitur GIS</div>
                <div className="divide-y divide-[#1E2942]/70 rounded-xl border border-[#1E2942] bg-[#12192B]/50">
                  {PERMISSION_ITEMS.map((perm) => {
                    const checked = editHakAkses[perm.key];
                    return (
                      <div
                        key={perm.key}
                        onClick={() =>
                          setEditHakAkses((prev) => ({
                            ...prev,
                            [perm.key]: !prev[perm.key],
                          }))
                        }
                        className="p-3 flex items-center justify-between gap-3 hover:bg-[#12192B] cursor-pointer"
                      >
                        <div>
                          <div className="text-xs font-semibold text-white">{perm.title}</div>
                          <div className="text-[10px] text-[#8B9BB4]">{perm.description}</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditHakAkses((prev) => ({
                              ...prev,
                              [perm.key]: !prev[perm.key],
                            }));
                          }}
                          className={`w-10 h-5 rounded-full p-0.5 transition-colors shrink-0 flex items-center cursor-pointer ${
                            checked
                              ? 'bg-[#00D2FF] justify-end'
                              : 'bg-[#090D18] border border-[#1E2942] justify-start'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full ${
                              checked ? 'bg-[#051320]' : 'bg-[#566680]'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-[#1E2942] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="px-4 py-2 rounded-xl bg-[#12192B] hover:bg-[#1E2942] text-xs font-semibold text-[#8B9BB4] hover:text-white cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-xl bg-[#00D2FF] hover:bg-[#38BDF8] text-[#051320] text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI HAPUS AKUN */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0D1322] border border-[#1E2942] rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-400 flex items-center justify-center shrink-0">
                <IconTrash className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Hapus Akun Pengguna?</h3>
                <p className="text-xs text-[#8B9BB4] mt-1 leading-relaxed">
                  Anda akan menghapus akun <strong className="text-white">{deleteTarget.nama}</strong> ({deleteTarget.email}) dengan ID{' '}
                  <strong className="text-[#00D2FF]">{deleteTarget.kode_karyawan}</strong> dari database.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl bg-[#12192B] hover:bg-[#1E2942] text-xs font-semibold text-[#8B9BB4] hover:text-white cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {deleting ? 'Menghapus...' : 'Ya, Hapus Akun'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardManagementPage() {
  return (
    <AuthProvider>
      <DashboardContent />
    </AuthProvider>
  );
}
