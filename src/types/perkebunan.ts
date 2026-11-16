export interface Kebun {
  id: string | number;
  kode_kebun: string;
  nama_kebun: string;
  wilayah: string | null;
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
  afdeling_id: string | number;
  kode_blok: string;
  nama_blok: string;
  komoditas: string | null;
  tahun_tanam: number | null;
  keterangan: string | null;
  dibuat_pada: string | null;
}

