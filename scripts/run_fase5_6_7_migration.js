const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:1234@localhost:5432/nusaGis'
});

async function main() {
  const client = await pool.connect();
  console.log('Connected to nusaGis for Fase 5, 6, 7 Migration');

  try {
    await client.query('BEGIN');

    // 1. Create table data_makro_kebun
    console.log('1. Creating table data_makro_kebun...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.data_makro_kebun (
        id BIGSERIAL PRIMARY KEY,
        kebun_id BIGINT NOT NULL REFERENCES public.kebun(id) ON DELETE CASCADE,
        afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
        blok_id BIGINT REFERENCES public.blok(id) ON DELETE SET NULL,
        pengguna_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
        periode_bulan VARCHAR(20) NOT NULL DEFAULT '2026-11',
        curah_hujan_mm NUMERIC(8, 2) NOT NULL DEFAULT 145,
        status_hara VARCHAR(40) NOT NULL DEFAULT 'normal',
        ndvi_rata_rata NUMERIC(4, 2) NOT NULL DEFAULT 0.71,
        kelembaban_tanah NUMERIC(4, 2) NOT NULL DEFAULT 0.28,
        catatan_lab TEXT,
        dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_data_makro_kebun ON public.data_makro_kebun (kebun_id);
      CREATE INDEX IF NOT EXISTS idx_data_makro_blok ON public.data_makro_kebun (blok_id);
    `);

    // 2. Seed initial realistic macro data per kebun if empty
    const countMakro = await client.query('SELECT COUNT(*)::int AS cnt FROM public.data_makro_kebun;');
    if (countMakro.rows[0].cnt === 0) {
      console.log('2. Seeding initial macro climate & lab data for existing kebun...');
      const kebunRes = await client.query('SELECT id, nama_kebun, komoditas FROM public.kebun ORDER BY id ASC;');
      for (const k of kebunRes.rows) {
        const isGamboeng = k.nama_kebun.toLowerCase().includes('gamboeng');
        const isBakalan = k.nama_kebun.toLowerCase().includes('bakalan');
        const ch = isGamboeng ? 165 : isBakalan ? 115 : 145;
        const hara = isBakalan ? 'rendah' : 'normal';
        const ndvi = isGamboeng ? 0.76 : isBakalan ? 0.66 : 0.72;
        const sm = isGamboeng ? 0.31 : isBakalan ? 0.24 : 0.28;
        await client.query(
          `INSERT INTO public.data_makro_kebun (
             kebun_id, periode_bulan, curah_hujan_mm, status_hara, ndvi_rata_rata, kelembaban_tanah, catatan_lab
           )
           VALUES ($1, '2026-11', $2, $3, $4, $5, $6);`,
          [
            k.id,
            ch,
            hara,
            ndvi,
            sm,
            `Data pengamatan ombrometer & uji hara daun/tanah ${k.nama_kebun} periode November 2026.`,
          ]
        );
      }
    }

    // 3. Ensure sample polygons have realistic variation of 4 risk levels (Normal, Moderate, High, Critical) so user can immediately see green, yellow, orange, and dark red blocks with full diagnosis popup!
    console.log('3. Enriching sample polygon blocks with realistic agronomic risk & activity attributes...');
    const featsRes = await client.query(`
      SELECT f.id, f.atribut, l.kebun_id, k.nama_kebun, k.komoditas
      FROM public.fitur_peta f
      JOIN public.layer_peta l ON f.layer_id = l.id
      LEFT JOIN public.kebun k ON l.kebun_id = k.id
      WHERE COALESCE(f.is_deleted, FALSE) = FALSE AND l.jumlah_fitur > 1
      ORDER BY f.id ASC;
    `);

    for (let idx = 0; idx < featsRes.rows.length; idx++) {
      const f = featsRes.rows[idx];
      const attr = f.atribut || {};
      if (attr.status_risiko_manual && attr.aktivitas_terakhir) continue;

      const isTeh = (kKom => kKom.includes('teh'))(String(f.komoditas || attr.komoditas || '').toLowerCase());
      // Distribute across 4 risk tiers: ~58% Normal (green), ~17% Moderate (yellow), ~17% High (orange), ~8% Critical (dark red)
      const mod = idx % 9;
      let risiko = 'normal';
      let kondisi = 'sehat';
      let ndviVal = 0.76;
      let curahHujan = 148;
      let soilMoist = 0.30;
      let statusHara = 'normal';
      let hariSejakRawat = 5;
      let capaianPct = 96;
      let aktTerakhir = isTeh
        ? 'Petik Halus (P+1, P+2) (460 Kg Pucuk Basah, 18 HK)'
        : 'Pemupukan & Pemeliharaan Rutin (850 Kg, 14 HK)';
      let indikasiMasalah = 'Kondisi vegetasi prima, jadwal rotasi petik dan pemupukan sesuai rencana.';

      if (mod === 2) {
        // CRITICAL (Merah Pekat - seperti C02)
        risiko = 'kritis';
        kondisi = 'hama_berat';
        ndviVal = 0.51;
        curahHujan = 78;
        soilMoist = 0.19;
        statusHara = 'kritis';
        hariSejakRawat = 19;
        capaianPct = 52;
        aktTerakhir = isTeh
          ? 'Pengendalian Hama Helopeltis (Terlambat Rotasi 19 Hari)'
          : 'Inspeksi Stres Vegetasi & Defisit Air (19 Hari Lalu)';
        indikasiMasalah = 'Stres vegetasi berat, defisit air & hara N-K kritis, terlambat rotasi panen > 14 hari.';
      } else if (mod === 4 || mod === 7) {
        // HIGH RISK (Oranye - seperti B03 & A03)
        risiko = 'tinggi';
        kondisi = 'kekeringan';
        ndviVal = 0.59;
        curahHujan = 85;
        soilMoist = 0.23;
        statusHara = 'rendah';
        hariSejakRawat = 15;
        capaianPct = 64;
        aktTerakhir = isTeh
          ? 'Petik Medium (290 Kg Pucuk Basah, 14 HK - Terlambat 15 Hari)'
          : 'Kepras & Pemupukan Korektif (Terlambat 15 Hari)';
        indikasiMasalah = 'Penurunan vigor tanaman, curah hujan rendah (85 mm), status hara N-K rendah, lewat jadwal rotasi.';
      } else if (mod === 1 || mod === 5) {
        // MODERATE (Kuning)
        risiko = 'waspada';
        kondisi = 'hama_ringan';
        ndviVal = 0.68;
        curahHujan = 115;
        soilMoist = 0.26;
        statusHara = 'normal';
        hariSejakRawat = 12;
        capaianPct = 78;
        aktTerakhir = isTeh
          ? 'Penyiangan Gulma & Petik Medium (360 Kg, 15 HK)'
          : 'Klentek Daun & Pemeliharaan Saluran (12 Hari Lalu)';
        indikasiMasalah = 'Rotasi perawatan memasuki hari ke-12, indikasi gulma/hama ringan, produksi sedikit di bawah target.';
      }

      const tglLalu = new Date(Date.now() - hariSejakRawat * 86400000).toISOString().slice(0, 10);

      await client.query(
        `UPDATE public.fitur_peta
         SET atribut = atribut || jsonb_build_object(
           'status_risiko_manual', $1::text,
           'kondisi_tanaman', $2::text,
           'ndvi', $3::numeric,
           'curah_hujan_mm', $4::numeric,
           'soil_moisture', $5::numeric,
           'status_hara', $6::text,
           'hari_sejak_rawat', $7::int,
           'capaian_produksi_pct', $8::numeric,
           'aktivitas_terakhir', $9::text,
           'tanggal_aktivitas_terakhir', $10::text,
           'indikasi_masalah', $11::text
         )
         WHERE id = $12;`,
        [
          risiko,
          kondisi,
          ndviVal,
          curahHujan,
          soilMoist,
          statusHara,
          hariSejakRawat,
          capaianPct,
          aktTerakhir,
          tglLalu,
          indikasiMasalah,
          f.id,
        ]
      );
    }

    await client.query('COMMIT');
    console.log('Fase 5, 6, 7 Migration & Enrichment COMPLETED SUCCESSFULLY!');
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
