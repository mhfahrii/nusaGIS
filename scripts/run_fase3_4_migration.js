const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:1234@localhost:5432/nusaGis'
});

async function main() {
  const client = await pool.connect();
  console.log('Connected to nusaGis for Fase 3 & 4 Migration');

  try {
    await client.query('BEGIN');

    // 1. Alter catatan_aktivitas_blok for hierarchical verification (Opsi C)
    console.log('1. Adding verification workflow columns to catatan_aktivitas_blok...');
    await client.query(`
      ALTER TABLE public.catatan_aktivitas_blok
      ADD COLUMN IF NOT EXISTS status_verifikasi VARCHAR(40) NOT NULL DEFAULT 'menunggu_asisten',
      ADD COLUMN IF NOT EXISTS diverifikasi_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS disetujui_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS catatan_verifikasi TEXT;
    `);

    // 2. Create laporan_kendala_lapangan table
    console.log('2. Creating table laporan_kendala_lapangan...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.laporan_kendala_lapangan (
        id BIGSERIAL PRIMARY KEY,
        kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE CASCADE,
        afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
        blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
        fitur_id BIGINT REFERENCES public.fitur_peta(id) ON DELETE SET NULL,
        pelapor_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
        judul_kendala VARCHAR(200) NOT NULL,
        kategori_kendala VARCHAR(80) NOT NULL DEFAULT 'lainnya',
        tingkat_urgensi VARCHAR(40) NOT NULL DEFAULT 'sedang',
        deskripsi TEXT,
        koordinat_geojson JSONB,
        luas_area_ha NUMERIC(10, 2),
        status_verifikasi VARCHAR(40) NOT NULL DEFAULT 'menunggu_asisten',
        diverifikasi_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
        disetujui_oleh BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
        catatan_tindak_lanjut TEXT,
        dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_laporan_kendala_kebun ON public.laporan_kendala_lapangan (kebun_id);
      CREATE INDEX IF NOT EXISTS idx_laporan_kendala_afdeling ON public.laporan_kendala_lapangan (afdeling_id);
      CREATE INDEX IF NOT EXISTS idx_laporan_kendala_status ON public.laporan_kendala_lapangan (status_verifikasi);
    `);

    // 3. Seed Blok master rows from existing map polygons (e.g., Kebun Bakalan, Sarongge, Cibeureum, etc.) if not yet in public.blok
    console.log('3. Ensuring existing polygon blocks are synced to public.blok...');
    const layersRes = await client.query(`
      SELECT l.id AS layer_id, l.kebun_id, k.komoditas, k.nama_kebun
      FROM public.layer_peta l
      JOIN public.kebun k ON l.kebun_id = k.id
      WHERE l.jumlah_fitur > 1;
    `);

    const afdRes = await client.query(`SELECT id, kebun_id, nama_afdeling FROM public.afdeling;`);
    const afdelings = afdRes.rows;

    let syncedFromMap = 0;
    for (const lyr of layersRes.rows) {
      const feats = await client.query(
        `SELECT id, atribut FROM public.fitur_peta WHERE layer_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE;`,
        [lyr.layer_id]
      );
      const kebunAfds = afdelings.filter((a) => Number(a.kebun_id) === Number(lyr.kebun_id));

      for (const f of feats.rows) {
        const attr = f.atribut || {};
        const rawName = String(attr.Name || attr.nama_blok || attr.nama_unit || attr.block || attr.Block || '').trim();
        if (!rawName) continue;

        const rawKode = String(attr.kode_blok || attr.KODE_BLOK || attr.Kode_Kebun || `BLK-${lyr.kebun_id}-${f.id}`).trim();
        const rawAfd = String(attr.afdeling || attr.Afdeling || '').trim().toLowerCase();
        let matchedAfdId = kebunAfds[0]?.id || null;
        if (rawAfd) {
          const found = kebunAfds.find((a) => a.nama_afdeling.toLowerCase().includes(rawAfd) || rawAfd.includes(a.nama_afdeling.toLowerCase()));
          if (found) matchedAfdId = found.id;
        }

        const checkBlok = await client.query(
          `SELECT id FROM public.blok WHERE kebun_id = $1 AND (LOWER(nama_blok) = LOWER($2) OR LOWER(kode_blok) = LOWER($3)) LIMIT 1;`,
          [lyr.kebun_id, rawName, rawKode]
        );

        let blokId;
        if (checkBlok.rows.length === 0) {
          const ins = await client.query(
            `INSERT INTO public.blok (kebun_id, afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, keterangan)
             VALUES ($1, $2, $3, $4, $5, 2023, $6)
             RETURNING id;`,
            [lyr.kebun_id, matchedAfdId, rawKode, rawName, attr.komoditas || lyr.komoditas || 'Tebu', `Synced dari Fitur Peta #${f.id}`]
          );
          blokId = ins.rows[0].id;
          syncedFromMap++;
        } else {
          blokId = checkBlok.rows[0].id;
        }

        if (!attr.blok_id) {
          await client.query(
            `UPDATE public.fitur_peta SET atribut = atribut || jsonb_build_object('blok_id', $1::int) WHERE id = $2;`,
            [Number(blokId), f.id]
          );
        }
      }
    }
    console.log(`Synced ${syncedFromMap} polygon blocks to public.blok.`);

    await client.query('COMMIT');
    console.log('Fase 3 & 4 DB Migration COMPLETED SUCCESSFULLY!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
