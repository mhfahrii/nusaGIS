-- ==============================================================================
-- SKEMA DATABASE POSTGRESQL & POSTGIS UNTUK WEBGIS PERKEBUNAN (NUSAGIS)
-- Standard ArcGIS Pro & Enterprise PostGIS Integration
-- ==============================================================================

-- 1. AKTIFKAN EKSTENSI POSTGIS & UUID
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 2. TABEL PENGGUNA & RIWAYAT AKTIVITAS (AUTENTIKASI & AUDIT)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.pengguna (
    id BIGSERIAL PRIMARY KEY,
    nama VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    kata_sandi_hash VARCHAR(255) NOT NULL,
    peran VARCHAR(50) NOT NULL DEFAULT 'pengguna' CHECK (peran IN ('admin', 'pengguna')),
    aktif BOOLEAN NOT NULL DEFAULT TRUE,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.riwayat_aktivitas (
    id BIGSERIAL PRIMARY KEY,
    pengguna_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    aktivitas VARCHAR(100) NOT NULL,
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 3. TABEL HIERARKI PERKEBUNAN (MASTER KEBUN -> AFDELING -> BLOK)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.kebun (
    id BIGSERIAL PRIMARY KEY,
    kode_kebun VARCHAR(50) NOT NULL UNIQUE,
    nama_kebun VARCHAR(150) NOT NULL,
    wilayah VARCHAR(150),
    komoditas VARCHAR(100),
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.afdeling (
    id BIGSERIAL PRIMARY KEY,
    kebun_id BIGINT NOT NULL REFERENCES public.kebun(id) ON DELETE CASCADE,
    kode_afdeling VARCHAR(50) NOT NULL,
    nama_afdeling VARCHAR(150) NOT NULL,
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_afdeling_kebun_kode UNIQUE (kebun_id, kode_afdeling)
);

CREATE TABLE IF NOT EXISTS public.blok (
    id BIGSERIAL PRIMARY KEY,
    afdeling_id BIGINT NOT NULL REFERENCES public.afdeling(id) ON DELETE CASCADE,
    kode_blok VARCHAR(50) NOT NULL,
    nama_blok VARCHAR(150) NOT NULL,
    komoditas VARCHAR(100),
    tahun_tanam INTEGER,
    keterangan TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_blok_afdeling_kode UNIQUE (afdeling_id, kode_blok)
);

-- ==============================================================================
-- 4. TABEL DATA UNGGAHAN (LOG DATASET SHP / ZIP / GEOTIFF)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.data_unggahan (
    id BIGSERIAL PRIMARY KEY,
    pengguna_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
    kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL,
    nama_data VARCHAR(150) NOT NULL,
    nama_file VARCHAR(255) NOT NULL,
    format_file VARCHAR(50) NOT NULL, -- 'ZIP', 'Shapefile', 'GeoJSON', 'GeoTIFF'
    lokasi_file TEXT NOT NULL,
    crs_asal VARCHAR(100),
    srid_asal INTEGER,
    status VARCHAR(50) DEFAULT 'berhasil', -- 'proses', 'berhasil', 'gagal'
    jumlah_layer INTEGER DEFAULT 1,
    pesan_error TEXT,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 5. TABEL LAYER VEKTOR & FITUR GEOMETRI SPASIAL (POSTGIS)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.layer_peta (
    id BIGSERIAL PRIMARY KEY,
    unggahan_id BIGINT REFERENCES public.data_unggahan(id) ON DELETE CASCADE,
    kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL,
    afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
    blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
    nama_layer VARCHAR(150) NOT NULL,
    nama_file_shp VARCHAR(255),
    tipe_geometri VARCHAR(50) NOT NULL, -- 'Polygon', 'MultiPolygon', 'Point', 'LineString'
    warna VARCHAR(20) DEFAULT '#00D2FF',
    transparansi NUMERIC DEFAULT 0.35,
    terlihat BOOLEAN DEFAULT TRUE,
    urutan INTEGER DEFAULT 1,
    jumlah_fitur INTEGER DEFAULT 0,
    crs_asal VARCHAR(100),
    srid_asal INTEGER,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.fitur_peta (
    id BIGSERIAL PRIMARY KEY,
    layer_id BIGINT NOT NULL REFERENCES public.layer_peta(id) ON DELETE CASCADE,
    geom GEOMETRY(Geometry, 4326) NOT NULL,
    atribut JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_deleted BOOLEAN DEFAULT FALSE,
    dihapus_pada TIMESTAMP WITHOUT TIME ZONE,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 6. TABEL LAYER RASTER (NDVI, ORTHOPHOTO, CITRA SATELIT)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.layer_raster (
    id BIGSERIAL PRIMARY KEY,
    unggahan_id BIGINT REFERENCES public.data_unggahan(id) ON DELETE CASCADE,
    kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL,
    afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
    blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
    nama_layer VARCHAR(255) NOT NULL,
    nama_file VARCHAR(255) NOT NULL,
    lokasi_file TEXT NOT NULL,
    tipe_raster VARCHAR(50) DEFAULT 'thematic', -- 'NDVI', 'RGB', 'ELEVATION', 'THEMATIC'
    min_val NUMERIC,
    max_val NUMERIC,
    nodata NUMERIC,
    bands_count INTEGER DEFAULT 1,
    width INTEGER,
    height INTEGER,
    crs_asal VARCHAR(100),
    srid_asal INTEGER,
    bbox_wgs84 GEOMETRY(Polygon, 4326),
    transparansi NUMERIC DEFAULT 0.85,
    terlihat BOOLEAN DEFAULT TRUE,
    urutan INTEGER DEFAULT 0,
    dibuat_pada TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 7. INDEKS SPASIAL & PERFORMA TINGGI (ENTERPRISE POSTGIS R-TREE)
-- ==============================================================================

-- Indeks Spasial GiST untuk pencarian geometri poligon cepat
CREATE INDEX IF NOT EXISTS idx_fitur_peta_geom ON public.fitur_peta USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_layer_raster_bbox ON public.layer_raster USING GIST (bbox_wgs84);

-- Indeks Relasional Foreign Key
CREATE INDEX IF NOT EXISTS idx_fitur_peta_layer_id ON public.fitur_peta (layer_id);
CREATE INDEX IF NOT EXISTS idx_fitur_peta_is_deleted ON public.fitur_peta (is_deleted);
CREATE INDEX IF NOT EXISTS idx_layer_peta_kebun ON public.layer_peta (kebun_id);
CREATE INDEX IF NOT EXISTS idx_layer_peta_unggahan ON public.layer_peta (unggahan_id);
CREATE INDEX IF NOT EXISTS idx_layer_raster_kebun ON public.layer_raster (kebun_id);
CREATE INDEX IF NOT EXISTS idx_afdeling_kebun ON public.afdeling (kebun_id);
CREATE INDEX IF NOT EXISTS idx_blok_afdeling ON public.blok (afdeling_id);

-- Indeks GIN Inverted untuk filter cepat atribut JSONB (Kode Blok, Nama Blok, Varietas)
CREATE INDEX IF NOT EXISTS idx_fitur_peta_atribut ON public.fitur_peta USING GIN (atribut);

-- ==============================================================================
-- 8. DATA AWAL (SEED DATA / DEFAULT ADMIN & SAMPLE KEBUN)
-- ==============================================================================

-- Buat Akun Admin Default (Password: admin123456)
-- Hash bcrypt $2a$12$e6xI41w3zMv1Qf2Fw5vW4uY1XwBv9U5xR5tL8z7pQ6aX4c3v2b1a (standar bcrypt)
-- Catatan: Teman Anda juga bisa menjalankan 'npm run admin:create' dari terminal
INSERT INTO public.pengguna (nama, email, kata_sandi_hash, peran, aktif)
VALUES (
    'Administrator GIS',
    'admin@nusagis.com',
    '$2a$12$KkQ15a7p5T4CjB3vM0Z1m.O4qfCwqBvO9a2/Q7C8n/oF2S2kC6e4y', -- hash password admin123456
    'admin',
    TRUE
)
ON CONFLICT (email) DO NOTHING;

-- Master Kebun Contoh (Kebun Bakalan Tebu)
INSERT INTO public.kebun (kode_kebun, nama_kebun, wilayah, komoditas, keterangan)
VALUES (
    'KBN-BKL',
    'Kebun Bakalan',
    'Wilayah Bakalan',
    'Tebu',
    'Kebun Tebu Garapan & KTG'
)
ON CONFLICT (kode_kebun) DO NOTHING;

