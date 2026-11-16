import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { requireUser } from '@/lib/auth/guard';
import {
  parseShapefileZip,
  parseGeoJsonBuffer,
  bundleLooseFilesToZip,
  ShapefileValidationError,
  UploadedFileItem,
  MAX_ZIP_SIZE_BYTES,
} from '@/lib/gis/shapefile';
import { parseGeoTiffMetadata } from '@/lib/gis/geotiff';
import type { DetectedDataset } from '@/types/gis';

export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { requireJson: false });
  if (auth.response) return auth.response;

  try {
    const formData = await req.formData();
    let rawFiles = formData.getAll('files') as File[];
    if (rawFiles.length === 0) {
      rawFiles = formData.getAll('file') as File[];
    }
    const fallbackCrs = (formData.get('fallback_crs') as string | null)?.trim() || null;

    if (rawFiles.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'File GIS wajib diunggah untuk pemeriksaan.' },
        { status: 400 }
      );
    }

    let fileBuffer: Buffer;
    let fileName = '';
    let isZip = false;
    let isGeoTiff = false;

    if (
      rawFiles.length === 1 &&
      (rawFiles[0].name.toLowerCase().endsWith('.tif') ||
        rawFiles[0].name.toLowerCase().endsWith('.tiff'))
    ) {
      const f = rawFiles[0];
      fileName = f.name;
      fileBuffer = Buffer.from(await f.arrayBuffer());
      isGeoTiff = true;
    } else if (
      rawFiles.length === 1 &&
      (rawFiles[0].name.toLowerCase().endsWith('.geojson') ||
        rawFiles[0].name.toLowerCase().endsWith('.json'))
    ) {
      const f = rawFiles[0];
      fileName = f.name;
      fileBuffer = Buffer.from(await f.arrayBuffer());
    } else if (rawFiles.length === 1 && rawFiles[0].name.toLowerCase().endsWith('.zip')) {
      const f = rawFiles[0];
      fileName = f.name;
      fileBuffer = Buffer.from(await f.arrayBuffer());
      isZip = true;
    } else {
      // Kumpulan file terpisah (.shp, .dbf, .shx, .prj, .cpg, .sbn, .sbx, .xml)
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

    const detectedDatasets: DetectedDataset[] = [];
    const tempId = crypto.randomBytes(16).toString('hex');
    const tempDir = path.join(os.tmpdir(), 'nusagis-upload-cache');
    await fs.mkdir(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, `${tempId}.bin`);
    const tempMetaPath = path.join(tempDir, `${tempId}.meta.json`);

    if (isGeoTiff) {
      // GeoTIFF Raster
      let meta;
      try {
        meta = await parseGeoTiffMetadata(fileBuffer);
      } catch (err) {
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

        detectedDatasets.push({
          index: i,
          name: item.layerName,
          sourceFileName: item.shapefileName,
          format: 'shapefile',
          geometryType: item.geometryType,
          featureCount: item.featureCount,
          crsAsal: item.crsAsal,
          sridAsal: item.sridAsal,
          needsCrsSelection: !item.crsAsal || item.crsAsal === '',
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

    // Simpan buffer dan metadata sementara untuk konfirmasi di Step 2
    await fs.writeFile(tempFilePath, fileBuffer);
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
    const error = err as Error;
    console.error('Inspect GIS Error:', error);
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memeriksa file GIS yang diunggah.',
        detail: error.message,
      },
      { status: 500 }
    );
  }
}

