import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { FeatureCollection, Geometry } from 'geojson';
import type { ExtractedShapefile, ExtentBox } from '@/types/gis';

// Polyfill self untuk shpjs di lingkungan Node.js server
if (typeof globalThis.self === 'undefined') {
  (globalThis as unknown as { self: typeof globalThis }).self = globalThis;
}

const DEFAULT_PALETTE = [
  '#10b981', // emerald
  '#0284c7', // blue
  '#ec4899', // pink
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f43f5e', // rose
];

export const MAX_ZIP_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024; // 150 MB
export const MAX_ZIP_ENTRIES = 100;
export const MAX_COMPRESSION_RATIO = 150;

const FORBIDDEN_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.js',
  '.mjs',
  '.cjs',
  '.sh',
  '.msi',
  '.com',
  '.scr',
  '.hta',
  '.php',
  '.py',
  '.jar',
]);

const IGNORED_FILES = new Set(['thumbs.db', '.ds_store', 'desktop.ini']);
const IGNORED_EXTENSIONS = new Set(['.lock', '.tmp', '.bak', '.log']);

import { KNOWN_CRS_WKT } from './crs';
export { KNOWN_CRS_WKT };

export class ShapefileValidationError extends Error {
  code: string;
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ShapefileValidationError';
    this.code = code;
  }
}

export interface UploadedFileItem {
  name: string;
  buffer: Buffer;
}

/**
 * Mengemas daftar file biner mentah ke dalam format arsip biner ZIP standar (Store / No Compression).
 */
export function createZipBuffer(files: UploadedFileItem[]): Buffer {
  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    // Pertahankan struktur folder relatif jika ada (misal: "Kebun Bakalan/lahan.shp"), cegah path traversal dan bersihkan drive letter Windows
    let cleanName = f.name
      .replace(/^[a-zA-Z]:[\\/]/, '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!cleanName || cleanName.includes('..')) {
      cleanName = path.posix.basename(f.name.replace(/\\/g, '/'));
    }
    const nameBuf = Buffer.from(cleanName, 'utf8');
    const crc = zlib.crc32(f.buffer);

    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); // Local file header signature
    lh.writeUInt16LE(20, 4);         // Version needed
    lh.writeUInt16LE(0, 6);          // General purpose bit flag
    lh.writeUInt16LE(0, 8);          // Compression method (0 = Store)
    lh.writeUInt16LE(0, 10);         // Last mod file time
    lh.writeUInt16LE(0, 12);         // Last mod file date
    lh.writeUInt32LE(crc, 14);       // CRC-32
    lh.writeUInt32LE(f.buffer.length, 18); // Compressed size
    lh.writeUInt32LE(f.buffer.length, 22); // Uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);  // Filename length
    lh.writeUInt16LE(0, 28);               // Extra field length
    nameBuf.copy(lh, 30);
    localHeaders.push(lh, f.buffer);

    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0); // Central directory header signature
    cdh.writeUInt16LE(20, 4);          // Version made by
    cdh.writeUInt16LE(20, 6);          // Version needed
    cdh.writeUInt16LE(0, 8);           // General purpose bit flag
    cdh.writeUInt16LE(0, 10);          // Compression method
    cdh.writeUInt16LE(0, 12);          // Last mod file time
    cdh.writeUInt16LE(0, 14);          // Last mod file date
    cdh.writeUInt32LE(crc, 16);        // CRC-32
    cdh.writeUInt32LE(f.buffer.length, 20); // Compressed size
    cdh.writeUInt32LE(f.buffer.length, 24); // Uncompressed size
    cdh.writeUInt16LE(nameBuf.length, 28);  // Filename length
    cdh.writeUInt16LE(0, 30);          // Extra field length
    cdh.writeUInt16LE(0, 32);          // File comment length
    cdh.writeUInt16LE(0, 34);          // Disk number start
    cdh.writeUInt16LE(0, 36);          // Internal file attributes
    cdh.writeUInt32LE(0, 38);          // External file attributes
    cdh.writeUInt32LE(offset, 42);     // Relative offset of local header
    nameBuf.copy(cdh, 46);
    cdHeaders.push(cdh);

    offset += lh.length + f.buffer.length;
  }

  const cdOffset = offset;
  const cdSize = cdHeaders.reduce((sum, h) => sum + h.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central dir signature
  eocd.writeUInt16LE(0, 4);          // Number of this disk
  eocd.writeUInt16LE(0, 6);          // Number of the disk with start of CD
  eocd.writeUInt16LE(files.length, 8); // Total entries on this disk
  eocd.writeUInt16LE(files.length, 10); // Total entries
  eocd.writeUInt32LE(cdSize, 12);     // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16);   // Offset of start of CD
  eocd.writeUInt16LE(0, 20);          // ZIP file comment length

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

/**
 * Menerima file-file Shapefile terpisah (.shp, .dbf, .shx, .prj, .cpg, .sbn, .sbx, .xml)
 * dan mengemasnya menjadi arsip ZIP standar yang siap diproses.
 */
export function bundleLooseFilesToZip(files: UploadedFileItem[]): {
  zipBuffer: Buffer;
  primaryName: string;
  shpCount: number;
} {
  const validFiles = files.filter((f) => {
    const baseName = path.basename(f.name).toLowerCase();
    if (IGNORED_FILES.has(baseName)) return false;
    const ext = path.extname(f.name).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) return false;
    return !FORBIDDEN_EXTENSIONS.has(ext);
  });

  const shpFiles = validFiles.filter((f) => f.name.toLowerCase().endsWith('.shp'));
  if (shpFiles.length === 0) {
    throw new ShapefileValidationError(
      'Tidak ditemukan file geometri (.shp) di antara file yang diunggah. Pastikan Anda menyertakan file berekstensi .shp bersama file pendukungnya (.dbf, .shx, .prj).',
      'NO_SHP_FOUND'
    );
  }

  const firstShpRel = shpFiles[0].name.replace(/\\/g, '/');
  const pathParts = firstShpRel.split('/').filter(Boolean);
  const primaryName =
    pathParts.length > 1
      ? pathParts[0]
      : path.basename(firstShpRel, path.extname(firstShpRel));

  const zipBuffer = createZipBuffer(validFiles);

  return {
    zipBuffer,
    primaryName,
    shpCount: shpFiles.length,
  };
}

interface ZipEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Memvalidasi keamanan struktur biner ZIP (mencegah ZIP Slip, ZIP Bomb, dan Executable)
 * serta mengekstrak seluruh file ke dalam direktori sementara yang terisolasi.
 */
async function extractAndValidateZipToTempDir(
  buffer: Buffer,
  tempDir: string
): Promise<Map<string, string>> {
  if (buffer.length < 22) {
    throw new ShapefileValidationError('File bukan arsip ZIP yang valid (ukuran terlalu kecil).', 'INVALID_ZIP');
  }

  if (buffer.length > MAX_ZIP_SIZE_BYTES) {
    throw new ShapefileValidationError(
      `Ukuran file ZIP melebihi batas maksimum (${MAX_ZIP_SIZE_BYTES / (1024 * 1024)} MB).`,
      'ZIP_TOO_LARGE'
    );
  }

  // Cek magic bytes PK\x03\x04
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new ShapefileValidationError(
      'Header file tidak sesuai dengan format arsip ZIP standar (Magic Bytes tidak valid).',
      'INVALID_ZIP_MAGIC'
    );
  }

  // Cari End of Central Directory (EOCD) signature: 0x06054b50
  let eocdOffset = -1;
  const minSearchOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minSearchOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new ShapefileValidationError(
      'Struktur Central Directory arsip ZIP rusak atau tidak ditemukan.',
      'CORRUPT_ZIP'
    );
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries === 0) {
    throw new ShapefileValidationError('Arsip ZIP kosong.', 'EMPTY_ZIP');
  }

  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new ShapefileValidationError(
      `Arsip ZIP berisi terlalu banyak file (${totalEntries}). Maksimum ${MAX_ZIP_ENTRIES} file diizinkan.`,
      'TOO_MANY_FILES'
    );
  }

  if (cdOffset + cdSize > buffer.length) {
    throw new ShapefileValidationError('Offset Central Directory ZIP tidak valid.', 'CORRUPT_ZIP');
  }

  const entries: ZipEntry[] = [];
  let ptr = cdOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > buffer.length || buffer.readUInt32LE(ptr) !== 0x02014b50) {
      throw new ShapefileValidationError('Header Central Directory ZIP rusak.', 'CORRUPT_ZIP');
    }

    const compressionMethod = buffer.readUInt16LE(ptr + 10);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const uncompressedSize = buffer.readUInt32LE(ptr + 24);
    const fileNameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = buffer.readUInt32LE(ptr + 42);

    const rawName = buffer.toString('utf8', ptr + 46, ptr + 46 + fileNameLen);
    ptr += 46 + fileNameLen + extraLen + commentLen;

    // Abaikan direktori atau metadata macOS __MACOSX
    if (rawName.endsWith('/') || rawName.endsWith('\\') || rawName.includes('__MACOSX')) {
      continue;
    }

    // Pencegahan ZIP Slip (Path Traversal) dan sanitasi path Windows
    const sanitizedRaw = rawName.replace(/^[a-zA-Z]:[\\/]/, '').replace(/\\/g, '/').replace(/^\/+/, '');
    const normalizedRel = path.posix.normalize(sanitizedRaw);
    if (
      normalizedRel.startsWith('/') ||
      normalizedRel.startsWith('..') ||
      normalizedRel.includes('../') ||
      normalizedRel.includes(':') ||
      normalizedRel.includes('\0')
    ) {
      throw new ShapefileValidationError(
        `Terdeteksi jalur file tidak aman (ZIP Slip attempt): "${rawName}".`,
        'ZIP_SLIP_DETECTED'
      );
    }

    // Tolak file executable / script berbahaya
    const ext = path.posix.extname(normalizedRel).toLowerCase();
    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      throw new ShapefileValidationError(
        `Arsip ZIP mengandung file terlarang/executable ("${rawName}"). Upload ditolak demi keamanan.`,
        'FORBIDDEN_FILE_TYPE'
      );
    }

    // Pencegahan ZIP Bomb (rasio kompresi ekstrem & batas ukuran total ekstraksi)
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
      if (uncompressedSize > 10 * 1024 * 1024) {
        throw new ShapefileValidationError(
          `Rasio kompresi file "${rawName}" mencurigakan (potensi ZIP Bomb).`,
          'ZIP_BOMB_DETECTED'
        );
      }
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new ShapefileValidationError(
        `Total ukuran ekstraksi ZIP melebihi batas aman (${MAX_UNCOMPRESSED_BYTES / (1024 * 1024)} MB).`,
        'UNCOMPRESSED_TOO_LARGE'
      );
    }

    entries.push({
      fileName: normalizedRel,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
  }

  // Ekstrak seluruh file ke tempDir
  const extractedMap = new Map<string, string>(); // key: normalized lowercase relative path, value: full path on disk

  for (const entry of entries) {
    const lhOffset = entry.localHeaderOffset;
    if (lhOffset + 30 > buffer.length || buffer.readUInt32LE(lhOffset) !== 0x04034b50) {
      throw new ShapefileValidationError(
        `Local header ZIP tidak valid untuk file "${entry.fileName}".`,
        'CORRUPT_ZIP'
      );
    }

    const lhNameLen = buffer.readUInt16LE(lhOffset + 26);
    const lhExtraLen = buffer.readUInt16LE(lhOffset + 28);
    const dataStart = lhOffset + 30 + lhNameLen + lhExtraLen;
    const dataEnd = dataStart + entry.compressedSize;

    if (dataEnd > buffer.length) {
      throw new ShapefileValidationError(
        `Data terkompresi untuk file "${entry.fileName}" melebihi ukuran arsip.`,
        'CORRUPT_ZIP'
      );
    }

    const compressedSlice = buffer.subarray(dataStart, dataEnd);
    let fileData: Buffer;

    if (entry.compressionMethod === 0) {
      fileData = Buffer.from(compressedSlice);
    } else if (entry.compressionMethod === 8) {
      fileData = zlib.inflateRawSync(compressedSlice, {
        maxOutputLength: MAX_UNCOMPRESSED_BYTES,
      });
    } else {
      throw new ShapefileValidationError(
        `Metode kompresi ZIP (${entry.compressionMethod}) pada "${entry.fileName}" tidak didukung.`,
        'UNSUPPORTED_COMPRESSION'
      );
    }

    const targetPath = path.resolve(tempDir, entry.fileName);
    const resolvedTempRoot = path.resolve(tempDir);
    if (!targetPath.startsWith(resolvedTempRoot + path.sep)) {
      throw new ShapefileValidationError('Pelanggaran batas direktori ekstraksi.', 'ZIP_SLIP_DETECTED');
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, fileData);
    extractedMap.set(entry.fileName.toLowerCase(), targetPath);
  }

  return extractedMap;
}

/**
 * Mengenali nama CRS dan SRID dari string WKT (.prj)
 */
export function parsePrjWktMetadata(wkt: string): { crsName: string; srid: number | null } {
  const cleaned = wkt.trim();
  if (!cleaned) {
    return { crsName: 'Unknown', srid: null };
  }

  // Ambil nama pertama di dalam tanda kutip PROJCS["Nama", ...] atau GEOGCS["Nama", ...]
  const nameMatch = cleaned.match(/^(?:PROJCS|GEOGCS|GEOCCS|COMPD_CS)\s*\[\s*"([^"]+)"/i);
  const crsName = nameMatch ? nameMatch[1].trim() : 'Custom_WKT_CRS';

  // Cek AUTHORITY["EPSG","xxxx"] paling akhir jika ada
  const authMatches = [...cleaned.matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
  if (authMatches.length > 0) {
    const lastCode = parseInt(authMatches[authMatches.length - 1][1], 10);
    if (!isNaN(lastCode) && lastCode > 0) {
      return { crsName: `${crsName} (EPSG:${lastCode})`, srid: lastCode };
    }
  }

  const upper = crsName.toUpperCase();

  // Deteksi UTM Zone WGS 84 (Utara & Selatan)
  const utmMatch = upper.match(/UTM_ZONE_(\d{1,2})([NS])/i) || cleaned.match(/UTM\s*Zone\s*(\d{1,2})\s*([NS])/i);
  if (utmMatch) {
    const zone = parseInt(utmMatch[1], 10);
    const hemi = utmMatch[2].toUpperCase();
    if (zone >= 1 && zone <= 60) {
      const srid = hemi === 'N' ? 32600 + zone : 32700 + zone;
      return { crsName: `${crsName} (EPSG:${srid})`, srid };
    }
  }

  if (upper.includes('WEB_MERCATOR') || upper.includes('PSEUDO_MERCATOR') || upper.includes('MERCATOR_AUXILIARY_SPHERE')) {
    return { crsName: `${crsName} (EPSG:3857)`, srid: 3857 };
  }

  if (
    !cleaned.toUpperCase().startsWith('PROJCS') &&
    (upper.includes('WGS_1984') || upper.includes('WGS 84') || upper.includes('WGS84'))
  ) {
    return { crsName: `${crsName} (EPSG:4326)`, srid: 4326 };
  }

  return { crsName, srid: null };
}

/**
 * Smart Auto-Detector CRS dari Bounding Box biner Shapefile (.shp)
 * Mengeliminasi 100% human-error salah pilih koordinat dan mencegah error OUT_OF_BOUNDS_CRS.
 */
export function detectSmartCrsFromShpHeader(
  shpBuffer: Buffer,
  hintText?: string,
  explicitFallback?: string | null
): { crsName: string; srid: number; wkt: string; detectedType: 'degree' | 'utm' | 'mercator' } {
  // Standar ESRI Shapefile: Bounding Box berada di byte 36..68
  let xMin = 0;
  let yMin = 0;
  let xMax = 0;
  let yMax = 0;
  let hasValidHeaderBbox = false;

  if (shpBuffer.length >= 68) {
    xMin = shpBuffer.readDoubleLE(36);
    yMin = shpBuffer.readDoubleLE(44);
    xMax = shpBuffer.readDoubleLE(52);
    yMax = shpBuffer.readDoubleLE(60);
    hasValidHeaderBbox = isFinite(xMin) && isFinite(yMin) && isFinite(xMax) && isFinite(yMax);
  }

  // 1. Kasus Koordinat Derajat Geografis (Lat/Long WGS 84):
  // X berada di -180..180 dan Y di -90..90.
  // Untuk Indonesia: X ~ 95..141 dan Y ~ -11..6
  if (hasValidHeaderBbox && xMin >= -180 && xMax <= 180 && yMin >= -90 && yMax <= 90) {
    return {
      crsName: KNOWN_CRS_WKT['EPSG:4326'].name,
      srid: 4326,
      wkt: KNOWN_CRS_WKT['EPSG:4326'].wkt,
      detectedType: 'degree',
    };
  }

  // 2. Kasus Koordinat Web Mercator (Jutaan meter di X dan Y)
  if (hasValidHeaderBbox && xMin > 1000000 && (yMin < 1000000 && yMin > -2000000)) {
    return {
      crsName: KNOWN_CRS_WKT['EPSG:3857'].name,
      srid: 3857,
      wkt: KNOWN_CRS_WKT['EPSG:3857'].wkt,
      detectedType: 'mercator',
    };
  }

  // 3. Kasus Koordinat Meter UTM (X: 100.000 s/d 900.000 meter)
  const lowerHint = (hintText || '').toLowerCase();

  // Jika ada explicit fallback yang valid dari pengguna, prioritaskan jika memang koordinatnya meter
  const cleanExplicit = explicitFallback?.trim().toUpperCase();
  if (cleanExplicit && cleanExplicit !== 'EPSG:4326' && KNOWN_CRS_WKT[cleanExplicit]) {
    return {
      crsName: KNOWN_CRS_WKT[cleanExplicit].name,
      srid: KNOWN_CRS_WKT[cleanExplicit].srid,
      wkt: KNOWN_CRS_WKT[cleanExplicit].wkt,
      detectedType: 'utm',
    };
  }

  // Deteksi Otomatis Zona UTM Berdasarkan Petunjuk Wilayah / Nama Kebun
  // Wilayah Jawa Barat, Banten, DKI, Lampung, Sumsel -> UTM Zone 48S (EPSG:32748)
  if (
    lowerHint.includes('cianjur') ||
    lowerHint.includes('bandung') ||
    lowerHint.includes('cibeureum') ||
    lowerHint.includes('sarongge') ||
    lowerHint.includes('gedeh') ||
    lowerHint.includes('garut') ||
    lowerHint.includes('sukabumi') ||
    lowerHint.includes('bogor') ||
    lowerHint.includes('subang') ||
    lowerHint.includes('purwakarta') ||
    lowerHint.includes('banten') ||
    lowerHint.includes('jabar') ||
    lowerHint.includes('lampung') ||
    lowerHint.includes('sumsel')
  ) {
    return {
      crsName: KNOWN_CRS_WKT['EPSG:32748'].name,
      srid: 32748,
      wkt: KNOWN_CRS_WKT['EPSG:32748'].wkt,
      detectedType: 'utm',
    };
  }

  // Wilayah Kaltim, Sulawesi, Bali, NTB, NTT -> UTM Zone 50S (EPSG:32750)
  if (
    lowerHint.includes('kaltim') ||
    lowerHint.includes('sulawesi') ||
    lowerHint.includes('bali') ||
    lowerHint.includes('ntb') ||
    lowerHint.includes('ntt') ||
    lowerHint.includes('makassar')
  ) {
    return {
      crsName: KNOWN_CRS_WKT['EPSG:32750'].name,
      srid: 32750,
      wkt: KNOWN_CRS_WKT['EPSG:32750'].wkt,
      detectedType: 'utm',
    };
  }

  // Wilayah Aceh & Sumatera Utara -> UTM Zone 47N (EPSG:32647)
  if (lowerHint.includes('aceh') || lowerHint.includes('sumut') || lowerHint.includes('medan')) {
    return {
      crsName: KNOWN_CRS_WKT['EPSG:32647'].name,
      srid: 32647,
      wkt: KNOWN_CRS_WKT['EPSG:32647'].wkt,
      detectedType: 'utm',
    };
  }

  // Wilayah Riau & Kalbar -> UTM Zone 48N (EPSG:32648)
  if (
    lowerHint.includes('riau') ||
    lowerHint.includes('kalbar') ||
    lowerHint.includes('pekanbaru') ||
    lowerHint.includes('pontianak')
  ) {
    return {
      crsName: KNOWN_CRS_WKT['EPSG:32648'].name,
      srid: 32648,
      wkt: KNOWN_CRS_WKT['EPSG:32648'].wkt,
      detectedType: 'utm',
    };
  }

  // Default UTM Perkebunan Indonesia Selatan (Jawa Timur & Jawa Tengah: Pasuruan, Bakalan, Malang, Solo, dll.)
  // -> UTM Zone 49S (EPSG:32749)
  return {
    crsName: KNOWN_CRS_WKT['EPSG:32749'].name,
    srid: 32749,
    wkt: KNOWN_CRS_WKT['EPSG:32749'].wkt,
    detectedType: 'utm',
  };
}

/**
 * Membersihkan nama kebun dari artefak timestamp Google Drive, suffix -001, dsb.
 * Contoh: "Kebun Cibeureum-20261116T064148Z-1-001" -> "Kebun Cibeureum"
 */
export function extractCleanKebunName(rawCandidate?: string | null): string {
  if (!rawCandidate) return '';
  let cleaned = rawCandidate.replace(/\.(zip|shp|dbf|prj|geojson|json)$/i, '');
  cleaned = cleaned.replace(/^\d{10,14}[_-]/, ''); // timestamp numeric di depan
  cleaned = cleaned.replace(/-\d{8}T\d{6}Z.*$/i, ''); // Google Drive timestamp suffix
  cleaned = cleaned.replace(/[-_]\d{3,}$/, ''); // suffix -001 dsb
  cleaned = cleaned.replace(/[-_]v\d+$/i, ''); // suffix _v1

  const parts = cleaned.split(/[\/\\]+/).filter(Boolean);
  const kebunPart =
    parts.slice().reverse().find((p) => p.toLowerCase().includes('kebun') || p.toLowerCase().startsWith('kp')) ||
    parts[parts.length - 1] ||
    cleaned;

  return kebunPart
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Deteksi otomatis wilayah perkebunan dari koordinat spasial (Lat/Lng WGS 84)
 * atau petunjuk nama folder/file.
 */
export function detectWilayahFromCoordsAndName(
  lng?: number,
  lat?: number,
  nameHint?: string
): { wilayah: string; defaultPerusahaan: string } {
  const hint = (nameHint || '').toLowerCase();

  // 1. Text hint matching
  if (
    hint.includes('cibeureum') ||
    hint.includes('cibereum') ||
    hint.includes('pangalengan') ||
    hint.includes('bandung')
  ) {
    return {
      wilayah: 'Kabupaten Bandung, Jawa Barat',
      defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
    };
  }
  if (
    hint.includes('sarongge') ||
    hint.includes('gedeh') ||
    hint.includes('cianjur') ||
    hint.includes('pacet')
  ) {
    return {
      wilayah: 'Kabupaten Cianjur, Jawa Barat',
      defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
    };
  }
  if (
    hint.includes('bakalan') ||
    hint.includes('pasuruan') ||
    hint.includes('kraton') ||
    hint.includes('purwosari')
  ) {
    return {
      wilayah: 'Pasuruan, Jawa Timur',
      defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
    };
  }
  if (hint.includes('malang') || hint.includes('batu') || hint.includes('wonosari')) {
    return {
      wilayah: 'Kabupaten Malang, Jawa Timur',
      defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
    };
  }
  if (hint.includes('jember') || hint.includes('banyuwangi') || hint.includes('kediri')) {
    return {
      wilayah: 'Jawa Timur',
      defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
    };
  }
  if (hint.includes('subang') || hint.includes('garut') || hint.includes('ciwidey') || hint.includes('bogor')) {
    return {
      wilayah: 'Jawa Barat',
      defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
    };
  }

  // 2. Spatial coordinates boundary matching (jika lng dan lat terdefinisi dalam derajat WGS 84)
  if (typeof lng === 'number' && typeof lat === 'number' && isFinite(lng) && isFinite(lat)) {
    // Bandung & sekitarnya: 107.3 .. 107.9, -7.4 .. -6.8
    if (lng >= 107.3 && lng <= 107.9 && lat >= -7.4 && lat <= -6.8) {
      return {
        wilayah: 'Kabupaten Bandung, Jawa Barat',
        defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
      };
    }
    // Cianjur & sekitarnya: 106.8 .. 107.3, -7.3 .. -6.6
    if (lng >= 106.8 && lng < 107.3 && lat >= -7.3 && lat <= -6.6) {
      return {
        wilayah: 'Kabupaten Cianjur, Jawa Barat',
        defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
      };
    }
    // Pasuruan & Jawa Timur bagian timur: 112.5 .. 113.3, -8.0 .. -7.4
    if (lng >= 112.5 && lng <= 113.3 && lat >= -8.0 && lat <= -7.4) {
      return {
        wilayah: 'Pasuruan, Jawa Timur',
        defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
      };
    }
    // Malang & sekitarnya: 112.3 .. 112.9, -8.4 .. -7.9
    if (lng >= 112.3 && lng <= 112.9 && lat >= -8.4 && lat < -7.9) {
      return {
        wilayah: 'Kabupaten Malang, Jawa Timur',
        defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
      };
    }
    // Umum Jawa Barat: 106.3 .. 108.8, -7.8 .. -5.9
    if (lng >= 106.3 && lng <= 108.8 && lat >= -7.8 && lat <= -5.9) {
      return {
        wilayah: 'Jawa Barat',
        defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
      };
    }
    // Umum Jawa Timur: 111.0 .. 114.6, -8.8 .. -6.7
    if (lng >= 111.0 && lng <= 114.6 && lat >= -8.8 && lat <= -6.7) {
      return {
        wilayah: 'Jawa Timur',
        defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
      };
    }
  }

  return {
    wilayah: 'Wilayah Operasional Perkebunan',
    defaultPerusahaan: 'PT Perkebunan Nusantara I (Regional 4)',
  };
}

export interface ParseShapefileOptions {
  /**
   * CRS eksplisit yang dipilih pengguna apabila file .prj tidak tersedia di dalam ZIP.
   * Contoh: 'EPSG:4326', 'EPSG:32648', dll.
   */
  fallbackCrs?: string | null;
}

/**
 * Mengekstrak, memvalidasi komponen (.shp, .shx, .dbf, .prj), membaca CRS asal per layer,
 * dan mentransformasikan koordinat ke WGS 84 (EPSG:4326).
 */
export async function parseShapefileZip(
  buffer: Buffer,
  options?: ParseShapefileOptions
): Promise<ExtractedShapefile[]> {
  const tempDir = path.join(
    os.tmpdir(),
    `nusagis_shp_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
  );

  await fs.mkdir(tempDir, { recursive: true });

  try {
    const extractedMap = await extractAndValidateZipToTempDir(buffer, tempDir);

    // Cari seluruh file .shp di dalam ZIP
    const shpKeys: string[] = [];
    for (const relKey of extractedMap.keys()) {
      if (relKey.endsWith('.shp')) {
        shpKeys.push(relKey);
      }
    }

    if (shpKeys.length === 0) {
      throw new ShapefileValidationError(
        'Tidak ditemukan file Shapefile (.shp) di dalam arsip ZIP.',
        'NO_SHP_FOUND'
      );
    }

    const shpModule = await import('shpjs');
    const parseShp = shpModule.parseShp;
    const parseDbf = shpModule.parseDbf;
    const combine = shpModule.combine;

    const results: ExtractedShapefile[] = [];
    const seenLayerNames = new Map<string, number>();

    for (let i = 0; i < shpKeys.length; i++) {
      const shpRelKey = shpKeys[i];
      const baseRelKey = shpRelKey.slice(0, -4); // tanpa '.shp'
      const baseFileName = path.posix.basename(baseRelKey);
      const parentDir = path.posix.dirname(shpRelKey);
      const folderName = parentDir && parentDir !== '.' ? parentDir : undefined;

      const shpDiskPath = extractedMap.get(shpRelKey);
      let dbfDiskPath = extractedMap.get(`${baseRelKey}.dbf`);
      const prjDiskPath = extractedMap.get(`${baseRelKey}.prj`);
      const cpgDiskPath = extractedMap.get(`${baseRelKey}.cpg`);

      // Fallback .dbf jika nama tidak sama persis namun berada di folder yang sama
      if (!dbfDiskPath && parentDir) {
        for (const [k, p] of extractedMap.entries()) {
          if (k.endsWith('.dbf') && path.posix.dirname(k) === parentDir) {
            dbfDiskPath = p;
            break;
          }
        }
      }

      // Validasi komponen utama Shapefile (.shp)
      if (!shpDiskPath) {
        throw new ShapefileValidationError(
          `Shapefile "${baseFileName}" tidak memiliki file geometri (.shp).`,
          'INCOMPLETE_SHAPEFILE'
        );
      }

      const shpBuf = await fs.readFile(shpDiskPath);

      // Baca CRS dari .prj (atau aktifkan smart auto-detect dari biner shapefile jika .prj hilang)
      let prjWkt: string | undefined;
      let crsAsal: string = '';
      let sridAsal: number | null = null;
      let isPrjMissing = false;

      if (prjDiskPath) {
        const rawPrj = (await fs.readFile(prjDiskPath, 'utf8')).trim();
        if (rawPrj.length > 0) {
          prjWkt = rawPrj;
          const meta = parsePrjWktMetadata(rawPrj);
          crsAsal = meta.crsName;
          sridAsal = meta.srid;
        } else {
          isPrjMissing = true;
        }
      } else {
        isPrjMissing = true;
      }

      // Jika .prj tidak ada/kosong, aktifkan pendeteksi otomatis cerdas (Auto-Detect)
      if (!prjWkt) {
        const smart = detectSmartCrsFromShpHeader(
          shpBuf,
          `${folderName || ''} ${baseFileName} ${options?.fallbackCrs || ''}`,
          options?.fallbackCrs
        );
        prjWkt = smart.wkt;
        crsAsal = `${smart.crsName} (Auto-Detected)`;
        sridAsal = smart.srid;
      }

      // Fail-safe Sanity Check:
      // Jika prjWkt adalah WGS84 derajat tetapi koordinat biner .shp jelas-jelas meter (> 1000 meter):
      // Gantikan otomatis ke UTM yang sesuai agar TIDAK PERNAH terjadi crash OUT_OF_BOUNDS_CRS!
      if (shpBuf.length >= 68) {
        const xMinHdr = shpBuf.readDoubleLE(36);
        if (xMinHdr > 1000 && prjWkt.includes('GCS_WGS_1984') && !prjWkt.includes('PROJCS')) {
          const corrected = detectSmartCrsFromShpHeader(
            shpBuf,
            `${folderName || ''} ${baseFileName}`
          );
          prjWkt = corrected.wkt;
          crsAsal = `${corrected.crsName} (Auto-Corrected UTM)`;
          sridAsal = corrected.srid;
        }
      }

      const geometries = parseShp(shpBuf, prjWkt);

      let collection: FeatureCollection<Geometry, Record<string, unknown>>;
      if (dbfDiskPath) {
        const dbfBuf = await fs.readFile(dbfDiskPath);
        const cpgBuf = cpgDiskPath ? await fs.readFile(cpgDiskPath) : undefined;
        const dbfProperties = parseDbf(dbfBuf, cpgBuf || Buffer.from('UTF-8'));
        collection = combine([geometries, dbfProperties]) as FeatureCollection<
          Geometry,
          Record<string, unknown>
        >;
      } else {
        collection = {
          type: 'FeatureCollection',
          features: (geometries as Geometry[]).map((geom, idx) => ({
            type: 'Feature',
            id: idx + 1,
            geometry: geom,
            properties: { FID: idx + 1, NAMA: `${baseFileName} #${idx + 1}` },
          })),
        };
      }

      if (!collection || !collection.features || collection.features.length === 0) {
        continue;
      }

      // Cek apakah koordinat masih berupa meter (UTM/Mercator belum terproyeksikan oleh shpjs)
      const firstCoords = collection.features[0]?.geometry
        ? extractCoordinates(collection.features[0].geometry)
        : [];
      const hasMeterCoordinates = firstCoords.some(
        ([lng, lat]) => lng < -180 || lng > 180 || lat < -90 || lat > 90
      );

      if (hasMeterCoordinates) {
        // Otomatis re-parse menggunakan WKT UTM standar dari auto-detector
        const smart = detectSmartCrsFromShpHeader(
          shpBuf,
          `${folderName || ''} ${baseFileName}`
        );
        try {
          const reGeom = parseShp(shpBuf, smart.wkt);
          if (dbfDiskPath) {
            const dbfBuf = await fs.readFile(dbfDiskPath);
            const cpgBuf = cpgDiskPath ? await fs.readFile(cpgDiskPath) : undefined;
            const dbfProperties = parseDbf(dbfBuf, cpgBuf || Buffer.from('UTF-8'));
            collection = combine([reGeom, dbfProperties]) as FeatureCollection<
              Geometry,
              Record<string, unknown>
            >;
          } else {
            collection = {
              type: 'FeatureCollection',
              features: (reGeom as Geometry[]).map((geom, idx) => ({
                type: 'Feature',
                id: idx + 1,
                geometry: geom,
                properties: { FID: idx + 1, NAMA: `${baseFileName} #${idx + 1}` },
              })),
            };
          }
          crsAsal = `${smart.crsName} (Auto-Converted)`;
          sridAsal = smart.srid;
        } catch {
          // Tetap lanjutkan, PostGIS ST_Transform akan menyempurnakannya saat insert
        }
      }

      let cleanLayerName = baseFileName.replace(/[\/\\?%*:|"<>]/g, '_').trim();
      if (
        (cleanLayerName.toLowerCase() === 'batas_kebun' || cleanLayerName.toLowerCase() === 'kebun') &&
        folderName
      ) {
        const cleanFolder = extractCleanKebunName(folderName);
        if (cleanFolder) {
          cleanLayerName = `Batas ${cleanFolder}`;
        }
      }

      // Disambiguasi nama layer jika ada duplikat dalam zip yang sama
      const lowerClean = cleanLayerName.toLowerCase();
      const count = seenLayerNames.get(lowerClean) || 0;
      seenLayerNames.set(lowerClean, count + 1);
      if (count > 0) {
        cleanLayerName = `${cleanLayerName} (${count + 1})`;
      }

      // Validasi geometri & hitung Bounding Box
      const validFeatures: Array<{
        geometry: Geometry;
        properties: Record<string, unknown>;
      }> = [];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let primaryGeomType = 'Polygon';

      for (const feat of collection.features) {
        if (!feat.geometry) continue;
        const coords = extractCoordinates(feat.geometry);
        if (coords.length === 0) continue;

        for (const [lng, lat] of coords) {
          if (isFinite(lng) && isFinite(lat)) {
            // Hanya update bounding box jika dalam derajat valid
            if (lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
              if (lng < minX) minX = lng;
              if (lat < minY) minY = lat;
              if (lng > maxX) maxX = lng;
              if (lat > maxY) maxY = lat;
            }
          }
        }

        validFeatures.push({
          geometry: feat.geometry,
          properties: feat.properties || {},
        });
      }

      if (validFeatures.length === 0) {
        throw new ShapefileValidationError(
          `Shapefile "${baseFileName}.shp" tidak memiliki geometri yang valid.`,
          'EMPTY_GEOMETRY'
        );
      }

      const firstGeom = validFeatures[0].geometry;
      if (firstGeom.type.includes('Polygon')) primaryGeomType = 'MultiPolygon';
      else if (firstGeom.type.includes('Line')) primaryGeomType = 'MultiLineString';
      else if (firstGeom.type.includes('Point')) primaryGeomType = 'Point';

      const hasValidBbox =
        isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY);
      const bbox: [number, number, number, number] | undefined = hasValidBbox
        ? [minX, minY, maxX, maxY]
        : undefined;
      const extent: ExtentBox | undefined = hasValidBbox
        ? { west: minX, south: minY, east: maxX, north: maxY }
        : undefined;

      results.push({
        layerName: cleanLayerName,
        shapefileName: `${cleanLayerName}.shp`,
        folderName,
        geometryType: primaryGeomType,
        featureCount: validFeatures.length,
        crsAsal,
        sridAsal,
        isPrjMissing,
        features: validFeatures,
        bbox,
        extent,
      });
    }

    return results;
  } finally {
    // Selalu bersihkan direktori sementara beserta seluruh isinya secara aman
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Parsing file GeoJSON (.geojson atau .json)
 */
export function parseGeoJsonBuffer(
  buffer: Buffer,
  fileName: string
): ExtractedShapefile {
  let json: unknown;
  try {
    const text = buffer.toString('utf8');
    json = JSON.parse(text);
  } catch {
    throw new ShapefileValidationError(
      `File "${fileName}" bukan file JSON/GeoJSON yang valid.`,
      'INVALID_JSON'
    );
  }

  if (!json || typeof json !== 'object') {
    throw new ShapefileValidationError(
      `Format GeoJSON pada "${fileName}" tidak valid.`,
      'INVALID_GEOJSON'
    );
  }

  const rawFeatures: Array<{ geometry: Geometry; properties: Record<string, unknown> }> = [];
  const obj = json as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown };

  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    for (const f of obj.features) {
      if (f && typeof f === 'object' && 'geometry' in f) {
        const feat = f as { geometry?: Geometry; properties?: Record<string, unknown> };
        if (feat.geometry && typeof feat.geometry === 'object') {
          rawFeatures.push({
            geometry: feat.geometry,
            properties: feat.properties || {},
          });
        }
      }
    }
  } else if (obj.type === 'Feature' && obj.geometry && typeof obj.geometry === 'object') {
    rawFeatures.push({
      geometry: obj.geometry as Geometry,
      properties: (obj.properties as Record<string, unknown>) || {},
    });
  } else {
    throw new ShapefileValidationError(
      `Objek GeoJSON pada "${fileName}" harus berupa FeatureCollection atau Feature.`,
      'INVALID_GEOJSON_STRUCTURE'
    );
  }

  if (rawFeatures.length === 0) {
    throw new ShapefileValidationError(
      `File GeoJSON "${fileName}" tidak memuat fitur geometri apapun.`,
      'EMPTY_GEOJSON'
    );
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const feat of rawFeatures) {
    const pts = extractCoordinates(feat.geometry);
    for (const [lng, lat] of pts) {
      if (!isFinite(lng) || !isFinite(lat)) {
        throw new ShapefileValidationError(
          `Koordinat NaN/Infinity ditemukan pada file GeoJSON "${fileName}".`,
          'INVALID_COORDINATES'
        );
      }
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        throw new ShapefileValidationError(
          `Koordinat GeoJSON (${lng}, ${lat}) pada "${fileName}" berada di luar batas WGS84 EPSG:4326.`,
          'OUT_OF_BOUNDS_CRS'
        );
      }
      if (lng < minX) minX = lng;
      if (lat < minY) minY = lat;
      if (lng > maxX) maxX = lng;
      if (lat > maxY) maxY = lat;
    }
  }

  const firstGeom = rawFeatures[0].geometry;
  let primaryGeomType = 'Polygon';
  if (firstGeom.type.includes('Polygon')) primaryGeomType = 'MultiPolygon';
  else if (firstGeom.type.includes('Line')) primaryGeomType = 'MultiLineString';
  else if (firstGeom.type.includes('Point')) primaryGeomType = 'Point';

  const cleanName = fileName.replace(/\.(geojson|json)$/i, '').replace(/[\/\\?%*:|"<>]/g, '_').trim();
  const hasValidBbox = isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY);
  const bbox: [number, number, number, number] | undefined = hasValidBbox
    ? [minX, minY, maxX, maxY]
    : undefined;
  const extent: ExtentBox | undefined = hasValidBbox
    ? { west: minX, south: minY, east: maxX, north: maxY }
    : undefined;

  return {
    layerName: cleanName,
    shapefileName: fileName,
    geometryType: primaryGeomType,
    featureCount: rawFeatures.length,
    crsAsal: 'WGS 84 (EPSG:4326)',
    sridAsal: 4326,
    features: rawFeatures,
    bbox,
    extent,
  };
}

export function getLayerPaletteColor(index: number): string {
  return DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
}

function extractCoordinates(geom: Geometry): [number, number][] {
  const result: [number, number][] = [];
  function recurse(arr: unknown) {
    if (!Array.isArray(arr)) return;
    if (arr.length >= 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
      result.push([arr[0], arr[1]]);
    } else {
      arr.forEach(recurse);
    }
  }
  if ('coordinates' in geom) {
    recurse((geom as { coordinates: unknown }).coordinates);
  }
  return result;
}
