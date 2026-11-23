import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';

interface DeletedFeatureRow {
  id: number;
  layer_id: number;
  nama_layer: string;
  nama_kebun: string;
  nama_afdeling: string;
  atribut: Record<string, unknown>;
  geometry_type: string;
  luas_ha: number | null;
  dihapus_pada: string;
  dibuat_pada: string;
}

interface DeletedLayerDbRow {
  id: number;
  unggahan_id: number | null;
  kebun_id: number | null;
  nama_layer: string;
  nama_file_shp: string | null;
  tipe_geometri: string;
  jumlah_fitur: number;
  nama_kebun: string;
  wilayah: string;
  perusahaan: string;
  lokasi_file: string | null;
  luas_ha: number | null;
  dihapus_pada: string | null;
  dibuat_pada: string;
}

interface OrphanUploadDbRow {
  id: number;
  nama_data: string;
  nama_file: string;
  lokasi_file: string | null;
  jumlah_layer: number;
  dibuat_pada: string;
}

export interface DeletedLayerItem {
  id: number;
  item_type: 'layer' | 'orphan_upload';
  unggahan_id: number | null;
  nama_layer: string;
  nama_file: string | null;
  tipe_geometri: string;
  jumlah_fitur: number;
  nama_kebun: string;
  wilayah: string;
  luas_ha: number | null;
  ukuran_bytes: number;
  dihapus_pada: string;
}

interface ActivityLogRow {
  id: number;
  aktivitas: string;
  keterangan: string | null;
  dibuat_pada: string;
  nama_pengguna: string;
  role: string;
}

function getFileSizeSafe(relOrAbsPath: string | null): number {
  if (!relOrAbsPath) return 0;
  try {
    const resolved = path.isAbsolute(relOrAbsPath)
      ? relOrAbsPath
      : path.join(process.cwd(), relOrAbsPath);
    if (existsSync(resolved)) {
      return statSync(resolved).size;
    }
  } catch {
    // Abaikan jika file sudah tidak ada
  }
  return 0;
}

async function unlinkFileSafe(relOrAbsPath: string | null): Promise<number> {
  if (!relOrAbsPath) return 0;
  try {
    const resolved = path.isAbsolute(relOrAbsPath)
      ? relOrAbsPath
      : path.join(process.cwd(), relOrAbsPath);
    if (existsSync(resolved)) {
      const size = statSync(resolved).size;
      await fs.unlink(resolved);
      return size;
    }
  } catch {
    // Abaikan error unlink
  }
  return 0;
}

async function getTempCacheStats(): Promise<{ fileCount: number; totalBytes: number }> {
  const tempDir = path.join(os.tmpdir(), 'nusagis-upload-cache');
  let fileCount = 0;
  let totalBytes = 0;
  try {
    if (existsSync(tempDir)) {
      const files = await fs.readdir(tempDir);
      for (const f of files) {
        try {
          const st = statSync(path.join(tempDir, f));
          if (st.isFile()) {
            fileCount++;
            totalBytes += st.size;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return { fileCount, totalBytes };
}

async function clearTempCacheDir(): Promise<{ deletedFiles: number; freedBytes: number }> {
  const tempDir = path.join(os.tmpdir(), 'nusagis-upload-cache');
  let deletedFiles = 0;
  let freedBytes = 0;
  try {
    if (existsSync(tempDir)) {
      const files = await fs.readdir(tempDir);
      for (const f of files) {
        const full = path.join(tempDir, f);
        try {
          const st = statSync(full);
          if (st.isFile()) {
            freedBytes += st.size;
            await fs.unlink(full);
            deletedFiles++;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return { deletedFiles, freedBytes };
}

async function ensureLayerSoftDeleteColumns() {
  await query(`
    ALTER TABLE public.layer_peta
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dihapus_pada TIMESTAMP WITHOUT TIME ZONE,
    ADD COLUMN IF NOT EXISTS dihapus_oleh_user_id BIGINT;
  `);
}

// 1. GET: Ambil daftar File/Folder Layer Terhapus, Lahan Poligon Terhapus, Info Cache, dan Riwayat Aktivitas
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    await ensureLayerSoftDeleteColumns();

    // A. Ambil layer/folder yang dihapus ke Tempat Sampah (is_deleted = TRUE)
    const deletedLayersRes = await query<DeletedLayerDbRow>(
      `SELECT 
         lp.id,
         lp.unggahan_id,
         lp.kebun_id,
         lp.nama_layer,
         lp.nama_file_shp,
         lp.tipe_geometri,
         (SELECT COUNT(*)::int FROM public.fitur_peta fp2 WHERE fp2.layer_id = lp.id) AS jumlah_fitur,
         COALESCE(k.nama_kebun, 'Tanpa Unit Kebun') AS nama_kebun,
         COALESCE(k.wilayah, 'Wilayah Umum') AS wilayah,
         COALESCE(k.perusahaan, '-') AS perusahaan,
         du.lokasi_file,
         ROUND((SELECT COALESCE(SUM(ST_Area(fp3.geom::geography)), 0) / 10000.0 FROM public.fitur_peta fp3 WHERE fp3.layer_id = lp.id)::numeric, 2)::float8 AS luas_ha,
         lp.dihapus_pada,
         lp.dibuat_pada
       FROM public.layer_peta lp
       LEFT JOIN public.kebun k ON k.id = lp.kebun_id
       LEFT JOIN public.data_unggahan du ON du.id = lp.unggahan_id
       WHERE COALESCE(lp.is_deleted, FALSE) = TRUE
       ORDER BY lp.dihapus_pada DESC NULLS LAST, lp.id DESC`
    );

    // B. Ambil berkas arsip unggahan yatim (orphaned data_unggahan yang layernya sudah dihapus sebelumnya)
    const orphanUploadsRes = await query<OrphanUploadDbRow>(
      `SELECT 
         du.id,
         du.nama_data,
         du.nama_file,
         du.lokasi_file,
         COALESCE(du.jumlah_layer, 1) AS jumlah_layer,
         du.dibuat_pada
       FROM public.data_unggahan du
       WHERE NOT EXISTS (
         SELECT 1 FROM public.layer_peta lp WHERE lp.unggahan_id = du.id
       )
       ORDER BY du.dibuat_pada DESC, du.id DESC`
    );

    const deletedLayersList: DeletedLayerItem[] = [
      ...deletedLayersRes.rows.map((row) => ({
        id: Number(row.id),
        item_type: 'layer' as const,
        unggahan_id: row.unggahan_id ? Number(row.unggahan_id) : null,
        nama_layer: row.nama_layer,
        nama_file: row.nama_file_shp || (row.lokasi_file ? path.basename(row.lokasi_file) : null),
        tipe_geometri: row.tipe_geometri,
        jumlah_fitur: Number(row.jumlah_fitur || 0),
        nama_kebun: row.nama_kebun,
        wilayah: row.wilayah,
        luas_ha: row.luas_ha,
        ukuran_bytes: getFileSizeSafe(row.lokasi_file),
        dihapus_pada: row.dihapus_pada || row.dibuat_pada,
      })),
      ...orphanUploadsRes.rows.map((row) => ({
        id: Number(row.id),
        item_type: 'orphan_upload' as const,
        unggahan_id: Number(row.id),
        nama_layer: row.nama_data || row.nama_file,
        nama_file: row.nama_file,
        tipe_geometri: 'Arsip ZIP / Cache',
        jumlah_fitur: 0,
        nama_kebun: 'Sisa Arsip Terhapus',
        wilayah: 'File Fisik Server',
        luas_ha: null,
        ukuran_bytes: getFileSizeSafe(row.lokasi_file),
        dihapus_pada: row.dibuat_pada,
      })),
    ];

    // C. Ambil poligon/fitur individual yang terhapus (hanya dari layer yang masih aktif)
    const deletedRes = await query<DeletedFeatureRow>(
      `SELECT 
         fp.id,
         fp.layer_id,
         lp.nama_layer,
         COALESCE(k.nama_kebun, 'Semua Kebun') AS nama_kebun,
         COALESCE(a.nama_afdeling, '-') AS nama_afdeling,
         fp.atribut,
         ST_GeometryType(fp.geom) AS geometry_type,
         ROUND((ST_Area(fp.geom::geography)/10000.0)::numeric, 2)::float8 AS luas_ha,
         fp.dihapus_pada,
         fp.dibuat_pada
       FROM public.fitur_peta fp
       JOIN public.layer_peta lp ON lp.id = fp.layer_id
       LEFT JOIN public.kebun k ON k.id = lp.kebun_id
       LEFT JOIN public.afdeling a ON a.id = lp.afdeling_id
       WHERE COALESCE(fp.is_deleted, FALSE) = TRUE
         AND COALESCE(lp.is_deleted, FALSE) = FALSE
       ORDER BY fp.dihapus_pada DESC NULLS LAST, fp.id DESC
       LIMIT 100`
    );

    // D. Ambil log audit riwayat aktivitas sistem
    const logsRes = await query<ActivityLogRow>(
      `SELECT 
         ra.id,
         ra.aktivitas,
         ra.keterangan,
         ra.dibuat_pada,
         COALESCE(p.nama, 'Sistem GIS') AS nama_pengguna,
         COALESCE(p.peran, 'admin') AS role
       FROM public.riwayat_aktivitas ra
       LEFT JOIN public.pengguna p ON p.id = ra.pengguna_id
       ORDER BY ra.dibuat_pada DESC
       LIMIT 100`
    );

    // E. Hitung ringkasan total & ukuran cache
    const countsRes = await query<{
      total_deleted_features: string;
      total_active_features: string;
    }>(
      `SELECT 
         (SELECT COUNT(*) FROM public.fitur_peta fp JOIN public.layer_peta lp ON lp.id = fp.layer_id WHERE COALESCE(fp.is_deleted, FALSE) = TRUE AND COALESCE(lp.is_deleted, FALSE) = FALSE) AS total_deleted_features,
         (SELECT COUNT(*) FROM public.fitur_peta fp JOIN public.layer_peta lp ON lp.id = fp.layer_id WHERE COALESCE(fp.is_deleted, FALSE) = FALSE AND COALESCE(lp.is_deleted, FALSE) = FALSE) AS total_active_features`
    );

    const totalDeletedFeatures = parseInt(countsRes.rows[0]?.total_deleted_features || '0', 10);
    const totalActive = parseInt(countsRes.rows[0]?.total_active_features || '0', 10);
    const totalDeletedLayers = deletedLayersList.length;
    const totalTrashItems = totalDeletedLayers + totalDeletedFeatures;

    const tempCache = await getTempCacheStats();
    const archiveTrashBytes = deletedLayersList.reduce((acc, item) => acc + (item.ukuran_bytes || 0), 0);

    return NextResponse.json({
      status: 'success',
      data: {
        deleted_layers: deletedLayersList,
        deleted_features: deletedRes.rows,
        activity_logs: logsRes.rows,
        counts: {
          total_deleted: totalTrashItems,
          total_deleted_layers: totalDeletedLayers,
          total_deleted_features: totalDeletedFeatures,
          total_active: totalActive,
          total_logs: logsRes.rows.length,
          cache_bytes: tempCache.totalBytes + archiveTrashBytes,
          temp_cache_files: tempCache.fileCount,
        },
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Gagal memuat riwayat dan data terhapus.';
    console.error('Error fetching GIS history:', err);
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
}

// 2. POST: Pulihkan (Restore) layer/folder atau fitur poligon yang sempat dihapus
export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { permission: 'hapus_data' });
  if (auth.response) return auth.response;

  try {
    await ensureLayerSoftDeleteColumns();
    const body = await req.json();
    const { action, id, layer_id, ids } = body;

    // A. Pulihkan 1 Layer / File utuh beserta seluruh poligonnya
    if (action === 'restore_layer') {
      const targetLayerId = Number(layer_id || id);
      if (!targetLayerId) {
        return NextResponse.json(
          { status: 'error', message: 'ID layer yang akan dipulihkan wajib disertakan.' },
          { status: 400 }
        );
      }

      const layerRes = await query<{ id: number; nama_layer: string }>(
        `SELECT id, nama_layer FROM public.layer_peta WHERE id = $1`,
        [targetLayerId]
      );
      if (layerRes.rows.length === 0) {
        return NextResponse.json(
          { status: 'error', message: 'File/layer tidak ditemukan di tempat sampah.' },
          { status: 404 }
        );
      }

      const layerName = layerRes.rows[0].nama_layer;

      await query(
        `UPDATE public.layer_peta 
         SET is_deleted = FALSE, dihapus_pada = NULL, dihapus_oleh_user_id = NULL 
         WHERE id = $1`,
        [targetLayerId]
      );

      await query(
        `UPDATE public.fitur_peta 
         SET is_deleted = FALSE, dihapus_pada = NULL, dihapus_oleh_user_id = NULL,
             diubah_pada = NOW(), diubah_oleh_user_id = $2
         WHERE layer_id = $1`,
        [targetLayerId, auth.user.id]
      );

      await query(
        `UPDATE public.layer_peta
         SET jumlah_fitur = (
           SELECT COUNT(*)::int FROM public.fitur_peta
           WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
         )
         WHERE id = $1`,
        [targetLayerId]
      );

      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'pulihkan_layer',
          `Memulihkan file/layer "${layerName}" (ID: ${targetLayerId}) beserta seluruh poligonnya kembali ke peta aktif.`,
        ]
      ).catch(() => {});

      return NextResponse.json({
        status: 'success',
        message: `File/layer "${layerName}" berhasil dipulihkan ke peta aktif.`,
        data: { layer_id: targetLayerId, name: layerName },
      });
    }

    // B. Pulihkan 1 Poligon Lahan
    if (action === 'restore') {
      if (!id) {
        return NextResponse.json(
          { status: 'error', message: 'ID fitur yang akan dipulihkan wajib disertakan.' },
          { status: 400 }
        );
      }

      const featRes = await query<{
        id: number;
        layer_id: number;
        nama_layer: string;
        atribut: Record<string, unknown>;
      }>(
        `SELECT fp.id, fp.layer_id, lp.nama_layer, fp.atribut
         FROM public.fitur_peta fp
         JOIN public.layer_peta lp ON lp.id = fp.layer_id
         WHERE fp.id = $1 AND COALESCE(fp.is_deleted, FALSE) = TRUE`,
        [id]
      );

      if (featRes.rows.length === 0) {
        return NextResponse.json(
          { status: 'error', message: 'Fitur tidak ditemukan di tempat sampah atau sudah aktif.' },
          { status: 404 }
        );
      }

      const feature = featRes.rows[0];
      const featName = String(
        feature.atribut?.Name ||
        feature.atribut?.nama_blok ||
        feature.atribut?.nama_unit ||
        feature.atribut?.KODE_BLOK ||
        `Fitur #${id}`
      );

      await query(
        `UPDATE public.layer_peta SET is_deleted = FALSE, dihapus_pada = NULL WHERE id = $1`,
        [feature.layer_id]
      );

      await query(
        `UPDATE public.fitur_peta 
         SET is_deleted = FALSE, dihapus_pada = NULL, dihapus_oleh_user_id = NULL,
             diubah_pada = NOW(), diubah_oleh_user_id = $2
         WHERE id = $1`,
        [id, auth.user.id]
      );

      await query(
        `UPDATE public.layer_peta
         SET jumlah_fitur = (
           SELECT COUNT(*)::int 
           FROM public.fitur_peta 
           WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
         )
         WHERE id = $1`,
        [feature.layer_id]
      );

      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'pulihkan_fitur',
          `Memulihkan lahan "${featName}" (ID: ${id}) ke layer "${feature.nama_layer}".`,
        ]
      ).catch(() => {});

      return NextResponse.json({
        status: 'success',
        message: `Lahan "${featName}" berhasil dipulihkan ke peta aktif.`,
        data: { id, layer_id: feature.layer_id, name: featName },
      });
    }

    // C. Pulihkan Semua Layer & Poligon di Tempat Sampah
    if (action === 'restore_all') {
      const targetIds = Array.isArray(ids) && ids.length > 0 ? ids : null;

      const restoredLayersRes = await query(
        `UPDATE public.layer_peta
         SET is_deleted = FALSE, dihapus_pada = NULL, dihapus_oleh_user_id = NULL
         WHERE COALESCE(is_deleted, FALSE) = TRUE`
      );

      let updateQuery = `
        UPDATE public.fitur_peta 
        SET is_deleted = FALSE, dihapus_pada = NULL, dihapus_oleh_user_id = NULL,
            diubah_pada = NOW(), diubah_oleh_user_id = $1
        WHERE COALESCE(is_deleted, FALSE) = TRUE
      `;
      const params: unknown[] = [auth.user.id];

      if (targetIds) {
        updateQuery += ` AND id = ANY($2::bigint[])`;
        params.push(targetIds);
      }

      const updateRes = await query(updateQuery, params);

      await query(`
        UPDATE public.layer_peta lp
        SET jumlah_fitur = (
          SELECT COUNT(*)::int 
          FROM public.fitur_peta fp 
          WHERE fp.layer_id = lp.id AND COALESCE(fp.is_deleted, FALSE) = FALSE
        )
      `);

      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'pulihkan_semua_fitur',
          `Memulihkan ${restoredLayersRes.rowCount || 0} layer dan ${updateRes.rowCount || 0} fitur lahan kembali ke peta.`,
        ]
      ).catch(() => {});

      return NextResponse.json({
        status: 'success',
        message: `${restoredLayersRes.rowCount || 0} file/layer dan ${updateRes.rowCount || 0} poligon berhasil dipulihkan.`,
        data: {
          restoredLayers: restoredLayersRes.rowCount || 0,
          count: updateRes.rowCount || 0,
        },
      });
    }

    return NextResponse.json(
      { status: 'error', message: 'Aksi tidak dikenali.' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Gagal memulihkan data.';
    console.error('Error restoring GIS item:', err);
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
}

// 3. DELETE: Hapus Permanen (Hard Delete Database + Hapus File Fisik ZIP & Bersihkan Cache)
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req, { requireJson: false, permission: 'hapus_data' });
  if (auth.response) return auth.response;

  try {
    await ensureLayerSoftDeleteColumns();
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const layerIdParam = searchParams.get('layer_id');
    const uploadIdParam = searchParams.get('upload_id');
    const emptyTrashParam = searchParams.get('empty_trash');

    // A. KOSONGKAN SELURUH TEMPAT SAMPAH & BERSIHKAN FILE FISIK / CACHE
    if (emptyTrashParam === 'true') {
      // 1) Cari semua layer yang is_deleted = TRUE
      const trashedLayersRes = await query<{ id: number; unggahan_id: number | null; kebun_id: number | null }>(
        `SELECT id, unggahan_id, kebun_id FROM public.layer_peta WHERE COALESCE(is_deleted, FALSE) = TRUE`
      );
      const trashedLayerIds = trashedLayersRes.rows.map((r) => Number(r.id));

      // 2) Hapus permanen fitur yang is_deleted = TRUE atau berada di dalam layer terhapus
      const delFeatRes = await query(
        `DELETE FROM public.fitur_peta 
         WHERE COALESCE(is_deleted, FALSE) = TRUE 
            OR layer_id IN (SELECT id FROM public.layer_peta WHERE COALESCE(is_deleted, FALSE) = TRUE)`
      );

      // 3) Hapus permanen layer yang is_deleted = TRUE
      if (trashedLayerIds.length > 0) {
        await query(`DELETE FROM public.layer_peta WHERE id = ANY($1::bigint[])`, [trashedLayerIds]);
      }

      // 4) Cari semua data_unggahan yang sudah tidak memiliki layer di layer_peta
      const orphanUploads = await query<{ id: number; lokasi_file: string | null }>(
        `SELECT du.id, du.lokasi_file
         FROM public.data_unggahan du
         WHERE NOT EXISTS (
           SELECT 1 FROM public.layer_peta lp WHERE lp.unggahan_id = du.id
         )`
      );

      let freedBytes = 0;
      for (const up of orphanUploads.rows) {
        freedBytes += await unlinkFileSafe(up.lokasi_file);
      }

      if (orphanUploads.rows.length > 0) {
        const orphanIds = orphanUploads.rows.map((u) => Number(u.id));
        await query(`DELETE FROM public.data_unggahan WHERE id = ANY($1::bigint[])`, [orphanIds]);
      }

      // 5) Bersihkan file ZIP yatim di folder uploads/gis yang tidak tercatat di data_unggahan aktif
      const activeUploads = await query<{ lokasi_file: string | null }>(
        `SELECT lokasi_file FROM public.data_unggahan WHERE lokasi_file IS NOT NULL`
      );
      const activeFileNames = new Set(
        activeUploads.rows
          .map((r) => (r.lokasi_file ? path.basename(r.lokasi_file) : ''))
          .filter(Boolean)
      );

      const uploadsDir = path.join(process.cwd(), 'uploads', 'gis');
      if (existsSync(uploadsDir)) {
        const diskFiles = await fs.readdir(uploadsDir);
        for (const df of diskFiles) {
          if (!activeFileNames.has(df)) {
            freedBytes += await unlinkFileSafe(path.join(uploadsDir, df));
          }
        }
      }

      // 6) Bersihkan seluruh temp cache di os.tmpdir()/nusagis-upload-cache
      const tempCleaned = await clearTempCacheDir();
      freedBytes += tempCleaned.freedBytes;

      // 7) Bersihkan kebun yang sudah tidak memiliki layer sama sekali
      await query(`
        DELETE FROM public.kebun k
        WHERE NOT EXISTS (SELECT 1 FROM public.layer_peta lp WHERE lp.kebun_id = k.id)
          AND NOT EXISTS (SELECT 1 FROM public.layer_raster lr WHERE lr.kebun_id = k.id)
      `);

      // 8) Sinkronkan jumlah fitur di layer aktif
      await query(`
        UPDATE public.layer_peta lp
        SET jumlah_fitur = (
          SELECT COUNT(*)::int 
          FROM public.fitur_peta fp 
          WHERE fp.layer_id = lp.id AND COALESCE(fp.is_deleted, FALSE) = FALSE
        )
      `);

      const freedMb = (freedBytes / (1024 * 1024)).toFixed(2);
      const deletedLayersCount = trashedLayerIds.length + orphanUploads.rows.length;
      const deletedFeatsCount = delFeatRes.rowCount || 0;

      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'kosongkan_tempat_sampah',
          `Mengosongkan tempat sampah & cache: ${deletedLayersCount} file/layer, ${deletedFeatsCount} poligon dihapus permanen (${freedMb} MB ruang penyimpanan dibebaskan).`,
        ]
      ).catch(() => {});

      return NextResponse.json({
        status: 'success',
        message: `Tempat sampah & cache berhasil dibersihkan permanen (${deletedLayersCount} file/layer, ${deletedFeatsCount} poligon dihapus, ${freedMb} MB ruang disk dibebaskan).`,
        data: {
          deletedLayersCount,
          deletedCount: deletedFeatsCount,
          freedBytes,
        },
      });
    }

    // B. HAPUS PERMANEN 1 LAYER / FILE DARI TEMPAT SAMPAH
    if (layerIdParam) {
      const layerId = parseInt(layerIdParam, 10);
      const layerRes = await query<{
        id: number;
        nama_layer: string;
        unggahan_id: number | null;
        kebun_id: number | null;
      }>(
        `SELECT id, nama_layer, unggahan_id, kebun_id FROM public.layer_peta WHERE id = $1`,
        [layerId]
      );

      if (layerRes.rows.length === 0) {
        return NextResponse.json({
          status: 'success',
          message: 'Layer sudah dihapus permanen.',
          data: { layer_id: layerId },
        });
      }

      const layer = layerRes.rows[0];
      await query(`DELETE FROM public.fitur_peta WHERE layer_id = $1`, [layerId]);
      await query(`DELETE FROM public.layer_peta WHERE id = $1`, [layerId]);

      let freedBytes = 0;
      if (layer.unggahan_id) {
        const remLayers = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM public.layer_peta WHERE unggahan_id = $1`,
          [layer.unggahan_id]
        );
        if (parseInt(remLayers.rows[0]?.count || '0', 10) === 0) {
          const upRes = await query<{ lokasi_file: string | null }>(
            `DELETE FROM public.data_unggahan WHERE id = $1 RETURNING lokasi_file`,
            [layer.unggahan_id]
          );
          if (upRes.rows[0]?.lokasi_file) {
            freedBytes += await unlinkFileSafe(upRes.rows[0].lokasi_file);
          }
        }
      }

      if (layer.kebun_id) {
        const remKebunLayers = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM public.layer_peta WHERE kebun_id = $1`,
          [layer.kebun_id]
        );
        const remKebunRasters = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM public.layer_raster WHERE kebun_id = $1`,
          [layer.kebun_id]
        );
        if (
          parseInt(remKebunLayers.rows[0]?.count || '0', 10) === 0 &&
          parseInt(remKebunRasters.rows[0]?.count || '0', 10) === 0
        ) {
          await query(`DELETE FROM public.kebun WHERE id = $1`, [layer.kebun_id]);
        }
      }

      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'hapus_permanen_layer',
          `Menghapus permanen file/layer "${layer.nama_layer}" (ID: ${layerId}) beserta arsip fisiknya dari server.`,
        ]
      ).catch(() => {});

      return NextResponse.json({
        status: 'success',
        message: `File/layer "${layer.nama_layer}" beserta arsip fisiknya berhasil dihapus permanen.`,
        data: { layer_id: layerId, freedBytes },
      });
    }

    // C. HAPUS PERMANEN 1 ARSIP UNGGAHAN YATIM (ORPHAN UPLOAD / CACHE)
    if (uploadIdParam) {
      const uploadId = parseInt(uploadIdParam, 10);
      const upRes = await query<{ id: number; nama_file: string; lokasi_file: string | null }>(
        `DELETE FROM public.data_unggahan WHERE id = $1 RETURNING id, nama_file, lokasi_file`,
        [uploadId]
      );

      let freedBytes = 0;
      const fileName = upRes.rows[0]?.nama_file || `Arsip #${uploadId}`;
      if (upRes.rows[0]?.lokasi_file) {
        freedBytes += await unlinkFileSafe(upRes.rows[0].lokasi_file);
      }

      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'hapus_permanen_arsip',
          `Menghapus permanen berkas arsip sisa "${fileName}" dari penyimpanan server.`,
        ]
      ).catch(() => {});

      return NextResponse.json({
        status: 'success',
        message: `Berkas arsip "${fileName}" berhasil dihapus permanen dari penyimpanan server.`,
        data: { upload_id: uploadId, freedBytes },
      });
    }

    // D. HAPUS PERMANEN 1 FITUR / POLIGON LAHAN
    if (!idParam) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "id", "layer_id", "upload_id", atau "empty_trash=true" wajib disertakan.' },
        { status: 400 }
      );
    }

    const id = parseInt(idParam, 10);

    const featRes = await query<{
      id: number;
      layer_id: number;
      nama_layer: string;
      atribut: Record<string, unknown>;
    }>(
      `SELECT fp.id, fp.layer_id, lp.nama_layer, fp.atribut
       FROM public.fitur_peta fp
       JOIN public.layer_peta lp ON lp.id = fp.layer_id
       WHERE fp.id = $1`,
      [id]
    );

    if (featRes.rows.length === 0) {
      return NextResponse.json({
        status: 'success',
        message: 'Data sudah tidak ada di database.',
        data: { id },
      });
    }

    const feature = featRes.rows[0];
    const featName = String(
      feature.atribut?.Name ||
      feature.atribut?.nama_blok ||
      feature.atribut?.nama_unit ||
      feature.atribut?.KODE_BLOK ||
      `Fitur #${id}`
    );

    await query(`DELETE FROM public.fitur_peta WHERE id = $1`, [id]);

    await query(
      `UPDATE public.layer_peta
       SET jumlah_fitur = (
         SELECT COUNT(*)::int 
         FROM public.fitur_peta 
         WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
       )
       WHERE id = $1`,
      [feature.layer_id]
    );

    await query(
      `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
       VALUES ($1, $2, $3)`,
      [
        auth.user.id,
        'hapus_permanen_fitur',
        `Menghapus permanen lahan "${featName}" (ID: ${id}) dari layer "${feature.nama_layer}".`,
      ]
    ).catch(() => {});

    return NextResponse.json({
      status: 'success',
      message: `Lahan "${featName}" telah dihapus permanen dari database.`,
      data: { id, layer_id: feature.layer_id, name: featName },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Gagal menghapus permanen data.';
    console.error('Error permanent deleting GIS item:', err);
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
}
