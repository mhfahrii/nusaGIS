import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { requireUser, safeErrorDetail } from '@/lib/auth/guard';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import {
  parseShapefileZip,
  parseGeoJsonBuffer,
  bundleLooseFilesToZip,
  extractCleanKebunName,
  detectWilayahFromCoordsAndName,
  ShapefileValidationError,
  UploadedFileItem,
  MAX_ZIP_SIZE_BYTES,
} from '@/lib/gis/shapefile';
import { parseWilayahHierarchy } from '@/lib/gis/wilayah';
import { parseGeoTiffMetadata } from '@/lib/gis/geotiff';
import type { DetectedDataset } from '@/types/gis';

export const maxDuration = 300;

function decodeUploadFileName(rawHeader: string | null): string {
  if (!rawHeader) return 'dataset.zip';
  try {
    return path.basename(decodeURIComponent(rawHeader).replace(/\\/g, '/')) || 'dataset.zip';
  } catch {
    return path.basename(rawHeader.replace(/\\/g, '/')) || 'dataset.zip';
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { requireJson: false, permission: 'upload_layer' });
  if (auth.response) return auth.response;

  const retryAfter = checkRateLimit(`gis-upload:${auth.user.id}`, 25, 10 * 60 * 1000);
  if (retryAfter > 0) {
    return NextResponse.json(
      {
        status: 'error',
        message: `Terlalu banyak aktivitas inspeksi/upload file GIS. Silakan tunggu ${Math.ceil(retryAfter / 60)} menit lagi.`,
      },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const tempId = crypto.randomBytes(16).toString('hex');
  const tempDir = path.join(os.tmpdir(), 'nusagis-upload-cache');
  const tempFilePath = path.join(tempDir, `${tempId}.bin`);
  const tempMetaPath = path.join(tempDir, `${tempId}.meta.json`);
  let alreadySavedTempFile = false;

  const cleanupTempFile = async () => {
    await fs.unlink(tempFilePath).catch(() => {});
  };

  try {
    await fs.mkdir(tempDir, { recursive: true });

    // Auto-cleanup file cache sementara yang berumur lebih dari 2 jam agar disk server tetap bersih
    fs.readdir(tempDir)
      .then(async (entries) => {
        const expireBefore = Date.now() - 2 * 60 * 60 * 1000;
        for (const name of entries) {
          const full = path.join(tempDir, name);
          try {
            const st = await fs.stat(full);
            if (st.isFile() && st.mtimeMs < expireBefore) {
              await fs.unlink(full).catch(() => {});
            }
          } catch {
            // abaikan
          }
        }
      })
      .catch(() => {});

    const contentType = req.headers.get('content-type') || '';

    let fileBuffer: Buffer;
    let fileName = '';
    let fallbackCrs: string | null = null;
    let isZip = false;
    let isGeoTiff = false;

    if (contentType.includes('application/octet-stream')) {
      if (!req.body) {
        return NextResponse.json(
          { status: 'error', message: 'File GIS wajib diunggah untuk pemeriksaan.' },
          { status: 400 }
        );
      }

      fileName = decodeUploadFileName(req.headers.get('x-file-name'));
      fallbackCrs = req.headers.get('x-fallback-crs')?.trim() || null;

      const contentLength = Number(req.headers.get('content-length') || 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_ZIP_SIZE_BYTES) {
        return NextResponse.json(
          {
            status: 'error',
            message: `Ukuran file (${(contentLength / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimum (${MAX_ZIP_SIZE_BYTES / (1024 * 1024)} MB).`,
          },
          { status: 413 }
        );
      }

      // Stream raw file body to disk to avoid cloning/buffering large payloads via FormData in memory
      const reader = req.body.getReader();
      const writeStream = createWriteStream(tempFilePath);
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;

          totalBytes += value.byteLength;
          if (totalBytes > MAX_ZIP_SIZE_BYTES) {
            await reader.cancel().catch(() => {});
            writeStream.destroy();
            await cleanupTempFile();
            return NextResponse.json(
              {
                status: 'error',
                message: `Ukuran file (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimum (${MAX_ZIP_SIZE_BYTES / (1024 * 1024)} MB).`,
              },
              { status: 413 }
            );
          }

          if (!writeStream.write(value)) {
            await once(writeStream, 'drain');
          }
        }
        writeStream.end();
        await finished(writeStream);
      } catch (streamErr) {
        await reader.cancel().catch(() => {});
        writeStream.destroy();
        await cleanupTempFile();
        throw streamErr;
      }

      if (totalBytes === 0) {
        await cleanupTempFile();
        return NextResponse.json(
          { status: 'error', message: 'File yang diunggah kosong (0 bytes).' },
          { status: 400 }
        );
      }

      alreadySavedTempFile = true;
      const lowerName = fileName.toLowerCase();
      isGeoTiff = lowerName.endsWith('.tif') || lowerName.endsWith('.tiff');
      isZip = lowerName.endsWith('.zip');
      fileBuffer = await fs.readFile(tempFilePath);
    } else {
      let formData: FormData;
      try {
        formData = await req.formData();
      } catch (formErr) {
        const detailMsg = formErr instanceof Error ? formErr.message : String(formErr);
        console.error('Inspect GIS FormData Error:', detailMsg);
        return NextResponse.json(
          {
            status: 'error',
            message:
              'Gagal membaca berkas unggahan (ukuran total melebihi batas atau koneksi terputus). Pastikan ukuran total komponen Shapefile di bawah 250 MB.',
            detail: detailMsg,
          },
          { status: 413 }
        );
      }

      let rawFiles = formData.getAll('files') as File[];
      if (rawFiles.length === 0) {
        rawFiles = formData.getAll('file') as File[];
      }
      fallbackCrs = (formData.get('fallback_crs') as string | null)?.trim() || null;

      if (rawFiles.length === 0) {
        return NextResponse.json(
          { status: 'error', message: 'File GIS wajib diunggah untuk pemeriksaan.' },
          { status: 400 }
        );
      }

      if (
        rawFiles.length === 1 &&
        (rawFiles[0].name.toLowerCase().endsWith('.tif') ||
          rawFiles[0].name.toLowerCase().endsWith('.tiff'))
      ) {
        const f = rawFiles[0];
        fileName = path.basename(f.name.replace(/\\/g, '/'));
        fileBuffer = Buffer.from(await f.arrayBuffer());
        isGeoTiff = true;
      } else if (
        rawFiles.length === 1 &&
        (rawFiles[0].name.toLowerCase().endsWith('.geojson') ||
          rawFiles[0].name.toLowerCase().endsWith('.json'))
      ) {
        const f = rawFiles[0];
        fileName = path.basename(f.name.replace(/\\/g, '/'));
        fileBuffer = Buffer.from(await f.arrayBuffer());
      } else if (rawFiles.length === 1 && rawFiles[0].name.toLowerCase().endsWith('.zip')) {
        const f = rawFiles[0];
        fileName = path.basename(f.name.replace(/\\/g, '/'));
        fileBuffer = Buffer.from(await f.arrayBuffer());
        isZip = true;
      } else {
        const fileItems: UploadedFileItem[] = [];
        for (const f of rawFiles) {
          fileItems.push({
            name: f.name,
            buffer: Buffer.from(await f.arrayBuffer()),
          });
        }

        try {
          const bundled = bundleLooseFilesToZip(fileItems);
          fileBuffer = bundled.zipBuffer;
          fileName = `${bundled.primaryName}.zip`;
          isZip = true;
        } catch (err) {
          if (err instanceof ShapefileValidationError) {
            return NextResponse.json(
              {
                status: 'error',
                code: err.code,
                message: err.message,
              },
              { status: 422 }
            );
          }
          throw err;
        }
      }

      if (fileBuffer.length === 0) {
        return NextResponse.json(
          { status: 'error', message: 'File yang diunggah kosong (0 bytes).' },
          { status: 400 }
        );
      }

      if (fileBuffer.length > MAX_ZIP_SIZE_BYTES) {
        return NextResponse.json(
          {
            status: 'error',
            message: `Ukuran file (${(fileBuffer.length / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimum (${MAX_ZIP_SIZE_BYTES / (1024 * 1024)} MB).`,
          },
          { status: 413 }
        );
      }
    }

    const detectedDatasets: DetectedDataset[] = [];

    if (isGeoTiff) {
      let meta;
      try {
        meta = await parseGeoTiffMetadata(fileBuffer);
      } catch (err) {
        await cleanupTempFile();
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { status: 'error', message: `Gagal membaca file GeoTIFF: ${msg}` },
          { status: 422 }
        );
      }

      const layerName = fileName.replace(/\.(tif|tiff)$/i, '');
      const bbox = meta.bbox;
      const extent = {
        west: bbox[0],
        south: bbox[1],
        east: bbox[2],
        north: bbox[3],
      };

      detectedDatasets.push({
        index: 0,
        name: layerName,
        sourceFileName: fileName,
        format: 'geotiff',
        geometryType: `Raster (${meta.tipeRaster})`,
        featureCount: meta.width * meta.height,
        crsAsal: meta.crsAsal,
        sridAsal: meta.sridAsal,
        needsCrsSelection: false,
        attributes: ['dimensi', 'bands_count', 'min_val', 'max_val', 'nodata'],
        sampleProperties: [
          {
            dimensi: `${meta.width} x ${meta.height} px`,
            tipe: meta.tipeRaster,
            bands: meta.bandsCount,
            rentang_nilai: `${meta.minVal} s/d ${meta.maxVal}`,
            nodata: meta.noData ?? 'None',
          },
        ],
        bbox: bbox,
        extent: extent,
        rasterMeta: meta,
      });
    } else if (isZip) {
      let extracted;
      try {
        extracted = await parseShapefileZip(fileBuffer, { fallbackCrs });
      } catch (err) {
        await cleanupTempFile();
        if (err instanceof ShapefileValidationError) {
          return NextResponse.json(
            {
              status: 'error',
              code: err.code,
              message: err.message,
            },
            { status: 422 }
          );
        }
        throw err;
      }

      for (let i = 0; i < extracted.length; i++) {
        const item = extracted[i];
        const allKeys = new Set<string>();
        for (const feat of item.features) {
          if (feat.properties) {
            Object.keys(feat.properties).forEach((k) => allKeys.add(k));
          }
        }
        const sampleProps = item.features.slice(0, 3).map((f) => (f.properties as Record<string, unknown>) || {});

        // Periksa apakah atribut DBF memuat informasi kebun / afdeling / wilayah
        let dbfKebunName: string | undefined = undefined;
        let dbfAfdelingName: string | undefined = undefined;
        let dbfWilayahName: string | undefined = undefined;

        for (const feat of item.features) {
          if (!feat.properties) continue;
          for (const [k, v] of Object.entries(feat.properties)) {
            const lk = k.toLowerCase();
            const sv = typeof v === 'string' ? v.trim() : '';
            if (
              !dbfKebunName &&
              sv &&
              (lk === 'nama_kebun' || lk === 'kebun' || lk === 'kbn' || lk === 'unit_kebun' || lk === 'nama_unit')
            ) {
              dbfKebunName = sv;
            }
            if (
              !dbfAfdelingName &&
              sv &&
              (lk === 'nama_afdeling' || lk === 'afdeling' || lk === 'afd' || lk === 'nama_afd')
            ) {
              dbfAfdelingName = sv;
            }
            if (
              !dbfWilayahName &&
              sv &&
              (lk === 'wilayah' || lk === 'kabupaten' || lk === 'kota' || lk === 'lokasi')
            ) {
              dbfWilayahName = sv;
            }
          }
          if (dbfKebunName && dbfAfdelingName) break;
        }

        const folderCandidate = item.folderName || fileName;
        const suggestedKebunName = extractCleanKebunName(dbfKebunName || folderCandidate) || 'Kebun Baru';

        // Hitung titik tengah Bounding Box untuk reverse-geocoding wilayah secara akurat
        const midLng = item.bbox ? (item.bbox[0] + item.bbox[2]) / 2 : undefined;
        const midLat = item.bbox ? (item.bbox[1] + item.bbox[3]) / 2 : undefined;
        const detectedLoc = detectWilayahFromCoordsAndName(
          midLng,
          midLat,
          `${dbfWilayahName || ''} ${suggestedKebunName} ${folderCandidate}`
        );

        const suggestedWilayah = dbfWilayahName || detectedLoc.wilayah;
        const parsedWil = parseWilayahHierarchy(suggestedWilayah);
        const suggestedProvinsi = detectedLoc.provinsi || parsedWil.provinsi;
        const suggestedKabupatenKota = detectedLoc.kabupatenKota || parsedWil.kabupatenKota;

        let suggestedAfdelingName: string | undefined = dbfAfdelingName;
        if (!suggestedAfdelingName && item.folderName) {
          const afdMatch = item.folderName.match(/(?:afd|afdeling)\s*([a-z0-9_]+)/i);
          if (afdMatch) {
            suggestedAfdelingName = `Afdeling ${afdMatch[1].toUpperCase()}`;
          }
        }

        let suggestedLayerName = item.layerName;
        if (
          suggestedLayerName.toLowerCase() === 'batas_kebun' ||
          suggestedLayerName.toLowerCase() === 'kebun'
        ) {
          suggestedLayerName = `Batas ${suggestedKebunName}`;
        }

        detectedDatasets.push({
          index: i,
          name: suggestedLayerName,
          sourceFileName: item.shapefileName,
          folderName: item.folderName,
          suggestedKebunName,
          suggestedWilayah,
          suggestedProvinsi,
          suggestedKabupatenKota,
          suggestedAfdelingName,
          format: 'shapefile',
          geometryType: item.geometryType,
          featureCount: item.featureCount,
          crsAsal: item.crsAsal,
          sridAsal: item.sridAsal,
          needsCrsSelection: false,
          isPrjMissing: Boolean(item.isPrjMissing),
          attributes: Array.from(allKeys),
          sampleProperties: sampleProps,
          bbox: item.bbox || null,
          extent: item.extent || null,
        });
      }
    } else {
      // GeoJSON
      let parsed;
      try {
        parsed = parseGeoJsonBuffer(fileBuffer, fileName);
      } catch (err) {
        await cleanupTempFile();
        if (err instanceof ShapefileValidationError) {
          return NextResponse.json(
            {
              status: 'error',
              code: err.code,
              message: err.message,
            },
            { status: 422 }
          );
        }
        throw err;
      }

      const allKeys = new Set<string>();
      for (const feat of parsed.features) {
        if (feat.properties) {
          Object.keys(feat.properties).forEach((k) => allKeys.add(k));
        }
      }
      const sampleProps = parsed.features.slice(0, 3).map((f) => (f.properties as Record<string, unknown>) || {});

      detectedDatasets.push({
        index: 0,
        name: parsed.layerName,
        sourceFileName: parsed.shapefileName,
        format: 'geojson',
        geometryType: parsed.geometryType,
        featureCount: parsed.featureCount,
        crsAsal: parsed.crsAsal,
        sridAsal: parsed.sridAsal,
        needsCrsSelection: false,
        attributes: Array.from(allKeys),
        sampleProperties: sampleProps,
        bbox: parsed.bbox || null,
        extent: parsed.extent || null,
      });
    }

    // Persist temp artifact only when multipart/form-data assembled it in memory
    if (!alreadySavedTempFile) {
      await fs.writeFile(tempFilePath, fileBuffer);
    }
    await fs.writeFile(
      tempMetaPath,
      JSON.stringify({
        tempId,
        fileName,
        fileFormat: isGeoTiff ? 'geotiff' : isZip ? 'zip' : 'geojson',
        fileSizeBytes: fileBuffer.length,
        fallbackCrs,
        createdAt: Date.now(),
      })
    );

    return NextResponse.json({
      status: 'success',
      tempId,
      fileName,
      fileFormat: isGeoTiff ? 'geotiff' : isZip ? 'zip' : 'geojson',
      fileSizeBytes: fileBuffer.length,
      datasets: detectedDatasets,
    });
  } catch (err: unknown) {
    await cleanupTempFile();
    console.error('Inspect GIS Error:', err);
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memeriksa file GIS yang diunggah.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

