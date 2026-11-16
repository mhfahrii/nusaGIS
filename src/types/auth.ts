export const DAFTAR_PERAN = ['admin', 'pengguna'] as const;

export type Peran = (typeof DAFTAR_PERAN)[number];

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
  dibuat_pada: string | null;
}

/** Klaim di dalam token sesi. Sengaja minimal: hanya ID dan peran. */
export interface SessionClaims {
  sub: string;
  peran: Peran;
}

