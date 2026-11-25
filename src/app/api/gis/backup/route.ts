import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import { hasPermission } from '@/types/auth';

interface LayerBackupRow {
  id: number;
  nama_layer: string;
  nama_file_shp: string | null;
  tipe_geometri: string;
  warna: string;
  transparansi: number;
  jumlah_fitur: number;
  nama_kebun: string | null;
  nama_afdeling: string | null;
  crs_asal: string | null;
  srid_asal: number | null;
  dibuat_pada: string;
}

interface FeatureBackupRow {
  id: number;
  layer_id: number;
  nama_layer: string;
  geom_geojson: string;
  atribut: Record<string, unknown>;
  luas_ha_geodesik: number;
  dibuat_pada: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  if (!hasPermission(auth.user, 'hapus_data') && !hasPermission(auth.user, 'kelola_karyawan')) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Akses ditolak: Anda tidak memiliki izin untuk mengunduh cadangan database GIS.',
      },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const download = searchParams.get('download') === '1' || searchParams.get('download') === 'true';

    // 1. Ambil daftar layer aktif
    const layersRes = await query<LayerBackupRow>(
      `SELECT 
         lp.id,
         lp.nama_layer,
         lp.nama_file_shp,
         lp.tipe_geometri,
         lp.warna,
         lp.transparansi,
         lp.jumlah_fitur,
         k.nama_kebun,
         a.nama_afdeling,
         lp.crs_asal,
         lp.srid_asal,
         lp.dibuat_pada
       FROM public.layer_peta lp
       LEFT JOIN public.kebun k ON k.id = lp.kebun_id
       LEFT JOIN public.afdeling a ON a.id = lp.afdeling_id
       WHERE COALESCE(lp.is_deleted, FALSE) = FALSE
       ORDER BY lp.id ASC`
    );

    // 2. Ambil semua fitur aktif berserta geometri PostGIS dalam format GeoJSON
    const featuresRes = await query<FeatureBackupRow>(
      `SELECT 
         fp.id,
         fp.layer_id,
         lp.nama_layer,
         ST_AsGeoJSON(fp.geom) AS geom_geojson,
         fp.atribut,
         ROUND((ST_Area(fp.geom::geography)/10000.0)::numeric, 4)::float8 AS luas_ha_geodesik,
         fp.dibuat_pada
       FROM public.fitur_peta fp
       JOIN public.layer_peta lp ON lp.id = fp.layer_id
       WHERE COALESCE(fp.is_deleted, FALSE) = FALSE
         AND COALESCE(lp.is_deleted, FALSE) = FALSE
       ORDER BY fp.layer_id ASC, fp.id ASC`
    );

    // 3. Susun fitur menjadi GeoJSON FeatureCollection standar OGC
    const geojsonFeatures = featuresRes.rows.map((f) => {
      let parsedGeom: unknown = null;
      try {
        parsedGeom = JSON.parse(f.geom_geojson);
      } catch {
        parsedGeom = null;
      }

      return {
        type: 'Feature',
        id: f.id,
        geometry: parsedGeom,
        properties: {
          id: f.id,
          layer_id: f.layer_id,
          nama_layer: f.nama_layer,
          luas_ha_geodesik: f.luas_ha_geodesik,
          ...f.atribut,
        },
      };
    });

    const totalLuas = featuresRes.rows.reduce((acc, curr) => acc + (curr.luas_ha_geodesik || 0), 0);

    const nowIso = new Date().toISOString();
    const dateFormatted = nowIso.replace(/[:.]/g, '-').slice(0, 19);

    const backupPayload = {
      app: 'NusaGIS Monitoring Spasial Agribisnis',
      version: '2.0.0',
      export_timestamp: nowIso,
      crs: {
        type: 'name',
        properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
      },
      summary: {
        total_layers: layersRes.rows.length,
        total_active_features: featuresRes.rows.length,
        total_luas_ha: parseFloat(totalLuas.toFixed(2)),
        exported_by: auth.user.email || 'Admin',
      },
      layers: layersRes.rows,
      geojson: {
        type: 'FeatureCollection',
        features: geojsonFeatures,
      },
    };

    // Log ke riwayat aktivitas
    try {
      await query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, $2, $3)`,
        [
          auth.user.id,
          'backup_data_gis',
          `Mengunduh cadangan spasial: ${layersRes.rows.length} layer, ${featuresRes.rows.length} fitur aktif (${totalLuas.toFixed(2)} Ha).`,
        ]
      );
    } catch (logErr) {
      console.warn('Logging error:', logErr);
    }

    if (download) {
      const jsonString = JSON.stringify(backupPayload, null, 2);
      return new NextResponse(jsonString, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="nusagis-backup-${dateFormatted}.json"`,
        },
      });
    }

    return NextResponse.json({
      status: 'success',
      data: backupPayload,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Gagal menghasilkan backup data GIS.';
    console.error('Error generating GIS backup:', err);
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
}

