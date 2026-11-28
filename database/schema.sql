-- =============================================================================
-- SKEMA DATABASE WEB GIS PERKEBUNAN PT RISET PERKEBUNAN NUSANTARA (PT RPN)
-- PostgreSQL + PostGIS Spatial Geodatabase Schema
-- Idempoten: Aman dijalankan berulang kali (CREATE IF NOT EXISTS)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Tabel Pengguna (Admin & Karyawan beserta RBAC Hak Akses Granular)
CREATE TABLE IF NOT EXISTS public.pengguna (
    id BIGSERIAL PRIMARY KEY,
    nama VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    kata_sandi_hash TEXT NOT NULL,
    peran VARCHAR(30) NOT NULL DEFAULT 'pengguna' CHECK (peran IN ('admin', 'pengguna', 'mandor', 'asisten', 'kepala_kebun', 'pimpinan')),
    aktif BOOLEAN NOT NULL DEFAULT TRUE,
    afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
    kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL,
    hak_akses JSONB,
    foto_profil TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pengguna_afdeling ON public.pengguna (afdeling_id);
CREATE INDEX IF NOT EXISTS idx_pengguna_kebun ON public.pengguna (kebun_id);

-- 2. Tabel Permintaan Hak Akses Sementara (Workflow Pengajuan Karyawan -> Persetujuan Admin)
CREATE TABLE IF NOT EXISTS public.permintaan_hak_sementara (
    id BIGSERIAL PRIMARY KEY,
    pengguna_id BIGINT NOT NULL REFERENCES public.pengguna(id) ON DELETE CASCADE,
    jenis_hak VARCHAR(50) NOT NULL CHECK (jenis_hak IN ('upload_layer', 'edit_data')),
    alasan TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'disetujui', 'ditolak', 'dicabut')),
    dikonfirmasi_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    diperbarui_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hak_sementara_pengguna ON public.permintaan_hak_sementara (pengguna_id, status);

-- 3. Tabel Master Unit Kebun
CREATE TABLE IF NOT EXISTS public.kebun (
    id BIGSERIAL PRIMARY KEY,
    kode_kebun VARCHAR(60) NOT NULL UNIQUE,
    nama_kebun VARCHAR(150) NOT NULL,
    perusahaan VARCHAR(150),
    wilayah VARCHAR(150),
    provinsi VARCHAR(100),
    kabupaten_kota VARCHAR(120),
    komoditas VARCHAR(100),
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- 4. Tabel Master Afdeling
CREATE TABLE IF NOT EXISTS public.afdeling (
    id BIGSERIAL PRIMARY KEY,
    kebun_id BIGINT NOT NULL REFERENCES public.kebun(id) ON DELETE CASCADE,
    kode_afdeling VARCHAR(60) NOT NULL,
    nama_afdeling VARCHAR(150) NOT NULL,
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (kebun_id, kode_afdeling)
);

CREATE INDEX IF NOT EXISTS idx_afdeling_kebun_id ON public.afdeling (kebun_id);

-- 5. Tabel Master Blok
-- Blok selalu milik satu kebun. Afdeling opsional: kebun kecil (tanpa afdeling) langsung punya blok.
CREATE TABLE IF NOT EXISTS public.blok (
    id BIGSERIAL PRIMARY KEY,
    kebun_id BIGINT NOT NULL REFERENCES public.kebun(id) ON DELETE CASCADE,
    afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE CASCADE,
    kode_blok VARCHAR(60) NOT NULL,
    nama_blok VARCHAR(150) NOT NULL,
    komoditas VARCHAR(100),
    tahun_tanam INTEGER,
    aktivitas_terakhir VARCHAR(200),
    tanggal_aktivitas_terakhir DATE,
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Migrasi database lama yang dibuat saat afdeling_id masih wajib.
ALTER TABLE public.blok ADD COLUMN IF NOT EXISTS kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE CASCADE;
ALTER TABLE public.blok ADD COLUMN IF NOT EXISTS aktivitas_terakhir VARCHAR(200);
ALTER TABLE public.blok ADD COLUMN IF NOT EXISTS tanggal_aktivitas_terakhir DATE;
UPDATE public.blok b SET kebun_id = a.kebun_id FROM public.afdeling a WHERE b.kebun_id IS NULL AND a.id = b.afdeling_id;
ALTER TABLE public.blok ALTER COLUMN kebun_id SET NOT NULL;
ALTER TABLE public.blok ALTER COLUMN afdeling_id DROP NOT NULL;
ALTER TABLE public.blok DROP CONSTRAINT IF EXISTS uq_blok_afdeling;
ALTER TABLE public.blok DROP CONSTRAINT IF EXISTS blok_afdeling_id_kode_blok_key;

-- Afdeling yang dipilih wajib berada di kebun yang sama dengan blok (tidak dicek bila afdeling_id NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_afdeling_id_kebun ON public.afdeling (id, kebun_id);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_blok_afdeling_kebun') THEN
        ALTER TABLE public.blok
            ADD CONSTRAINT fk_blok_afdeling_kebun FOREIGN KEY (afdeling_id, kebun_id)
            REFERENCES public.afdeling (id, kebun_id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;

-- Kode blok unik per afdeling, atau per kebun untuk blok tanpa afdeling (tidak peka huruf besar/kecil).
CREATE UNIQUE INDEX IF NOT EXISTS uq_blok_kode_wilayah ON public.blok (kebun_id, COALESCE(afdeling_id, 0), LOWER(kode_blok));
CREATE INDEX IF NOT EXISTS idx_blok_kebun_id ON public.blok (kebun_id);
CREATE INDEX IF NOT EXISTS idx_blok_afdeling_id ON public.blok (afdeling_id);

-- 6. Tabel Data Unggahan Arsip GIS (Shapefile ZIP / GeoJSON / GeoTIFF)
CREATE TABLE IF NOT EXISTS public.data_unggahan (
    id BIGSERIAL PRIMARY KEY,
    pengguna_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL,
    nama_data VARCHAR(200) NOT NULL,
    nama_file VARCHAR(255) NOT NULL,
    lokasi_file TEXT,
    ukuran_file BIGINT DEFAULT 0,
    crs_asal VARCHAR(120),
    srid_asal INTEGER DEFAULT 4326,
    jumlah_layer INTEGER DEFAULT 1,
    status_validasi VARCHAR(50) DEFAULT 'valid',
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- 7. Tabel Layer Peta Vektor
CREATE TABLE IF NOT EXISTS public.layer_peta (
    id BIGSERIAL PRIMARY KEY,
    unggahan_id BIGINT REFERENCES public.data_unggahan(id) ON DELETE CASCADE,
    kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL,
    afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
    blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
    nama_layer VARCHAR(200) NOT NULL,
    nama_file_shp VARCHAR(255),
    tipe_geometri VARCHAR(60) NOT NULL DEFAULT 'Polygon',
    warna VARCHAR(30) NOT NULL DEFAULT '#00D2FF',
    transparansi NUMERIC(4,2) NOT NULL DEFAULT 0.65,
    terlihat BOOLEAN NOT NULL DEFAULT TRUE,
    urutan INTEGER NOT NULL DEFAULT 1,
    jumlah_fitur INTEGER NOT NULL DEFAULT 0,
    crs_asal VARCHAR(120),
    srid_asal INTEGER DEFAULT 4326,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    dihapus_pada TIMESTAMP WITHOUT TIME ZONE,
    dihapus_oleh_user_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layer_peta_kebun ON public.layer_peta (kebun_id);
CREATE INDEX IF NOT EXISTS idx_layer_peta_unggahan ON public.layer_peta (unggahan_id);
CREATE INDEX IF NOT EXISTS idx_layer_peta_is_deleted ON public.layer_peta (is_deleted);

-- 8. Tabel Fitur Peta Spasial (Poligon Blok / Titik / Garis dalam WGS84 EPSG:4326)
CREATE TABLE IF NOT EXISTS public.fitur_peta (
    id BIGSERIAL PRIMARY KEY,
    layer_id BIGINT NOT NULL REFERENCES public.layer_peta(id) ON DELETE CASCADE,
    geom geometry(Geometry, 4326) NOT NULL,
    atribut JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    dihapus_pada TIMESTAMP WITHOUT TIME ZONE,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    dibuat_oleh_user_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    diubah_pada TIMESTAMP WITHOUT TIME ZONE,
    diubah_oleh_user_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    dihapus_oleh_user_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fitur_peta_geom ON public.fitur_peta USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_fitur_peta_layer_id ON public.fitur_peta (layer_id);
CREATE INDEX IF NOT EXISTS idx_fitur_peta_atribut ON public.fitur_peta USING GIN (atribut);
CREATE INDEX IF NOT EXISTS idx_fitur_peta_is_deleted ON public.fitur_peta (is_deleted);
CREATE INDEX IF NOT EXISTS idx_fitur_expr_nama_blok ON public.fitur_peta (((atribut->>'nama_blok')));
CREATE INDEX IF NOT EXISTS idx_fitur_expr_status_lahan ON public.fitur_peta (((atribut->>'status_lahan')));
CREATE INDEX IF NOT EXISTS idx_fitur_expr_varietas ON public.fitur_peta (((atribut->>'varietas')));

-- 9. Tabel Layer Raster (Citra Drone GeoTIFF / NDVI / Orthomosaic)
CREATE TABLE IF NOT EXISTS public.layer_raster (
    id BIGSERIAL PRIMARY KEY,
    unggahan_id BIGINT REFERENCES public.data_unggahan(id) ON DELETE CASCADE,
    kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL,
    afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
    blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
    nama_layer VARCHAR(200) NOT NULL,
    nama_file VARCHAR(255) NOT NULL,
    lokasi_file TEXT NOT NULL,
    tipe_raster VARCHAR(40) NOT NULL DEFAULT 'RGB',
    min_val DOUBLE PRECISION,
    max_val DOUBLE PRECISION,
    nodata DOUBLE PRECISION,
    bands_count INTEGER NOT NULL DEFAULT 3,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    crs_asal VARCHAR(120),
    srid_asal INTEGER DEFAULT 4326,
    bbox_wgs84 geometry(Polygon, 4326),
    transparansi NUMERIC(4,2) NOT NULL DEFAULT 0.85,
    terlihat BOOLEAN NOT NULL DEFAULT TRUE,
    urutan INTEGER NOT NULL DEFAULT 1,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layer_raster_kebun ON public.layer_raster (kebun_id);

-- 10. Tabel Riwayat Aktivitas (Log Audit Sistem)
CREATE TABLE IF NOT EXISTS public.riwayat_aktivitas (
    id BIGSERIAL PRIMARY KEY,
    pengguna_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    aktivitas VARCHAR(120) NOT NULL,
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_riwayat_aktivitas_waktu ON public.riwayat_aktivitas (dibuat_pada DESC);

-- 11. Tabel Master Data Aktivitas Agronomi (Lintas Komoditas PT RPN)
CREATE TABLE IF NOT EXISTS public.master_aktivitas (
    id BIGSERIAL PRIMARY KEY,
    kode_aktivitas VARCHAR(50) NOT NULL UNIQUE,
    nama_aktivitas VARCHAR(150) NOT NULL,
    komoditas VARCHAR(50) NOT NULL DEFAULT 'Umum',
    kategori VARCHAR(50) NOT NULL DEFAULT 'pemeliharaan',
    satuan_hasil VARCHAR(50) NOT NULL DEFAULT 'Kg',
    deskripsi TEXT,
    is_aktif BOOLEAN NOT NULL DEFAULT TRUE,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_master_aktivitas_komoditas ON public.master_aktivitas (komoditas);
CREATE INDEX IF NOT EXISTS idx_master_aktivitas_kategori ON public.master_aktivitas (kategori);

-- 12. Tabel Catatan Aktivitas & Hasil Harian Lapangan per Blok (Input Mandor & Verifikasi Berjenjang)
CREATE TABLE IF NOT EXISTS public.catatan_aktivitas_blok (
    id BIGSERIAL PRIMARY KEY,
    blok_id BIGINT NOT NULL REFERENCES public.blok(id) ON DELETE CASCADE,
    aktivitas_id BIGINT NOT NULL REFERENCES public.master_aktivitas(id) ON DELETE RESTRICT,
    pengguna_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    tanggal_aktivitas DATE NOT NULL DEFAULT CURRENT_DATE,
    volume_hasil NUMERIC(12, 2) DEFAULT 0,
    satuan VARCHAR(50) DEFAULT 'Kg',
    tenaga_kerja_hk INTEGER DEFAULT 0,
    pusingan_petik INTEGER,
    persen_peko NUMERIC(5, 2),
    kondisi_tanaman VARCHAR(50) DEFAULT 'sehat',
    status_risiko_manual VARCHAR(30) DEFAULT 'normal',
    catatan TEXT,
    status_verifikasi VARCHAR(40) NOT NULL DEFAULT 'menunggu_asisten',
    diverifikasi_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    disetujui_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    catatan_verifikasi TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catatan_aktivitas_blok ON public.catatan_aktivitas_blok (blok_id);
CREATE INDEX IF NOT EXISTS idx_catatan_aktivitas_tgl ON public.catatan_aktivitas_blok (tanggal_aktivitas DESC);
CREATE INDEX IF NOT EXISTS idx_catatan_aktivitas_akt ON public.catatan_aktivitas_blok (aktivitas_id);

-- 13. Tabel Laporan Kendala Lapangan (Fleksibel dari Dashboard & Digitasi Spasial Kontrol Peta)
CREATE TABLE IF NOT EXISTS public.laporan_kendala_lapangan (
    id BIGSERIAL PRIMARY KEY,
    kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE CASCADE,
    afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
    blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
    fitur_id BIGINT REFERENCES public.fitur_peta(id) ON DELETE SET NULL,
    pelapor_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    judul_kendala VARCHAR(200) NOT NULL,
    kategori_kendala VARCHAR(80) NOT NULL DEFAULT 'lainnya',
    tingkat_urgensi VARCHAR(40) NOT NULL DEFAULT 'sedang',
    deskripsi TEXT,
    koordinat_geojson JSONB,
    luas_area_ha NUMERIC(10, 2),
    status_verifikasi VARCHAR(40) NOT NULL DEFAULT 'menunggu_asisten',
    diverifikasi_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    disetujui_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    catatan_tindak_lanjut TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_laporan_kendala_kebun ON public.laporan_kendala_lapangan (kebun_id);
CREATE INDEX IF NOT EXISTS idx_laporan_kendala_afdeling ON public.laporan_kendala_lapangan (afdeling_id);
CREATE INDEX IF NOT EXISTS idx_laporan_kendala_status ON public.laporan_kendala_lapangan (status_verifikasi);

-- 14. Tabel Data Makro, Iklim & Agronomi Laboratorium (Input Kepala Kebun untuk Root Cause Analysis)
CREATE TABLE IF NOT EXISTS public.data_makro_kebun (
    id BIGSERIAL PRIMARY KEY,
    kebun_id BIGINT NOT NULL REFERENCES public.kebun(id) ON DELETE CASCADE,
    afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
    blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
    pengguna_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    periode_bulan VARCHAR(20) NOT NULL DEFAULT '2026-11',
    curah_hujan_mm NUMERIC(8, 2) NOT NULL DEFAULT 145,
    status_hara VARCHAR(40) NOT NULL DEFAULT 'normal',
    ndvi_rata_rata NUMERIC(4, 2) NOT NULL DEFAULT 0.71,
    kelembaban_tanah NUMERIC(4, 2) NOT NULL DEFAULT 0.28,
    catatan_lab TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_makro_kebun ON public.data_makro_kebun (kebun_id);
CREATE INDEX IF NOT EXISTS idx_data_makro_blok ON public.data_makro_kebun (blok_id);
