import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getPool } from '@/lib/db';
import { requireUser, catatAktivitas } from '@/lib/auth/guard';
import {
  parseShapefileZip,
  parseGeoJsonBuffer,
  getLayerPaletteColor,
  bundleLooseFilesToZip,
  ShapefileValidationError,
  UploadedFileItem,
  MAX_ZIP_SIZE_BYTES,
} from '@/lib/gis/shapefile';
import { parseGeoTiffMetadata } from '@/lib/gis/geotiff';
import type { DataUnggahan, LayerPeta, ExtentBox, LayerMappingInput } from '@/types/gis';

export async function POST(req: NextRequest) {
  // 1. Otorisasi Pengguna (Admin atau Pengguna aktif diizinkan mengunggah data GIS)
  const auth = await requireUser(req, { requireJson: false });
  if (auth.response) return auth.response;

  const contentType = req.headers.get('content-type') || '';

  try {
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let isZip = false;
    let isGeoTiff = false;
    let namaData = '';
    let keterangan = '';
    let mappings: LayerMappingInput[] = [];
    let singleKebunId: number | null = null;
    let fallbackCrsSingle: string | null = null;
    let tempIdToCleanup: string | null = null;

    let globalTargetKebun: {
      is_new_kebun?: boolean;
      kebun_id?: number | null;
      new_kebun_nama?: string | null;
      new_kebun_wilayah?: string | null;
      new_kebun_perusahaan?: string | null;
    } | null = null;

    if (contentType.includes('application/json')) {
      // Alur 2-Step: Konfirmasi Import dengan Data Mapping spesifik per dataset
      const body = await req.json();
      const { tempId, nama_data, keterangan: ket, mappings: mapList, target_kebun } = body;

      if (!tempId || typeof tempId !== 'string') {
        return NextResponse.json(
          { status: 'error', message: 'Token file sementara (tempId) wajib disertakan.' },
          { status: 400 }
        );
      }

      const tempDir = path.join(os.tmpdir(), 'nusagis-upload-cache');
      const tempFilePath = path.join(tempDir, `${tempId}.bin`);
      const tempMetaPath = path.join(tempDir, `${tempId}.meta.json`);

      try {
        fileBuffer = await fs.readFile(tempFilePath);
        const metaRaw = await fs.readFile(tempMetaPath, 'utf8');
        const meta = JSON.parse(metaRaw);
        fileName = meta.fileName || 'dataset.zip';
        isZip = meta.fileFormat === 'zip';
        isGeoTiff = meta.fileFormat === 'geotiff';
      } catch {
        return NextResponse.json(
          {
            status: 'error',
            message: 'Sesi file sementara telah kadaluarsa atau tidak ditemukan. Silakan unggah kembali file.',
          },
          { status: 404 }
        );
      }

      tempIdToCleanup = tempId;
      namaData = (nama_data as string | undefined)?.trim() || fileName.replace(/\.[^/.]+$/, '');
      keterangan = (ket as string | undefined)?.trim() || '';
      mappings = Array.isArray(mapList) ? mapList : [];
      if (target_kebun && typeof target_kebun === 'object') {
        globalTargetKebun = target_kebun;
      }
    } else {
      // Alur Direct Multipart Form-Data (Mendukung upload langsung file ZIP, GeoJSON, atau kumpulan file Shapefile terpisah)
      const formData = await req.formData();
      let rawFiles = formData.getAll('files') as File[];
      if (rawFiles.length === 0) {
        rawFiles = formData.getAll('file') as File[];
      }
      namaData = ((formData.get('nama_data') as string | null) || '').trim();
      keterangan = ((formData.get('keterangan') as string | null) || '').trim();
      fallbackCrsSingle = ((formData.get('fallback_crs') as string | null) || '').trim() || null;
      const kebunIdParam = ((formData.get('kebun_id') as string | null) || '').trim();
      singleKebunId = kebunIdParam ? parseInt(kebunIdParam, 10) : null;

      if (rawFiles.length === 0) {
        return NextResponse.json(
          { status: 'error', message: 'File GIS wajib diunggah.' },
          { status: 400 }
        );
      }

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
        // File Shapefile terpisah (.shp, .dbf, .shx, .prj, .cpg, .sbn, .sbx, .xml)
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
              { status: 'error', code: err.code, message: err.message },
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
            message: `Ukuran file melebihi batas maksimum (${MAX_ZIP_SIZE_BYTES / (1024 * 1024)} MB).`,
          },
          { status: 413 }
        );
      }

      if (!namaData) {
        namaData = fileName.replace(/\.[^/.]+$/, '');
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'File buffer tidak valid.' },
        { status: 400 }
      );
    }

    // Cabang Khusus: Upload Layer Raster (GeoTIFF / COG)
    if (isGeoTiff) {
      let meta;
      try {
        meta = await parseGeoTiffMetadata(fileBuffer);
      } catch (metaErr) {
        const msg = metaErr instanceof Error ? metaErr.message : String(metaErr);
        return NextResponse.json(
          { status: 'error', message: `Gagal membaca format GeoTIFF: ${msg}` },
          { status: 422 }
        );
      }

      const uploadDir = path.join(process.cwd(), 'uploads', 'rasters');
      await fs.mkdir(uploadDir, { recursive: true });
      const safeBaseName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const savedFileName = `${Date.now()}_${safeBaseName}`;
      const savedFilePath = path.join('uploads', 'rasters', savedFileName);
      const fullDiskPath = path.join(uploadDir, savedFileName);
      await fs.writeFile(fullDiskPath, fileBuffer);

      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const defaultKebunId =
          singleKebunId || (mappings.length > 0 && mappings[0].kebun_id ? Number(mappings[0].kebun_id) : null);
        const targetAfdelingId =
          mappings.length > 0 && mappings[0].afdeling_id ? Number(mappings[0].afdeling_id) : null;
        const targetBlokId =
          mappings.length > 0 && mappings[0].blok_id ? Number(mappings[0].blok_id) : null;
        const finalLayerName =
          (mappings.length > 0 && mappings[0].nama_layer?.trim()) || fileName.replace(/\.[^/.]+$/, '');

        const insertUnggahanRes = await client.query<DataUnggahan>(
          `INSERT INTO public.data_unggahan (
            pengguna_id, kebun_id, nama_data, nama_file, format_file,
            lokasi_file, crs_asal, srid_asal, status, jumlah_layer
          ) VALUES ($1, $2, $3, $4, 'GeoTIFF', $5, $6, $7, 'berhasil', 1)
          RETURNING *;`,
          [
            auth.user.id,
            defaultKebunId,
            namaData.slice(0, 150),
            fileName.slice(0, 255),
            savedFilePath,
            meta.crsAsal.slice(0, 100),
            meta.sridAsal,
          ]
        );
        const unggahan = insertUnggahanRes.rows[0];

        const [minX, minY, maxX, maxY] = meta.bbox;

        const insertRasterRes = await client.query(
          `INSERT INTO public.layer_raster (
            unggahan_id, kebun_id, afdeling_id, blok_id, nama_layer,
            nama_file, lokasi_file, tipe_raster, min_val, max_val, nodata,
            bands_count, width, height, crs_asal, srid_asal, bbox_wgs84, urutan
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
            ST_MakeEnvelope($17, $18, $19, $20, 4326), 1
          ) RETURNING *;`,
          [
            unggahan.id,
            defaultKebunId,
            targetAfdelingId,
            targetBlokId,
            finalLayerName,
            savedFileName,
            savedFilePath,
            meta.tipeRaster,
            meta.minVal,
            meta.maxVal,
            meta.noData,
            meta.bandsCount,
            meta.width,
            meta.height,
            meta.crsAsal,
            meta.sridAsal,
            minX,
            minY,
            maxX,
            maxY,
          ]
        );
        const createdRaster = insertRasterRes.rows[0];

        await client.query('COMMIT');

        if (tempIdToCleanup) {
          const tempDir = path.join(os.tmpdir(), 'nusagis-upload-cache');
          await fs.unlink(path.join(tempDir, `${tempIdToCleanup}.bin`)).catch(() => {});
          await fs.unlink(path.join(tempDir, `${tempIdToCleanup}.meta.json`)).catch(() => {});
        }

        await catatAktivitas(
          auth.user.id,
          'upload_gis_data',
          `Mengunggah layer raster GeoTIFF (${fileName}) ke database.`
        );

        return NextResponse.json(
          {
            status: 'success',
            message: `Berhasil mengimpor layer raster GeoTIFF "${finalLayerName}".`,
            data: {
              unggahan_id: Number(unggahan.id),
              nama_data: namaData,
              is_raster: true,
              raster: createdRaster,
              overall_bbox: meta.bbox,
              overall_extent: {
                west: minX,
                south: minY,
                east: maxX,
                north: maxY,
              },
            },
          },
          { status: 201 }
        );
      } catch (txErr) {
        await client.query('ROLLBACK');
        await fs.unlink(fullDiskPath).catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }
    }

    // 2. Ekstrak dan parse dataset (Vektor: Shapefile / GeoJSON)
    let extractedDatasets;
    try {
      if (isZip) {
        extractedDatasets = await parseShapefileZip(fileBuffer, {
          fallbackCrs: fallbackCrsSingle || mappings[0]?.fallback_crs || null,
        });
      } else {
        const parsedGeoJson = parseGeoJsonBuffer(fileBuffer, fileName);
        extractedDatasets = [parsedGeoJson];
      }
    } catch (parseErr: unknown) {
      if (parseErr instanceof ShapefileValidationError) {
        return NextResponse.json(
          {
            status: 'error',
            code: parseErr.code,
            message: parseErr.message,
          },
          { status: 422 }
        );
      }
      const err = parseErr as Error;
      return NextResponse.json(
        {
          status: 'error',
          message: 'Gagal memproses geometri spasial file.',
          detail: err.message,
        },
        { status: 422 }
      );
    }

    if (extractedDatasets.length === 0) {
      return NextResponse.json(
        {
          status: 'error',
          message: 'Tidak ditemukan dataset spasial valid pada file yang diunggah.',
        },
        { status: 422 }
      );
    }

    // 3. Simpan file asli ke direktori penyimpanan permanen server (uploads/gis)
    const uploadDir = path.join(process.cwd(), 'uploads', 'gis');
    await fs.mkdir(uploadDir, { recursive: true });
    const safeBaseName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const savedFileName = `${Date.now()}_${safeBaseName}`;
    const savedFilePath = path.join('uploads', 'gis', savedFileName);
    const fullDiskPath = path.join(uploadDir, savedFileName);
    await fs.writeFile(fullDiskPath, fileBuffer);

    // 4. Jalankan seluruh penyimpanan dalam SATU TRANSAKSI POSTGRESQL ATOMIK
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Tentukan default kebun_id jika ada
      let defaultKebunId: number | null = singleKebunId;
      if (!defaultKebunId && mappings.length > 0 && mappings[0].kebun_id) {
        defaultKebunId = Number(mappings[0].kebun_id);
      }

      // Validasi keberadaan kebun jika disertakan
      if (defaultKebunId) {
        const kebunCheck = await client.query('SELECT id FROM public.kebun WHERE id = $1;', [
          defaultKebunId,
        ]);
        if (kebunCheck.rowCount === 0) {
          throw new Error(`Kebun dengan ID ${defaultKebunId} tidak ditemukan di database.`);
        }
      }

      const uniqueCrsList = Array.from(new Set(extractedDatasets.map((s) => s.crsAsal))).join('; ');
      const primarySrid = extractedDatasets[0]?.sridAsal ?? 4326;

      // Simpan record data_unggahan
      const insertUnggahanRes = await client.query<DataUnggahan>(
        `INSERT INTO public.data_unggahan (
          pengguna_id, kebun_id, nama_data, nama_file, format_file,
          lokasi_file, crs_asal, srid_asal, status, jumlah_layer
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'berhasil', $9)
        RETURNING *;`,
        [
          auth.user.id,
          defaultKebunId,
          namaData.slice(0, 150),
          fileName.slice(0, 255),
          isZip ? 'ZIP' : 'GeoJSON',
          savedFilePath,
          uniqueCrsList.slice(0, 100),
          primarySrid,
          extractedDatasets.length,
        ]
      );
      const unggahan = insertUnggahanRes.rows[0];

      // Ambil urutan terakhir di layer_peta
      const maxOrderRes = await client.query<{ max_urutan: number }>(
        'SELECT COALESCE(MAX(urutan), 0)::int AS max_urutan FROM public.layer_peta;'
      );
      const startOrder = (maxOrderRes.rows[0]?.max_urutan || 0) + 1;

      const createdLayers: LayerPeta[] = [];
      let overallBbox: [number, number, number, number] | null = null;

      for (let i = 0; i < extractedDatasets.length; i++) {
        const ds = extractedDatasets[i];
        const mapping = mappings.find((m) => m.datasetIndex === i) || mappings[i];

        // Jika layer sengaja tidak dicentang (uncheck), lewati impor layer ini
        if (mapping && mapping.selected === false) {
          continue;
        }

        // Tentukan metadata layer berdasarkan mapping pengguna & target kebun global
        const effectiveIsNewKebun = mapping?.is_new_kebun ?? globalTargetKebun?.is_new_kebun ?? false;
        const effectiveNewKebunNama = mapping?.new_kebun_nama ?? globalTargetKebun?.new_kebun_nama;
        const effectiveNewKebunWilayah = mapping?.new_kebun_wilayah ?? globalTargetKebun?.new_kebun_wilayah;
        const effectiveNewKebunPerusahaan = mapping?.new_kebun_perusahaan ?? globalTargetKebun?.new_kebun_perusahaan;
        let targetKebunId = mapping?.kebun_id ? Number(mapping.kebun_id) : (globalTargetKebun?.kebun_id ? Number(globalTargetKebun.kebun_id) : defaultKebunId);

        if ((!targetKebunId || effectiveIsNewKebun) && effectiveNewKebunNama?.trim()) {
          const kNama = effectiveNewKebunNama.trim();
          const kWil = effectiveNewKebunWilayah?.trim() || 'Wilayah Belum Ditentukan';
          const kPer = effectiveNewKebunPerusahaan?.trim() || 'PT Perkebunan Nusantara I (Regional 4)';
          const kKode = `KBN-${kNama.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'NEW'}-${Date.now().toString().slice(-4)}`;

          const existingK = await client.query('SELECT id FROM public.kebun WHERE LOWER(nama_kebun) = LOWER($1);', [kNama]);
          if (existingK.rowCount && existingK.rowCount > 0) {
            targetKebunId = Number(existingK.rows[0].id);
          } else {
            const insK = await client.query(
              `INSERT INTO public.kebun (kode_kebun, nama_kebun, wilayah, perusahaan)
               VALUES ($1, $2, $3, $4) RETURNING id;`,
              [kKode, kNama, kWil, kPer]
            );
            targetKebunId = Number(insK.rows[0].id);
          }
        }

        let targetAfdelingId = mapping?.afdeling_id ? Number(mapping.afdeling_id) : null;
        if ((!targetAfdelingId || mapping?.new_afdeling_nama) && mapping?.new_afdeling_nama?.trim() && targetKebunId) {
          const aNama = mapping.new_afdeling_nama.trim();
          const aKode = `AFD-${aNama.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'NEW'}-${Date.now().toString().slice(-4)}`;
          const existingA = await client.query(
            'SELECT id FROM public.afdeling WHERE kebun_id = $1 AND LOWER(nama_afdeling) = LOWER($2);',
            [targetKebunId, aNama]
          );
          if (existingA.rowCount && existingA.rowCount > 0) {
            targetAfdelingId = Number(existingA.rows[0].id);
          } else {
            const insA = await client.query(
              `INSERT INTO public.afdeling (kebun_id, kode_afdeling, nama_afdeling)
               VALUES ($1, $2, $3) RETURNING id;`,
              [targetKebunId, aKode, aNama]
            );
            targetAfdelingId = Number(insA.rows[0].id);
          }
        }

        const targetBlokId = mapping?.blok_id ? Number(mapping.blok_id) : null;
        const finalLayerName =
          mapping?.nama_layer?.trim() || ds.layerName || `Layer ${startOrder + i}`;
        const color = getLayerPaletteColor(startOrder + i);

        // Validasi Foreign Keys jika ditentukan
        if (targetKebunId) {
          const kCheck = await client.query('SELECT id FROM public.kebun WHERE id = $1;', [
            targetKebunId,
          ]);
          if (kCheck.rowCount === 0) {
            throw new Error(`Kebun ID ${targetKebunId} pada layer "${finalLayerName}" tidak valid.`);
          }
        }
        if (targetAfdelingId) {
          const aCheck = await client.query('SELECT id FROM public.afdeling WHERE id = $1;', [
            targetAfdelingId,
          ]);
          if (aCheck.rowCount === 0) {
            throw new Error(
              `Afdeling ID ${targetAfdelingId} pada layer "${finalLayerName}" tidak valid.`
            );
          }
        }
        if (targetBlokId) {
          const bCheck = await client.query('SELECT id FROM public.blok WHERE id = $1;', [
            targetBlokId,
          ]);
          if (bCheck.rowCount === 0) {
            throw new Error(`Blok ID ${targetBlokId} pada layer "${finalLayerName}" tidak valid.`);
          }
        }

        // Deteksi SRID Asal (dari file .prj atau fallback mapping pilihan user)
        const mappingCrsSrid = mapping?.fallback_crs
          ? parseInt(mapping.fallback_crs.replace(/[^0-9]/g, ''), 10)
          : null;
        const effectiveSourceSrid = (ds.isPrjMissing && mappingCrsSrid) ? mappingCrsSrid : (ds.sridAsal || mappingCrsSrid);
        const crsAsalName = (ds.isPrjMissing && mapping?.fallback_crs) ? mapping.fallback_crs : (ds.crsAsal || mapping?.fallback_crs || 'WGS 84 (EPSG:4326)');
        
        // Simpan layer_peta
        const insertLayerRes = await client.query<LayerPeta>(
          `INSERT INTO public.layer_peta (
            unggahan_id, kebun_id, afdeling_id, blok_id, nama_layer, nama_file_shp,
            tipe_geometri, warna, transparansi, terlihat, urutan,
            jumlah_fitur, crs_asal, srid_asal
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.35, TRUE, $9, $10, $11, $12)
          RETURNING *;`,
          [
            unggahan.id,
            targetKebunId,
            targetAfdelingId,
            targetBlokId,
            finalLayerName.slice(0, 150),
            ds.shapefileName.slice(0, 255),
            ds.geometryType,
            color,
            startOrder + i,
            ds.featureCount,
            crsAsalName.slice(0, 100),
            effectiveSourceSrid || ds.sridAsal,
          ]
        );
        const layer = insertLayerRes.rows[0];

        // Standar ArcGIS Enterprise Ingest:
        // Jika data dari proyeksi UTM/lainnya (SRID != 4326), transformasikan secara akurat menggunakan ST_Transform ke EPSG:4326.
        // Jika SRID tidak diketahui, deteksi secara cerdas apakah koordinat sudah derajat atau meter.
        for (const feat of ds.features) {
          if (!feat.geometry) continue;
          const geomGeoJson = JSON.stringify(feat.geometry);
          const propertiesJson = JSON.stringify(feat.properties || {});

          // Periksa koordinat spasial:
          // Jika koordinat GeoJSON dari shpjs sudah berupa derajat WGS 84 (-180..180 dan -90..90), JANGAN lakukan ST_Transform ulang!
          // Hanya lakukan ST_Transform jika koordinat masih murni berupa meter (di luar rentang derajat).
          await client.query(
            `INSERT INTO public.fitur_peta (layer_id, geom, atribut, dibuat_oleh_user_id)
             VALUES (
               $1,
               ST_Force2D(
                 CASE
                   WHEN ST_XMin(ST_GeomFromGeoJSON($2)) < -180 OR ST_XMax(ST_GeomFromGeoJSON($2)) > 180
                     OR ST_YMin(ST_GeomFromGeoJSON($2)) < -90 OR ST_YMax(ST_GeomFromGeoJSON($2)) > 90
                   THEN ST_Transform(ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), COALESCE($3, 32749)), 4326)
                   ELSE ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326)
                 END
               ),
               $4::jsonb,
               $5
             );`,
            [layer.id, geomGeoJson, effectiveSourceSrid, propertiesJson, auth.user.id]
          );
        }

        // Ambil extent dan jumlah fitur aktual dari PostGIS
        const extentRes = await client.query<{
          actual_count: number;
          west: number | null;
          south: number | null;
          east: number | null;
          north: number | null;
        }>(
          `SELECT
            COUNT(*)::int AS actual_count,
            ST_XMin(ST_Extent(geom))::float8 AS west,
            ST_YMin(ST_Extent(geom))::float8 AS south,
            ST_XMax(ST_Extent(geom))::float8 AS east,
            ST_YMax(ST_Extent(geom))::float8 AS north
           FROM public.fitur_peta
           WHERE layer_id = $1 AND geom IS NOT NULL AND NOT ST_IsEmpty(geom);`,
          [layer.id]
        );

        const ext = extentRes.rows[0];
        if (
          !ext ||
          ext.actual_count === 0 ||
          ext.west === null ||
          ext.south === null ||
          ext.east === null ||
          ext.north === null
        ) {
          throw new Error(
            `Geometri pada layer "${finalLayerName}" kosong atau tidak valid setelah diproses PostGIS.`
          );
        }

        if (ext.actual_count !== Number(layer.jumlah_fitur)) {
          await client.query('UPDATE public.layer_peta SET jumlah_fitur = $1 WHERE id = $2;', [
            ext.actual_count,
            layer.id,
          ]);
        }

        const bbox: [number, number, number, number] = [
          ext.west,
          ext.south,
          ext.east,
          ext.north,
        ];
        const extentObj: ExtentBox = {
          west: ext.west,
          south: ext.south,
          east: ext.east,
          north: ext.north,
        };

        // Ambil info kebun (nama, wilayah, perusahaan) jika ada
        let namaKebun: string | null = null;
        let wilayahKebun: string | null = null;
        let perusahaanKebun: string | null = null;
        if (targetKebunId) {
          const kNameRes = await client.query<{ nama_kebun: string; wilayah: string; perusahaan: string }>(
            'SELECT nama_kebun, wilayah, perusahaan FROM public.kebun WHERE id = $1;',
            [targetKebunId]
          );
          namaKebun = kNameRes.rows[0]?.nama_kebun || null;
          wilayahKebun = kNameRes.rows[0]?.wilayah || null;
          perusahaanKebun = kNameRes.rows[0]?.perusahaan || null;
        }

        createdLayers.push({
          ...layer,
          id: Number(layer.id),
          unggahan_id: Number(layer.unggahan_id),
          kebun_id: targetKebunId,
          afdeling_id: targetAfdelingId,
          blok_id: targetBlokId,
          transparansi: Number(layer.transparansi),
          urutan: Number(layer.urutan),
          jumlah_fitur: ext.actual_count,
          nama_kebun: namaKebun,
          wilayah: wilayahKebun,
          perusahaan: perusahaanKebun,
          nama_dataset: namaData,
          bbox,
          extent: extentObj,
        });

        if (!overallBbox) {
          overallBbox = [...bbox];
        } else {
          overallBbox[0] = Math.min(overallBbox[0], bbox[0]);
          overallBbox[1] = Math.min(overallBbox[1], bbox[1]);
          overallBbox[2] = Math.max(overallBbox[2], bbox[2]);
          overallBbox[3] = Math.max(overallBbox[3], bbox[3]);
        }
      }

      if (createdLayers.length === 0) {
        throw new Error('Tidak ada layer yang dipilih untuk diimpor. Harap centang minimal satu layer.');
      }

      await client.query('COMMIT');

      // Bersihkan file cache sementara jika menggunakan 2-step flow
      if (tempIdToCleanup) {
        const tempDir = path.join(os.tmpdir(), 'nusagis-upload-cache');
        await fs.unlink(path.join(tempDir, `${tempIdToCleanup}.bin`)).catch(() => {});
        await fs.unlink(path.join(tempDir, `${tempIdToCleanup}.meta.json`)).catch(() => {});
      }

      const overallExtent: ExtentBox | null = overallBbox
        ? {
            west: overallBbox[0],
            south: overallBbox[1],
            east: overallBbox[2],
            north: overallBbox[3],
          }
        : null;

      await catatAktivitas(
        auth.user.id,
        'upload_gis_data',
        `Mengimpor ${createdLayers.length} layer GIS (${fileName}) ke database.${keterangan ? ` Keterangan: ${keterangan}` : ''}`
      );

      return NextResponse.json(
        {
          status: 'success',
          message: `Berhasil mengimpor ${createdLayers.length} layer spasial ke PostGIS.`,
          data: {
            unggahan_id: Number(unggahan.id),
            nama_data: namaData,
            crs_asal: uniqueCrsList,
            srid_asal: primarySrid,
            jumlah_layer: createdLayers.length,
            layers: createdLayers,
            overall_bbox: overallBbox,
            overall_extent: overallExtent,
          },
        },
        { status: 201 }
      );
    } catch (txErr: unknown) {
      await client.query('ROLLBACK');
      await fs.unlink(fullDiskPath).catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Upload GIS Error:', error);
    return NextResponse.json(
      {
        status: 'error',
        message: error.message || 'Terjadi kesalahan saat memproses dan menyimpan data GIS.',
        detail: error.message,
      },
      { status: 500 }
    );
  }
}
