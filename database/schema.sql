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
    peran VARCHAR(30) NOT NULL DEFAULT 'pengguna' CHECK (peran IN ('admin', 'pengguna')),
    aktif BOOLEAN NOT NULL DEFAULT TRUE,
    hak_akses JSONB,
    foto_profil TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

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
CREATE TABLE IF NOT EXISTS public.blok (
    id BIGSERIAL PRIMARY KEY,
    afdeling_id BIGINT NOT NULL REFERENCES public.afdeling(id) ON DELETE CASCADE,
    kode_blok VARCHAR(60) NOT NULL,
    nama_blok VARCHAR(150) NOT NULL,
    komoditas VARCHAR(100),
    tahun_tanam INTEGER,
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (afdeling_id, kode_blok)
);

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
