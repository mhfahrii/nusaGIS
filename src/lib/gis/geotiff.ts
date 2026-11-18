import { fromArrayBuffer, GeoTIFF, GeoTIFFImage } from 'geotiff';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';

export interface GeoTiffMetadata {
  width: number;
  height: number;
  bandsCount: number;
  bbox: [number, number, number, number]; // [minX/west, minY/south, maxX/east, maxY/north]
  minVal: number;
  maxVal: number;
  noData: number | null;
  tipeRaster: 'NDVI' | 'RGB' | 'ELEVATION' | 'THEMATIC';
  crsAsal: string;
  sridAsal: number;
}

export interface PixelInspectionResult {
  found: boolean;
  lng: number;
  lat: number;
  pixelX: number;
  pixelY: number;
  values: number[];
  primaryValue: number | null;
  interpretation?: string;
}

/**
 * Membaca metadata dasar GeoTIFF
 */
export async function parseGeoTiffMetadata(buffer: Buffer): Promise<GeoTiffMetadata> {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const tiff: GeoTIFF = await fromArrayBuffer(arrayBuffer);
  const image: GeoTIFFImage = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const bandsCount = image.getSamplesPerPixel();

  // Bounding box: [minX, minY, maxX, maxY]
  // Note: image.getBoundingBox() mengembalikan [minX, minY, maxX, maxY] dalam koordinat proyeksi file
  const bbox = image.getBoundingBox() as [number, number, number, number];
  
  // Deteksi CRS/SRID sederhana dari GeoKey
  const geoKeys = image.getGeoKeys();
  let sridAsal = 4326;
  let crsAsal = 'EPSG:4326 (WGS 84)';

  if (geoKeys) {
    if (geoKeys.ProjectedCSTypeGeoKey) {
      sridAsal = geoKeys.ProjectedCSTypeGeoKey;
      crsAsal = `EPSG:${sridAsal}`;
    } else if (geoKeys.GeographicTypeGeoKey) {
      sridAsal = geoKeys.GeographicTypeGeoKey;
      crsAsal = `EPSG:${sridAsal}`;
    }
  }

  // Jika koordinat dalam range bujur/lintang Indonesia (-15 s/d 15 lintang, 90 s/d 145 bujur)
  // Atau jika SRID UTM, kita lakukan validasi
  const isLonLat = Math.abs(bbox[0]) <= 180 && Math.abs(bbox[2]) <= 180 && Math.abs(bbox[1]) <= 90 && Math.abs(bbox[3]) <= 90;

  if (!isLonLat && (sridAsal >= 32600 && sridAsal <= 32760)) {
    // UTM projection converter sederhana atau fallback
    // Untuk perkebunan Indonesia umumnya UTM Zone 46-54
  }

  // Baca sampel band pertama untuk min/max
  const rasters = await image.readRasters({ window: [0, 0, Math.min(width, 256), Math.min(height, 256)] });
  const sampleBand = rasters[0] as Float32Array | Int16Array | Uint8Array;
  
  let minVal = Infinity;
  let maxVal = -Infinity;
  const noDataVal = image.getGDALNoData();

  for (let i = 0; i < sampleBand.length; i++) {
    const val = Number(sampleBand[i]);
    if (noDataVal !== null && Math.abs(val - noDataVal) < 0.0001) continue;
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;
  }

  if (minVal === Infinity) minVal = 0;
  if (maxVal === -Infinity) maxVal = 1;

  let tipeRaster: 'NDVI' | 'RGB' | 'ELEVATION' | 'THEMATIC' = 'THEMATIC';
  if (bandsCount >= 3) {
    tipeRaster = 'RGB';
  } else if (minVal >= -1.05 && maxVal <= 1.05) {
    tipeRaster = 'NDVI';
  } else if (minVal >= 0 && maxVal > 10) {
    tipeRaster = 'ELEVATION';
  }

  return {
    width,
    height,
    bandsCount,
    bbox,
    minVal: Number(minVal.toFixed(4)),
    maxVal: Number(maxVal.toFixed(4)),
    noData: noDataVal !== null ? Number(noDataVal) : null,
    tipeRaster,
    crsAsal,
    sridAsal,
  };
}

/**
 * Color ramp mapper untuk NDVI (Merah -> Oranye -> Kuning -> Hijau Muda -> Hijau Tua)
 * Sesuai referensi visual sentera pada dashboard
 */
function getNdviColor(val: number, minVal: number, maxVal: number): [number, number, number, number] {
  // Normalisasi 0 .. 1
  const norm = Math.max(0, Math.min(1, (val - minVal) / (maxVal - minVal || 1)));

  if (norm < 0.2) {
    // Merah Tua / Merah (#dc2626)
    return [220, 38, 38, 240];
  } else if (norm < 0.4) {
    // Oranye (#f97316)
    return [249, 115, 22, 240];
  } else if (norm < 0.6) {
    // Kuning (#facc15)
    return [250, 204, 21, 240];
  } else if (norm < 0.8) {
    // Hijau Muda (#84cc16)
    return [132, 204, 22, 240];
  } else {
    // Hijau Subur / Hijau Tua (#15803d)
    return [21, 128, 61, 245];
  }
}

/**
 * Generate rendered PNG buffer dari GeoTIFF untuk ditampilkan sebagai Leaflet ImageOverlay
 */
export async function renderGeoTiffToPng(filePath: string, targetMaxWidth = 1024): Promise<Buffer> {
  const fileBuffer = await fs.readFile(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const bandsCount = image.getSamplesPerPixel();

  // Scale down jika terlalu besar agar responsif di web
  const scale = width > targetMaxWidth ? targetMaxWidth / width : 1;
  const outWidth = Math.round(width * scale);
  const outHeight = Math.round(height * scale);

  const rasters = await image.readRasters({
    width: outWidth,
    height: outHeight,
  });

  const png = new PNG({ width: outWidth, height: outHeight });
  const noDataVal = image.getGDALNoData();

  if (bandsCount >= 3) {
    // RGB
    const rBand = rasters[0] as ArrayLike<number>;
    const gBand = rasters[1] as ArrayLike<number>;
    const bBand = rasters[2] as ArrayLike<number>;
    const aBand = bandsCount >= 4 ? (rasters[3] as ArrayLike<number>) : null;

    for (let y = 0; y < outHeight; y++) {
      for (let x = 0; x < outWidth; x++) {
        const idx = y * outWidth + x;
        const pngIdx = (y * outWidth + x) * 4;

        const r = rBand[idx] ?? 0;
        const g = gBand[idx] ?? 0;
        const b = bBand[idx] ?? 0;
        const a = aBand ? aBand[idx] : 255;

        png.data[pngIdx] = Math.min(255, Math.max(0, r));
        png.data[pngIdx + 1] = Math.min(255, Math.max(0, g));
        png.data[pngIdx + 2] = Math.min(255, Math.max(0, b));
        png.data[pngIdx + 3] = Math.min(255, Math.max(0, a));
      }
    }
  } else {
    // Single band (NDVI / Dem)
    const band = rasters[0] as ArrayLike<number>;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < band.length; i++) {
      const v = band[i];
      if ((noDataVal !== null && Math.abs(v - noDataVal) < 0.0001) || v <= -9000 || isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 1;

    for (let y = 0; y < outHeight; y++) {
      for (let x = 0; x < outWidth; x++) {
        const idx = y * outWidth + x;
        const pngIdx = (y * outWidth + x) * 4;
        const v = band[idx];

        if ((noDataVal !== null && Math.abs(v - noDataVal) < 0.0001) || v <= -9000 || isNaN(v)) {
          png.data[pngIdx] = 0;
          png.data[pngIdx + 1] = 0;
          png.data[pngIdx + 2] = 0;
          png.data[pngIdx + 3] = 0; // 100% Transparan di luar batas kebun
        } else {
          const [r, g, b, a] = getNdviColor(v, min, max);
          png.data[pngIdx] = r;
          png.data[pngIdx + 1] = g;
          png.data[pngIdx + 2] = b;
          png.data[pngIdx + 3] = a;
        }
      }
    }
  }

  return PNG.sync.write(png);
}

/**
 * Pixel Inspection: Baca nilai pixel pada koordinat lon/lat tertentu
 */
export async function inspectPixelAtCoordinate(
  filePath: string,
  targetLng: number,
  targetLat: number
): Promise<PixelInspectionResult> {
  const fileBuffer = await fs.readFile(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox() as [number, number, number, number]; // [minX, minY, maxX, maxY]

  const [minX, minY, maxX, maxY] = bbox;

  // Cek apakah koordinat berada di dalam bbox
  if (targetLng < minX || targetLng > maxX || targetLat < minY || targetLat > maxY) {
    return {
      found: false,
      lng: targetLng,
      lat: targetLat,
      pixelX: -1,
      pixelY: -1,
      values: [],
      primaryValue: null,
      interpretation: 'Di luar cakupan citra raster.',
    };
  }

  // Hitung index pixel (kolom X dan baris Y)
  const pixelX = Math.floor(((targetLng - minX) / (maxX - minX)) * width);
  // Y biasanya berbanding terbalik (baris 0 ada di maxY)
  const pixelY = Math.floor(((maxY - targetLat) / (maxY - minY)) * height);

  const clampedX = Math.max(0, Math.min(width - 1, pixelX));
  const clampedY = Math.max(0, Math.min(height - 1, pixelY));

  // Baca 1 pixel saja (window [clampedX, clampedY, clampedX + 1, clampedY + 1])
  const rasters = await image.readRasters({
    window: [clampedX, clampedY, clampedX + 1, clampedY + 1],
  });

  const values: number[] = [];
  for (let b = 0; b < rasters.length; b++) {
    const rawVal = rasters[b][0];
    values.push(Number(Number(rawVal).toFixed(4)));
  }

  const primaryValue = values[0] ?? null;

  if (primaryValue !== null && primaryValue <= -9000) {
    return {
      found: false,
      lng: targetLng,
      lat: targetLat,
      pixelX: clampedX,
      pixelY: clampedY,
      values: [],
      primaryValue: null,
      interpretation: 'Di luar batas blok kebun (NoData)',
    };
  }

  let interpretation = 'Nilai Band: ' + values.join(', ');

  if (values.length === 1) {
    const v = values[0];
    if (v >= 0.7) {
      interpretation = `NDVI: ${v} (Kerapatan Kanopi Sangat Tinggi / Sangat Sehat)`;
    } else if (v >= 0.5) {
      interpretation = `NDVI: ${v} (Kerapatan Kanopi Sedang / Sehat)`;
    } else if (v >= 0.3) {
      interpretation = `NDVI: ${v} (Kerapatan Rendah / Perlu Pemupukan)`;
    } else if (v >= 0.1) {
      interpretation = `NDVI: ${v} (Lahan Terbuka / Semak / Bibitan)`;
    } else {
      interpretation = `NDVI: ${v} (Air / Tanah Terbuka / Non-Vegetasi)`;
    }
  }

  return {
    found: true,
    lng: targetLng,
    lat: targetLat,
    pixelX: clampedX,
    pixelY: clampedY,
    values,
    primaryValue,
    interpretation,
  };
}
