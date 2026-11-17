import { NextRequest, NextResponse } from 'next/server';
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

interface ActivityLogRow {
  id: number;
  aktivitas: string;
  keterangan: string | null;
  dibuat_pada: string;
  nama_pengguna: string;
  role: string;
}

// 1. GET: Ambil daftar data yang dihapus (Recycle Bin) dan Riwayat Audit Aktivitas
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    // Ambil fitur yang berstatus terhapus secara logika (soft-deleted)
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
       ORDER BY fp.dihapus_pada DESC NULLS LAST, fp.id DESC
       LIMIT 100`
    );

    // Ambil log audit riwayat aktivitas sistem
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

    // Hitung ringkasan total
    const countsRes = await query<{
      total_deleted: string;
      total_active: string;
    }>(
      `SELECT 
         (SELECT COUNT(*) FROM public.fitur_peta WHERE COALESCE(is_deleted, FALSE) = TRUE) AS total_deleted,
         (SELECT COUNT(*) FROM public.fitur_peta WHERE COALESCE(is_deleted, FALSE) = FALSE) AS total_active`
    );

    const totalDeleted = parseInt(countsRes.rows[0]?.total_deleted || '0', 10);
    const totalActive = parseInt(countsRes.rows[0]?.total_active || '0', 10);

    return NextResponse.json({
      status: 'success',
      data: {
        deleted_features: deletedRes.rows,
        activity_logs: logsRes.rows,
        counts: {
          total_deleted: totalDeleted,
          total_active: totalActive,
          total_logs: logsRes.rows.length,
        },
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Gagal memuat riwayat dan data terhapus.';
    console.error('Error fetching GIS history:', err);
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
}

// 2. POST: Pulihkan (Restore) data yang sempat dihapus
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const body = await req.json();
    const { action, id, ids } = body;

    if (action === 'restore') {
      if (!id) {
        return NextResponse.json(
          { status: 'error', message: 'ID fitur yang akan dipulihkan wajib disertakan.' },
          { status: 400 }
        );
      }

      // Ambil info fitur sebelum dipulihkan
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
        feature.atribut?.KODE_BLOK ||
        `Fitur #${id}`
      );

      // Pulihkan fitur dengan audit trail pengguna
      await query(
        `UPDATE public.fitur_peta 
         SET is_deleted = FALSE, dihapus_pada = NULL, dihapus_oleh_user_id = NULL,
             diubah_pada = NOW(), diubah_oleh_user_id = $2
         WHERE id = $1`,
        [id, auth.user.id]
      );

      // Sinkronisasi jumlah fitur di layer
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

      // Catat ke audit trail
      try {
        await query(
          `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
           VALUES ($1, $2, $3)`,
          [
            auth.user.id,
            'pulihkan_fitur',
            `Memulihkan lahan "${featName}" (ID: ${id}) ke layer "${feature.nama_layer}".`,
          ]
        );
      } catch (logErr) {
        console.warn('Logging error:', logErr);
      }

      return NextResponse.json({
        status: 'success',
        message: `Lahan "${featName}" berhasil dipulihkan ke peta aktif.`,
        data: { id, layer_id: feature.layer_id, name: featName },
      });
    }

    if (action === 'restore_all') {
      const targetIds = Array.isArray(ids) && ids.length > 0 ? ids : null;

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

      // Sinkronkan seluruh layer_peta
      await query(`
        UPDATE public.layer_peta lp
        SET jumlah_fitur = (
          SELECT COUNT(*)::int 
          FROM public.fitur_peta fp 
          WHERE fp.layer_id = lp.id AND COALESCE(fp.is_deleted, FALSE) = FALSE
        )
      `);

      // Log aktivitas
      try {
        await query(
          `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
           VALUES ($1, $2, $3)`,
          [
            auth.user.id,
            'pulihkan_semua_fitur',
            `Memulihkan ${updateRes.rowCount || 0} fitur lahan yang terhapus kembali ke peta.`,
          ]
        );
      } catch (logErr) {
        console.warn('Logging error:', logErr);
      }

      return NextResponse.json({
        status: 'success',
        message: `${updateRes.rowCount || 0} lahan berhasil dipulihkan.`,
        data: { count: updateRes.rowCount || 0 },
      });
    }

    return NextResponse.json(
      { status: 'error', message: 'Aksi tidak dikenali. Gunakan action: "restore" atau "restore_all".' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Gagal memulihkan fitur.';
    console.error('Error restoring GIS feature:', err);
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
}

// 3. DELETE: Hapus Permanen (Hard Delete) dari Database
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const emptyTrashParam = searchParams.get('empty_trash');

    if (emptyTrashParam === 'true') {
      // Kosongkan seluruh tempat sampah
      const countRes = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM public.fitur_peta WHERE COALESCE(is_deleted, FALSE) = TRUE`
      );
      const totalToDelete = parseInt(countRes.rows[0]?.count || '0', 10);

      if (totalToDelete === 0) {
        return NextResponse.json({
          status: 'success',
          message: 'Tempat sampah sudah bersih, tidak ada data yang perlu dihapus.',
          data: { deletedCount: 0 },
        });
      }

      // Hard delete semua yang is_deleted = TRUE
      await query(`DELETE FROM public.fitur_peta WHERE COALESCE(is_deleted, FALSE) = TRUE`);

      // Sinkronkan kembali jumlah fitur di layer
      await query(`
        UPDATE public.layer_peta lp
        SET jumlah_fitur = (
          SELECT COUNT(*)::int 
          FROM public.fitur_peta fp 
          WHERE fp.layer_id = lp.id AND COALESCE(fp.is_deleted, FALSE) = FALSE
        )
      `);

      // Log aktivitas
      try {
        await query(
          `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
           VALUES ($1, $2, $3)`,
          [
            auth.user.id,
            'kosongkan_tempat_sampah',
            `Mengosongkan tempat sampah: ${totalToDelete} lahan dihapus secara permanen dari database.`,
          ]
        );
      } catch (logErr) {
        console.warn('Logging error:', logErr);
      }

      return NextResponse.json({
        status: 'success',
        message: `${totalToDelete} fitur lahan berhasil dihapus permanen dari database.`,
        data: { deletedCount: totalToDelete },
      });
    }

    if (!idParam) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "id" atau "empty_trash=true" wajib disertakan.' },
        { status: 400 }
      );
    }

    const id = parseInt(idParam, 10);

    // Ambil info fitur sebelum hard delete
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
      feature.atribut?.KODE_BLOK ||
      `Fitur #${id}`
    );

    // Hard delete baris di tabel fitur_peta
    await query(`DELETE FROM public.fitur_peta WHERE id = $1`, [id]);

    // Sinkronkan layer
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

    // Log aktivitas
    try {
      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'hapus_permanen_fitur',
          `Menghapus permanen lahan "${featName}" (ID: ${id}) dari database PostgreSQL PostGIS.`,
        ]
      );
    } catch (logErr) {
      console.warn('Logging error:', logErr);
    }

    return NextResponse.json({
      status: 'success',
      message: `Lahan "${featName}" berhasil dihapus secara permanen dari database.`,
      data: { id, layer_id: feature.layer_id, name: featName },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Gagal menghapus permanen fitur.';
    console.error('Error permanently deleting GIS feature:', err);
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
}

