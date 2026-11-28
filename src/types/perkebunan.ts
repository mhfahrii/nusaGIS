export interface Kebun {
  id: string | number;
  kode_kebun: string;
  nama_kebun: string;
  perusahaan?: string | null;
  wilayah: string | null;
  provinsi?: string | null;
  kabupaten_kota?: string | null;
  komoditas: string | null;
  keterangan: string | null;
  dibuat_pada: string | null;
}

export interface Afdeling {
  id: string | number;
  kebun_id: string | number;
  kode_afdeling: string;
  nama_afdeling: string;
  keterangan: string | null;
  dibuat_pada: string | null;
}

export interface Blok {
  id: string | number;
  kebun_id: string | number;
  afdeling_id: string | number | null;
  kode_blok: string;
  nama_blok: string;
  komoditas: string | null;
  tahun_tanam: number | null;
  aktivitas_terakhir?: string | null;
  tanggal_aktivitas_terakhir?: string | null;
  keterangan: string | null;
  dibuat_pada: string | null;
}

export interface MasterAktivitas {
  id: string | number;
  kode_aktivitas: string;
  nama_aktivitas: string;
  komoditas: string;
  kategori: string;
  satuan_hasil: string;
  deskripsi: string | null;
  is_aktif: boolean;
  dibuat_pada?: string | null;
}

export type StatusVerifikasiLaporan =
  | 'menunggu_asisten'
  | 'diverifikasi_asisten'
  | 'disetujui_kepala_kebun'
  | 'ditolak'
  | 'selesai';

export interface CatatanAktivitasBlok {
  id: string | number;
  blok_id: string | number;
  aktivitas_id: string | number;
  pengguna_id: string | number | null;
  tanggal_aktivitas: string;
  volume_hasil: number | null;
  satuan: string | null;
  tenaga_kerja_hk: number | null;
  pusingan_petik: number | null;
  persen_peko: number | null;
  kondisi_tanaman: string | null;
  status_risiko_manual: string | null;
  catatan: string | null;
  status_verifikasi?: StatusVerifikasiLaporan;
  diverifikasi_oleh?: number | null;
  disetujui_oleh?: number | null;
  nama_verifikator?: string | null;
  nama_approver?: string | null;
  catatan_verifikasi?: string | null;
  nama_aktivitas?: string;
  kode_aktivitas?: string;
  kategori_aktivitas?: string;
  komoditas?: string;
  nama_blok?: string;
  kode_blok?: string;
  nama_afdeling?: string | null;
  nama_kebun?: string | null;
  kebun_id?: number | null;
  afdeling_id?: number | null;
  nama_petugas?: string;
  dibuat_pada?: string | null;
}

export interface LaporanKendalaLapangan {
  id: string | number;
  kebun_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
  fitur_id: number | null;
  pelapor_id: number | null;
  judul_kendala: string;
  kategori_kendala: string;
  tingkat_urgensi: 'rendah' | 'sedang' | 'darurat';
  deskripsi: string | null;
  koordinat_geojson?: unknown;
  luas_area_ha: number | null;
  status_verifikasi: StatusVerifikasiLaporan;
  diverifikasi_oleh?: number | null;
  disetujui_oleh?: number | null;
  catatan_tindak_lanjut?: string | null;
  nama_pelapor?: string | null;
  nama_verifikator?: string | null;
  nama_approver?: string | null;
  nama_kebun?: string | null;
  nama_afdeling?: string | null;
  nama_blok?: string | null;
  dibuat_pada?: string | null;
}

export type StatusHaraTanah = 'optimal' | 'normal' | 'rendah' | 'kritis';

export interface DataMakroKebun {
  id: string | number;
  kebun_id: number;
  afdeling_id: number | null;
  blok_id: number | null;
  pengguna_id: number | null;
  periode_bulan: string;
  curah_hujan_mm: number;
  status_hara: StatusHaraTanah;
  ndvi_rata_rata: number;
  kelembaban_tanah: number;
  catatan_lab: string | null;
  nama_kebun?: string | null;
  nama_afdeling?: string | null;
  nama_blok?: string | null;
  nama_penginput?: string | null;
  dibuat_pada?: string | null;
}

