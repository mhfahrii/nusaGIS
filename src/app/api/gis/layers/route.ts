import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, catatAktivitas } from '@/lib/auth/guard';
import type { LayerPeta } from '@/types/gis';

interface LayerDbRow {
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
  crs_asal: string | null;
  srid_asal: number | null;
  nama_kebun: string | null;
  kode_kebun: string | null;
  wilayah: string | null;
  perusahaan: string | null;
  nama_dataset: string | null;
  dibuat_pada: string;
  min_x: number | null;
  min_y: number | null;
  max_x: number | null;
  max_y: number | null;
}

// GET /api/gis/layers - Mengambil daftar seluruh layer aktif
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const kebunIdParam = searchParams.get('kebun_id');
    const afdelingIdParam = searchParams.get('afdeling_id');
    const blokIdParam = searchParams.get('blok_id');

    const params: unknown[] = [];
    const whereClauses: string[] = [];

    if (kebunIdParam && !isNaN(Number(kebunIdParam)) && Number(kebunIdParam) > 0) {
      params.push(Number(kebunIdParam));
      whereClauses.push(`l.kebun_id = $${params.length}`);
    }

    if (afdelingIdParam && !isNaN(Number(afdelingIdParam)) && Number(afdelingIdParam) > 0) {
      params.push(Number(afdelingIdParam));
      whereClauses.push(`l.afdeling_id = $${params.length}`);
    }

    if (blokIdParam && !isNaN(Number(blokIdParam)) && Number(blokIdParam) > 0) {
      params.push(Number(blokIdParam));
      whereClauses.push(`l.blok_id = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const res = await query<LayerDbRow>(
      `
      SELECT 
        l.id,
        l.unggahan_id,
        l.kebun_id,
        l.afdeling_id,
        l.blok_id,
        l.nama_layer,
        l.nama_file_shp,
        l.tipe_geometri,
        l.warna,
        l.transparansi,
        l.terlihat,
        l.urutan,
        l.jumlah_fitur,
        COALESCE(l.crs_asal, du.crs_asal, 'GCS_WGS_1984 (EPSG:4326)') as crs_asal,
        COALESCE(l.srid_asal, du.srid_asal, 4326) as srid_asal,
        k.nama_kebun,
        k.kode_kebun,
        k.wilayah,
        k.perusahaan,
        du.nama_data as nama_dataset,
        l.dibuat_pada,
        ST_XMin(ST_Extent(f.geom))::float8 as min_x,
        ST_YMin(ST_Extent(f.geom))::float8 as min_y,
        ST_XMax(ST_Extent(f.geom))::float8 as max_x,
        ST_YMax(ST_Extent(f.geom))::float8 as max_y
      FROM public.layer_peta l
      LEFT JOIN public.kebun k ON l.kebun_id = k.id
      LEFT JOIN public.data_unggahan du ON l.unggahan_id = du.id
      LEFT JOIN public.fitur_peta f ON l.id = f.layer_id AND COALESCE(f.is_deleted, FALSE) = FALSE
      ${whereSql}
      GROUP BY l.id, k.nama_kebun, k.kode_kebun, k.wilayah, k.perusahaan, du.nama_data, du.crs_asal, du.srid_asal
      ORDER BY l.urutan ASC, l.id ASC;
    `,
      params
    );

    const layers: LayerPeta[] = res.rows.map((row) => {
      const hasExtent =
        row.min_x !== null && row.min_y !== null && row.max_x !== null && row.max_y !== null;
      return {
        id: Number(row.id),
        unggahan_id: Number(row.unggahan_id),
        kebun_id: row.kebun_id ? Number(row.kebun_id) : null,
        afdeling_id: row.afdeling_id ? Number(row.afdeling_id) : null,
        blok_id: row.blok_id ? Number(row.blok_id) : null,
        nama_layer: row.nama_layer,
        nama_file_shp: row.nama_file_shp,
        tipe_geometri: row.tipe_geometri,
        warna: row.warna,
        transparansi: Number(row.transparansi),
        terlihat: Boolean(row.terlihat),
        urutan: Number(row.urutan),
        jumlah_fitur: Number(row.jumlah_fitur),
        crs_asal: row.crs_asal,
        srid_asal: row.srid_asal ? Number(row.srid_asal) : 4326,
        nama_kebun: row.nama_kebun,
        kode_kebun: row.kode_kebun,
        wilayah: row.wilayah,
        perusahaan: row.perusahaan,
        nama_dataset: row.nama_dataset,
        dibuat_pada: row.dibuat_pada,
        bbox: hasExtent
          ? [Number(row.min_x), Number(row.min_y), Number(row.max_x), Number(row.max_y)]
          : null,
        extent: hasExtent
          ? {
              west: Number(row.min_x),
              south: Number(row.min_y),
              east: Number(row.max_x),
              north: Number(row.max_y),
            }
          : null,
      };
    });

    return NextResponse.json({
      status: 'success',
      total: layers.length,
      data: layers,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Get Layers Error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data layer.', detail: error.message },
      { status: 500 }
    );
  }
}

// PATCH /api/gis/layers - Mengubah properti layer (visibility, warna, nama, transparansi)
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.id) {
      return NextResponse.json(
        { status: 'error', message: 'Field "id" layer wajib diisi.' },
        { status: 400 }
      );
    }

    const id = parseInt(body.id, 10);
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.terlihat !== undefined) {
      updates.push(`terlihat = $${idx++}`);
      values.push(Boolean(body.terlihat));
    }
    if (body.warna !== undefined && typeof body.warna === 'string') {
      updates.push(`warna = $${idx++}`);
      values.push(body.warna.trim());
    }
    if (body.transparansi !== undefined && typeof body.transparansi === 'number') {
      updates.push(`transparansi = $${idx++}`);
      values.push(Math.max(0, Math.min(1, body.transparansi)));
    }
    if (body.nama_layer !== undefined && typeof body.nama_layer === 'string') {
      updates.push(`nama_layer = $${idx++}`);
      values.push(body.nama_layer.trim());
    }
    if (body.kebun_id !== undefined) {
      updates.push(`kebun_id = $${idx++}`);
      values.push(body.kebun_id ? Number(body.kebun_id) : null);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'Tidak ada field yang diperbarui.' },
        { status: 400 }
      );
    }

    values.push(id);
    const res = await query<LayerPeta>(
      `UPDATE layer_peta SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *;`,
      values
    );

    if (res.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Layer dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: 'success',
      message: 'Layer berhasil diperbarui.',
      data: res.rows[0],
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal memperbarui layer.', detail: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/gis/layers - Menghapus layer tunggal, unit kebun, atau seluruh data satu wilayah
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const wilayahParam = searchParams.get('wilayah');
    const kebunIdParam = searchParams.get('kebun_id');

    // 1. HAPUS SELURUH WILAYAH
    if (wilayahParam) {
      const wilayahClean = wilayahParam.trim();
      if (!wilayahClean) {
        return NextResponse.json(
          { status: 'error', message: 'Nama wilayah tidak valid.' },
          { status: 400 }
        );
      }

      // Cari seluruh kebun yang berada di wilayah ini
      const kebunRes = await query<{ id: number; nama_kebun: string }>(
        `SELECT id, nama_kebun FROM public.kebun 
         WHERE LOWER(TRIM(wilayah)) = LOWER(TRIM($1)) OR TRIM(wilayah) ILIKE $2`,
        [wilayahClean, `%${wilayahClean}%`]
      );
      const kebunIds = kebunRes.rows.map((k) => Number(k.id));

      let layerIds: number[] = [];
      if (kebunIds.length > 0) {
        const layerRes = await query<{ id: number }>(
          `SELECT id FROM public.layer_peta WHERE kebun_id = ANY($1::bigint[])`,
          [kebunIds]
        );
        layerIds = layerRes.rows.map((l) => Number(l.id));
      }

      // Hapus fitur spasial dan layer
      if (layerIds.length > 0) {
        await query(`DELETE FROM public.fitur_peta WHERE layer_id = ANY($1::bigint[])`, [layerIds]);
        await query(`DELETE FROM public.layer_peta WHERE id = ANY($1::bigint[])`, [layerIds]);
      }

      // Hapus raster layer jika ada
      if (kebunIds.length > 0) {
        await query(`DELETE FROM public.layer_raster WHERE kebun_id = ANY($1::bigint[])`, [kebunIds]);
        // Hapus kebun (CASCADE akan menghapus afdeling dan blok)
        await query(`DELETE FROM public.kebun WHERE id = ANY($1::bigint[])`, [kebunIds]);
      }

      await catatAktivitas(
        auth.user.id,
        'hapus_wilayah',
        `Menghapus seluruh data Wilayah "${wilayahClean}" (${kebunIds.length} unit kebun, ${layerIds.length} layer spasial).`
      );

      return NextResponse.json({
        status: 'success',
        message: `Seluruh data wilayah "${wilayahClean}" (${kebunIds.length} kebun, ${layerIds.length} layer) berhasil dihapus.`,
        data: {
          wilayah: wilayahClean,
          deletedKebunCount: kebunIds.length,
          deletedLayerCount: layerIds.length,
          deletedLayerIds: layerIds,
          deletedKebunIds: kebunIds,
        },
      });
    }

    // 2. HAPUS UNIT KEBUN TERTENTU
    if (kebunIdParam) {
      const kebunId = parseInt(kebunIdParam, 10);
      const kebunRes = await query<{ id: number; nama_kebun: string; wilayah: string }>(
        `SELECT id, nama_kebun, wilayah FROM public.kebun WHERE id = $1`,
        [kebunId]
      );
      if (kebunRes.rows.length === 0) {
        return NextResponse.json(
          { status: 'error', message: `Kebun dengan ID ${kebunId} tidak ditemukan.` },
          { status: 404 }
        );
      }
      const kebun = kebunRes.rows[0];

      const layerRes = await query<{ id: number }>(
        `SELECT id FROM public.layer_peta WHERE kebun_id = $1`,
        [kebunId]
      );
      const layerIds = layerRes.rows.map((l) => Number(l.id));

      if (layerIds.length > 0) {
        await query(`DELETE FROM public.fitur_peta WHERE layer_id = ANY($1::bigint[])`, [layerIds]);
        await query(`DELETE FROM public.layer_peta WHERE id = ANY($1::bigint[])`, [layerIds]);
      }
      await query(`DELETE FROM public.layer_raster WHERE kebun_id = $1`, [kebunId]);
      await query(`DELETE FROM public.kebun WHERE id = $1`, [kebunId]);

      await catatAktivitas(
        auth.user.id,
        'hapus_kebun',
        `Menghapus unit kebun "${kebun.nama_kebun}" (${kebun.wilayah}) beserta ${layerIds.length} layer spasial.`
      );

      return NextResponse.json({
        status: 'success',
        message: `Unit kebun "${kebun.nama_kebun}" dan seluruh layernya berhasil dihapus.`,
        data: {
          kebun_id: kebunId,
          deletedLayerCount: layerIds.length,
          deletedLayerIds: layerIds,
        },
      });
    }

    // 3. HAPUS 1 DATA / FILE LAYER TERTENTU (DENGAN OTOMATIS BERSIHKAN WILAYAH JIKA FILE TERAKHIR)
    if (idParam) {
      const id = parseInt(idParam, 10);
      const layerRes = await query<{
        id: number;
        nama_layer: string;
        kebun_id: number | null;
        nama_kebun: string | null;
        wilayah: string | null;
      }>(
        `SELECT l.id, l.nama_layer, l.kebun_id, k.nama_kebun, k.wilayah 
         FROM public.layer_peta l
         LEFT JOIN public.kebun k ON k.id = l.kebun_id
         WHERE l.id = $1`,
        [id]
      );

      if (layerRes.rows.length === 0) {
        return NextResponse.json(
          { status: 'error', message: `Layer dengan ID ${id} tidak ditemukan.` },
          { status: 404 }
        );
      }
      const layer = layerRes.rows[0];
      const targetKebunId = layer.kebun_id ? Number(layer.kebun_id) : null;
      const targetWilayah = (layer.wilayah || '').trim();

      // Hapus fitur terkait terlebih dahulu
      await query('DELETE FROM public.fitur_peta WHERE layer_id = $1;', [id]);
      // Hapus layer
      const res = await query('DELETE FROM public.layer_peta WHERE id = $1 RETURNING *;', [id]);

      let kebunDeleted = false;
      let wilayahDeleted = false;
      let remainingFilesInWilayah = 0;

      // Cek apakah kebun ini masih memiliki layer vektor atau raster lain
      if (targetKebunId) {
        const remainingLayersInKebun = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM public.layer_peta WHERE kebun_id = $1`,
          [targetKebunId]
        );
        const remainingRastersInKebun = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM public.layer_raster WHERE kebun_id = $1`,
          [targetKebunId]
        );

        const countVektor = parseInt(remainingLayersInKebun.rows[0]?.count || '0', 10);
        const countRaster = parseInt(remainingRastersInKebun.rows[0]?.count || '0', 10);

        if (countVektor === 0 && countRaster === 0) {
          // Seluruh file di kebun ini telah habis! Hapus kebun otomatis
          await query(`DELETE FROM public.kebun WHERE id = $1`, [targetKebunId]);
          kebunDeleted = true;

          // Cek apakah di wilayah ini masih ada kebun lain
          if (targetWilayah) {
            const remainingKebunInWilayah = await query<{ count: string }>(
              `SELECT COUNT(*)::text as count FROM public.kebun 
               WHERE LOWER(TRIM(wilayah)) = LOWER(TRIM($1)) OR TRIM(wilayah) ILIKE $2`,
              [targetWilayah, `%${targetWilayah}%`]
            );
            const kebunCount = parseInt(remainingKebunInWilayah.rows[0]?.count || '0', 10);

            if (kebunCount === 0) {
              wilayahDeleted = true;
              remainingFilesInWilayah = 0;
            }
          }
        } else {
          // Masih ada file lain di wilayah ini
          if (targetWilayah) {
            const countRes = await query<{ count: string }>(
              `SELECT COUNT(*)::text as count FROM public.layer_peta lp
               JOIN public.kebun k ON k.id = lp.kebun_id
               WHERE LOWER(TRIM(k.wilayah)) = LOWER(TRIM($1)) OR TRIM(k.wilayah) ILIKE $2`,
              [targetWilayah, `%${targetWilayah}%`]
            );
            remainingFilesInWilayah = parseInt(countRes.rows[0]?.count || '0', 10);
          }
        }
      }

      await catatAktivitas(
        auth.user.id,
        'hapus_layer',
        `Menghapus file/layer "${layer.nama_layer}" (ID: ${id}) dari wilayah "${targetWilayah || 'Umum'}".${
          wilayahDeleted
            ? ` Seluruh data wilayah "${targetWilayah}" otomatis terhapus karena filenya telah habis.`
            : ''
        }`
      );

      return NextResponse.json({
        status: 'success',
        message: wilayahDeleted
          ? `File "${layer.nama_layer}" berhasil dihapus. Wilayah "${targetWilayah}" otomatis ikut terhapus karena seluruh datanya telah bersih.`
          : `File/layer "${layer.nama_layer}" berhasil dihapus.`,
        data: {
          ...res.rows[0],
          kebunDeleted,
          deletedKebunId: targetKebunId,
          wilayahDeleted,
          wilayah: targetWilayah,
          remainingFilesInWilayah,
        },
      });
    }

    return NextResponse.json(
      {
        status: 'error',
        message:
          'Parameter "id" (hapus 1 file/layer), "wilayah" (hapus 1 wilayah), atau "kebun_id" wajib disertakan.',
      },
      { status: 400 }
    );
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal memproses penghapusan data.', detail: error.message },
      { status: 500 }
    );
  }
}

