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
    const cleanName = path.posix.basename(f.name.replace(/\\/g, '/'));
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
    const ext = path.extname(f.name).toLowerCase();
    return !FORBIDDEN_EXTENSIONS.has(ext);
  });

  const shpFiles = validFiles.filter((f) => f.name.toLowerCase().endsWith('.shp'));
  if (shpFiles.length === 0) {
    throw new ShapefileValidationError(
      'Tidak ditemukan file geometri (.shp) di antara file yang diunggah. Pastikan Anda menyertakan file berekstensi .shp bersama file pendukungnya (.dbf, .shx, .prj).',
      'NO_SHP_FOUND'
    );
  }

  const primaryName = path.basename(shpFiles[0].name, path.extname(shpFiles[0].name));
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

    // Pencegahan ZIP Slip (Path Traversal)
    const normalizedRel = path.posix.normalize(rawName.replace(/\\/g, '/'));
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

    for (let i = 0; i < shpKeys.length; i++) {
      const shpRelKey = shpKeys[i];
      const baseRelKey = shpRelKey.slice(0, -4); // tanpa '.shp'
      const baseFileName = path.posix.basename(baseRelKey);

      const shpDiskPath = extractedMap.get(shpRelKey);
      const dbfDiskPath = extractedMap.get(`${baseRelKey}.dbf`);
      const prjDiskPath = extractedMap.get(`${baseRelKey}.prj`);
      const cpgDiskPath = extractedMap.get(`${baseRelKey}.cpg`);

      // Validasi komponen utama Shapefile (.shp)
      if (!shpDiskPath) {
        throw new ShapefileValidationError(
          `Shapefile "${baseFileName}" tidak memiliki file geometri (.shp).`,
          'INCOMPLETE_SHAPEFILE'
        );
      }

      // Baca CRS dari .prj (atau gunakan fallbackCrs / EPSG:4326 sebagai default)
      let prjWkt: string | undefined;
      let crsAsal: string;
      let sridAsal: number | null = null;

      if (prjDiskPath) {
        const rawPrj = (await fs.readFile(prjDiskPath, 'utf8')).trim();
        if (rawPrj.length > 0) {
          prjWkt = rawPrj;
          const meta = parsePrjWktMetadata(rawPrj);
          crsAsal = meta.crsName;
          sridAsal = meta.srid;
        } else {
          prjWkt = undefined;
          crsAsal = '';
        }
      } else {
        crsAsal = '';
      }

      if (!prjWkt) {
        const fbKey = options?.fallbackCrs?.trim().toUpperCase();
        if (fbKey && KNOWN_CRS_WKT[fbKey]) {
          prjWkt = KNOWN_CRS_WKT[fbKey].wkt;
          crsAsal = KNOWN_CRS_WKT[fbKey].name;
          sridAsal = KNOWN_CRS_WKT[fbKey].srid;
        } else {
          // Default WGS 84 jika file .prj tidak disertakan
          prjWkt = KNOWN_CRS_WKT['EPSG:4326'].wkt;
          crsAsal = 'WGS 84 (EPSG:4326)';
          sridAsal = 4326;
        }
      }

      const shpBuf = await fs.readFile(shpDiskPath);
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
        // Jika file .dbf tidak ada, buat koleksi dengan properti FID sederhana
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

      const cleanLayerName = baseFileName.replace(/[\/\\?%*:|"<>]/g, '_').trim();

      // Validasi geometri & koordinat hasil transformasi EPSG:4326
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
          if (
            typeof lng !== 'number' ||
            typeof lat !== 'number' ||
            !isFinite(lng) ||
            !isFinite(lat)
          ) {
            throw new ShapefileValidationError(
              `Terdapat koordinat NaN/Infinity pada Shapefile "${baseFileName}.shp".`,
              'INVALID_COORDINATES'
            );
          }

          if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
            throw new ShapefileValidationError(
              `Koordinat hasil transformasi (${lng.toFixed(4)}, ${lat.toFixed(4)}) pada "${baseFileName}.shp" berada di luar batas geografis EPSG:4326 [-180..180, -90..90]. Pastikan CRS asal (.prj) sesuai.`,
              'OUT_OF_BOUNDS_CRS'
            );
          }

          if (lng < minX) minX = lng;
          if (lat < minY) minY = lat;
          if (lng > maxX) maxX = lng;
          if (lat > maxY) maxY = lat;
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
        geometryType: primaryGeomType,
        featureCount: validFeatures.length,
        crsAsal,
        sridAsal,
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
