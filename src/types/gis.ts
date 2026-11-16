import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';

export interface ExtentBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface DataUnggahan {
  id: number;
  pengguna_id: number;
  kebun_id: number | null;
  nama_data: string;
  nama_file: string;
  format_file: string;
  lokasi_file: string;
  crs_asal: string | null;
  srid_asal: number | null;
  status: string;
  jumlah_layer: number;
  pesan_error: string | null;
  dibuat_pada: string;
}

export interface LayerPeta {
  id: number;
  unggahan_id: number;
  kebun_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
  nama_layer: string;
  nama_file_shp: string | null;
  tipe_geometri: string;
  warna: string;
  transparansi: number;
  terlihat: boolean;
  urutan: number;
  jumlah_fitur: number;
  crs_asal?: string | null;
  srid_asal?: number | null;
  nama_kebun?: string | null;
  kode_kebun?: string | null;
  nama_dataset?: string | null;
  dibuat_pada: string;
  bbox?: [number, number, number, number] | null; // [west, south, east, north]
  extent?: ExtentBox | null;
}

export interface FiturPetaRow {
  id: number;
  layer_id: number;
  atribut: Record<string, unknown>;
  dibuat_pada: string;
  bbox?: [number, number, number, number] | null;
  extent?: ExtentBox | null;
}

export interface ExtractedShapefile {
  layerName: string;
  shapefileName: string;
  geometryType: string;
  featureCount: number;
  crsAsal: string;
  sridAsal: number | null;
  features: Array<{
    geometry: Geometry;
    properties: GeoJsonProperties;
  }>;
  bbox?: [number, number, number, number];
  extent?: ExtentBox;
}

export interface SearchResultItem {
  type: 'kebun' | 'layer' | 'feature';
  id: number;
  title: string;
  subtitle: string;
  kebun_id: number | null;
  unggahan_id?: number | null;
  layer_id: number | null;
  feature_id: number | null;
  kode_kebun?: string | null;
  nama_kebun?: string | null;
  wilayah?: string | null;
  nama_dataset?: string | null;
  nama_layer?: string | null;
  tipe_geometri?: string | null;
  jumlah_fitur?: number | null;
  matched_attribute?: string | null;
  attributes?: Record<string, unknown> | null;
  extent: ExtentBox | null;
  bbox: [number, number, number, number] | null;
}

export interface DetectedDataset {
  index: number;
  name: string;
  sourceFileName: string;
  format: 'shapefile' | 'geojson' | 'geotiff';
  geometryType: string;
  featureCount: number;
  crsAsal: string;
  sridAsal: number | null;
  needsCrsSelection: boolean;
  attributes: string[];
  sampleProperties: Record<string, unknown>[];
  bbox: [number, number, number, number] | null;
  extent: ExtentBox | null;
  rasterMeta?: {
    width: number;
    height: number;
    bandsCount: number;
    minVal: number;
    maxVal: number;
    noData: number | null;
    tipeRaster: 'NDVI' | 'RGB' | 'ELEVATION' | 'THEMATIC';
  };
}

export interface LayerMappingInput {
  datasetIndex: number;
  nama_layer: string;
  kategori: string;
  kebun_id: number;
  afdeling_id?: number | null;
  blok_id?: number | null;
  fallback_crs?: string | null;
}

export interface MonitoringStats {
  total_kebun: number;
  total_afdeling: number;
  total_blok: number;
  total_layer: number;
  total_fitur: number;
  total_unggahan: number;
  total_luas_ha: number;
  komoditas?: string;
  // Capaian Produksi Bulanan
  rkap_produksi_ton_bulan?: number;
  realisasi_produksi_ton_bulan?: number;
  rkap_produktivitas_bulan?: number;
  realisasi_produktivitas_bulan?: number;
  rkap_tandan_bulan?: number;
  realisasi_tandan_bulan?: number;
  // Capaian Produksi Tahunan
  rkap_produksi_ton_tahun?: number;
  realisasi_produksi_ton_tahun?: number;
  rkap_produktivitas_tahun?: number;
  realisasi_produktivitas_tahun?: number;
  rkap_tandan_tahun?: number;
  realisasi_tandan_tahun?: number;
  // Populasi & Agronomi (Murni dari Atribut Shapefile & Geometri PostGIS)
  jumlah_pohon?: number;
  luas_tanam_ha?: number;
  total_luas_baku_ha?: number;
  varietas_dominan?: string;
  status_lahan_dominan?: string;
  masa_tanam?: string;
  crs_asal?: string;
  ks_gpa_count?: number;
  ks_gpa_luas_ha?: number;
  ktg_count?: number;
  ktg_luas_ha?: number;
  max_blok_luas_ha?: number;
  max_blok_name?: string;
  min_blok_luas_ha?: number;
  min_blok_name?: string;
  avg_blok_luas_ha?: number;
  total_keliling_km?: number;
}

export interface LayerRaster {
  id: number;
  unggahan_id: number;
  kebun_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
  nama_layer: string;
  nama_file: string;
  lokasi_file: string;
  tipe_raster: 'NDVI' | 'RGB' | 'ELEVATION' | 'THEMATIC';
  min_val: number | null;
  max_val: number | null;
  nodata: number | null;
  bands_count: number;
  width: number;
  height: number;
  crs_asal: string | null;
  srid_asal: number | null;
  transparansi: number;
  terlihat: boolean;
  urutan: number;
  dibuat_pada: string;
  nama_kebun?: string | null;
  kode_kebun?: string | null;
  nama_dataset?: string | null;
  bbox?: [number, number, number, number] | null; // [west, south, east, north]
  extent?: ExtentBox | null;
  preview_url?: string;
}

export type GisFeatureCollection = FeatureCollection<Geometry, Record<string, unknown>>;
