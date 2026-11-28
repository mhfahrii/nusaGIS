export const DAFTAR_PERAN = ['admin', 'pengguna'] as const;

export type Peran = (typeof DAFTAR_PERAN)[number];

export interface HakAksesFitur {
  lihat_peta: boolean;
  upload_layer: boolean;
  edit_data: boolean;
  hapus_data: boolean;
  kelola_karyawan: boolean;
}

export const DEFAULT_HAK_AKSES_ADMIN: HakAksesFitur = {
  lihat_peta: true,
  upload_layer: true,
  edit_data: true,
  hapus_data: true,
  kelola_karyawan: true,
};

export const DEFAULT_HAK_AKSES_KARYAWAN: HakAksesFitur = {
  lihat_peta: true,
  upload_layer: false,
  edit_data: false,
  hapus_data: false,
  kelola_karyawan: false,
};

export function normalizeHakAkses(
  raw: unknown,
  peran: Peran = 'pengguna'
): HakAksesFitur {
  const fallback = peran === 'admin' ? DEFAULT_HAK_AKSES_ADMIN : DEFAULT_HAK_AKSES_KARYAWAN;
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const obj = raw as Record<string, unknown>;
  return {
    lihat_peta: typeof obj.lihat_peta === 'boolean' ? obj.lihat_peta : fallback.lihat_peta,
    upload_layer: typeof obj.upload_layer === 'boolean' ? obj.upload_layer : fallback.upload_layer,
    edit_data: typeof obj.edit_data === 'boolean' ? obj.edit_data : fallback.edit_data,
    hapus_data: typeof obj.hapus_data === 'boolean' ? obj.hapus_data : fallback.hapus_data,
    kelola_karyawan:
      typeof obj.kelola_karyawan === 'boolean' ? obj.kelola_karyawan : fallback.kelola_karyawan,
  };
}

export function hasPermission(
  user: PenggunaPublik | null | undefined,
  perm: keyof HakAksesFitur
): boolean {
  if (!user || !user.aktif) return false;
  if (user.peran === 'admin') return true;
  const normalized = normalizeHakAkses(user.hak_akses, user.peran);
  return Boolean(normalized[perm]);
}

/**
 * Data pengguna yang aman dikirim ke frontend.
 * Tidak pernah memuat kata_sandi_hash.
 */
export interface PenggunaPublik {
  id: number;
  nama: string;
  email: string;
  peran: Peran;
  aktif: boolean;
  afdeling_id?: number | null;
  kebun_id?: number | null;
  afdeling_nama?: string | null;
  kebun_nama?: string | null;
  hak_akses?: HakAksesFitur;
  foto_profil?: string | null;
  dibuat_pada: string | null;
}

/** Klaim di dalam token sesi. Sengaja minimal: hanya ID dan peran. */
export interface SessionClaims {
  sub: string;
  peran: Peran;
}
