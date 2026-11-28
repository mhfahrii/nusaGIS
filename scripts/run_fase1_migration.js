const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: 'postgresql://postgres:1234@localhost:5432/nusaGis'
});

async function main() {
  const client = await pool.connect();
  console.log('Connected to nusaGis database');

  try {
    await client.query('BEGIN');

    // 1. Alter table pengguna to add afdeling_id and kebun_id and update check constraint
    console.log('1. Migrating table pengguna...');
    await client.query(`
      ALTER TABLE public.pengguna 
      ADD COLUMN IF NOT EXISTS afdeling_id BIGINT REFERENCES public.afdeling(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS kebun_id BIGINT REFERENCES public.kebun(id) ON DELETE SET NULL;
    `);

    try {
      await client.query(`ALTER TABLE public.pengguna DROP CONSTRAINT IF EXISTS pengguna_peran_check;`);
      await client.query(`ALTER TABLE public.pengguna ADD CONSTRAINT pengguna_peran_check CHECK (peran IN ('admin', 'pengguna', 'mandor', 'asisten', 'kepala_kebun', 'pimpinan'));`);
    } catch (e) {
      console.log('Notice on peran check constraint:', e.message);
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pengguna_afdeling ON public.pengguna (afdeling_id);
      CREATE INDEX IF NOT EXISTS idx_pengguna_kebun ON public.pengguna (kebun_id);
    `);

    // 2. Create master_aktivitas
    console.log('2. Creating table master_aktivitas...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.master_aktivitas (
        id BIGSERIAL PRIMARY KEY,
        kode_aktivitas VARCHAR(50) NOT NULL UNIQUE,
        nama_aktivitas VARCHAR(150) NOT NULL,
        komoditas VARCHAR(50) NOT NULL DEFAULT 'Umum',
        kategori VARCHAR(50) NOT NULL DEFAULT 'pemeliharaan',
        satuan_hasil VARCHAR(50) NOT NULL DEFAULT 'Kg',
        deskripsi TEXT,
        is_aktif BOOLEAN NOT NULL DEFAULT TRUE,
        dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_master_aktivitas_komoditas ON public.master_aktivitas (komoditas);
      CREATE INDEX IF NOT EXISTS idx_master_aktivitas_kategori ON public.master_aktivitas (kategori);
    `);

    // 3. Create catatan_aktivitas_blok
    console.log('3. Creating table catatan_aktivitas_blok...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.catatan_aktivitas_blok (
        id BIGSERIAL PRIMARY KEY,
        blok_id BIGINT NOT NULL REFERENCES public.blok(id) ON DELETE CASCADE,
        aktivitas_id BIGINT NOT NULL REFERENCES public.master_aktivitas(id) ON DELETE RESTRICT,
        pengguna_id BIGINT REFERENCES public.pengguna(id) ON DELETE SET NULL,
        tanggal_aktivitas DATE NOT NULL DEFAULT CURRENT_DATE,
        volume_hasil NUMERIC(12, 2) DEFAULT 0,
        satuan VARCHAR(50) DEFAULT 'Kg',
        tenaga_kerja_hk INTEGER DEFAULT 0,
        pusingan_petik INTEGER,
        persen_peko NUMERIC(5, 2),
        kondisi_tanaman VARCHAR(50) DEFAULT 'sehat',
        status_risiko_manual VARCHAR(30) DEFAULT 'normal',
        catatan TEXT,
        dibuat_pada TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_catatan_aktivitas_blok ON public.catatan_aktivitas_blok (blok_id);
      CREATE INDEX IF NOT EXISTS idx_catatan_aktivitas_tgl ON public.catatan_aktivitas_blok (tanggal_aktivitas DESC);
      CREATE INDEX IF NOT EXISTS idx_catatan_aktivitas_akt ON public.catatan_aktivitas_blok (aktivitas_id);
    `);

    // 4. Seed initial master_aktivitas
    console.log('4. Seeding master_aktivitas...');
    const seedAktivitas = [
      // Teh (PPTK Gamboeng)
      { kode: 'TEH-PTK-01', nama: 'Petik Halus (P+1, P+2)', komoditas: 'Teh', kategori: 'panen', satuan: 'Kg Pucuk Basah', desc: 'Pemetikan pucuk halus mutu ekspor' },
      { kode: 'TEH-PTK-02', nama: 'Petik Medium', komoditas: 'Teh', kategori: 'panen', satuan: 'Kg Pucuk Basah', desc: 'Pemetikan standar mutu pasar domestik' },
      { kode: 'TEH-PTK-03', nama: 'Petik Kasar / Jendolan', komoditas: 'Teh', kategori: 'panen', satuan: 'Kg Pucuk Basah', desc: 'Pemetikan pasca pangkas atau penyeragaman bidang petik' },
      { kode: 'TEH-PNG-01', nama: 'Pangkas Ringan / Ajir', komoditas: 'Teh', kategori: 'pangkas', satuan: 'Hektar', desc: 'Pemotongan ranting setinggi bidang ajir petik' },
      { kode: 'TEH-PNG-02', nama: 'Pangkas Dalam / Bersih', komoditas: 'Teh', kategori: 'pangkas', satuan: 'Hektar', desc: 'Pemangkasan siklus 3-4 tahunan peremajaan bidang petik' },
      { kode: 'TEH-PUP-01', nama: 'Pemupukan NPK / Urea', komoditas: 'Teh', kategori: 'pemupukan', satuan: 'Kg Pupuk', desc: 'Aplikasi pupuk anorganik penunjang pertumbuhan pucuk peko' },
      { kode: 'TEH-RAW-01', nama: 'Penyiangan Gulma (Weeding Manual)', komoditas: 'Teh', kategori: 'pemeliharaan', satuan: 'Hektar', desc: 'Pembersihan gulma liar sekitar pokok teh' },
      { kode: 'TEH-RAW-02', nama: 'Pembumbunan & Dongkel Rumput', komoditas: 'Teh', kategori: 'pemeliharaan', satuan: 'Hektar', desc: 'Penggemburan tanah dan perapihan piringan tanaman' },
      { kode: 'TEH-HAM-01', nama: 'Pengendalian Hama Helopeltis', komoditas: 'Teh', kategori: 'hama_penyakit', satuan: 'Hektar', desc: 'Penyemprotan insektisida penanggulangan pengisap pucuk' },
      { kode: 'TEH-HAM-02', nama: 'Pengendalian Cacar Daun (Exobasidium)', komoditas: 'Teh', kategori: 'hama_penyakit', satuan: 'Hektar', desc: 'Aplikasi fungisida penanggulangan jamur cacar daun' },
      { kode: 'TEH-NAU-01', nama: 'Pemangkasan Pohon Naungan', komoditas: 'Teh', kategori: 'pemeliharaan', satuan: 'Batang', desc: 'Penjarangan naungan pohon lamtoro/sengon agar intensitas cahaya optimal' },
      { kode: 'TEH-RRK-01', nama: 'Pembersihan Rorak & Saluran Air', komoditas: 'Teh', kategori: 'pengolahan_tanah', satuan: 'Meter', desc: 'Perbaikan rorak pencegah erosi dan penampung air tanah' },

      // Kelapa Sawit (PPKS)
      { kode: 'SWT-PNN-01', nama: 'Panen Tandan Buah Segar (TBS)', komoditas: 'Kelapa Sawit', kategori: 'panen', satuan: 'Ton TBS', desc: 'Pemotongan tandan buah matang panen' },
      { kode: 'SWT-KST-01', nama: 'Kastrasi & Wiwil Tunas', komoditas: 'Kelapa Sawit', kategori: 'pangkas', satuan: 'Pokok', desc: 'Pembuangan bunga pasir dan tunas liar' },
      { kode: 'SWT-PUP-01', nama: 'Pemupukan MOP / Kieserite / NPK', komoditas: 'Kelapa Sawit', kategori: 'pemupukan', satuan: 'Kg Pupuk', desc: 'Aplikasi pupuk kelapa sawit TM/TBM' },
      { kode: 'SWT-GLM-01', nama: 'Semprot Piringan & Pasar Pikul', komoditas: 'Kelapa Sawit', kategori: 'pemeliharaan', satuan: 'Hektar', desc: 'Pengendalian gulma piringan dan jalur panen' },

      // Tebu (P3GI)
      { kode: 'TBU-TBG-01', nama: 'Tebang Angkut Tebu', komoditas: 'Tebu', kategori: 'panen', satuan: 'Ton Tebu', desc: 'Penebangan batang tebu masak giling' },
      { kode: 'TBU-KPR-01', nama: 'Kepras & Gulud Tanah', komoditas: 'Tebu', kategori: 'pengolahan_tanah', satuan: 'Hektar', desc: 'Perawatan ratoon pasca tebang' },
      { kode: 'TBU-KLN-01', nama: 'Klentek Daun Kering', komoditas: 'Tebu', kategori: 'pemeliharaan', satuan: 'Hektar', desc: 'Pembersihan daun tebu kering pencegah kebakaran' },
      { kode: 'TBU-PUP-01', nama: 'Pemupukan Tebu (ZA / Phonska)', komoditas: 'Tebu', kategori: 'pemupukan', satuan: 'Kg Pupuk', desc: 'Aplikasi pupuk fase vegetatif tebu' },

      // Karet (PPK)
      { kode: 'KRT-SDP-01', nama: 'Penyadapan Getah Karet', komoditas: 'Karet', kategori: 'panen', satuan: 'Liter Lateks', desc: 'Penyadapan alur lateks bidang sadap' },
      { kode: 'KRT-PUP-01', nama: 'Pemupukan Karet', komoditas: 'Karet', kategori: 'pemupukan', satuan: 'Kg Pupuk', desc: 'Pemupukan tanaman karet menghasilkan' },

      // Umum
      { kode: 'UMM-IRG-01', nama: 'Penyiraman & Manajemen Irigasi', komoditas: 'Umum', kategori: 'penyiraman', satuan: 'Jam', desc: 'Pengoperasian pompa atau pembagian saluran irigasi' },
      { kode: 'UMM-SNT-01', nama: 'Sanitasi Kebun & Pembersihan Batas', komoditas: 'Umum', kategori: 'pemeliharaan', satuan: 'Hektar', desc: 'Pembersihan jalan kebun dan batas areal' }
    ];

    for (const akt of seedAktivitas) {
      await client.query(`
        INSERT INTO public.master_aktivitas (kode_aktivitas, nama_aktivitas, komoditas, kategori, satuan_hasil, deskripsi, is_aktif)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        ON CONFLICT (kode_aktivitas) DO UPDATE SET
          nama_aktivitas = EXCLUDED.nama_aktivitas,
          komoditas = EXCLUDED.komoditas,
          kategori = EXCLUDED.kategori,
          satuan_hasil = EXCLUDED.satuan_hasil,
          deskripsi = EXCLUDED.deskripsi;
      `, [akt.kode, akt.nama, akt.komoditas, akt.kategori, akt.satuan, akt.desc]);
    }
    console.log(`Successfully seeded ${seedAktivitas.length} master_aktivitas rows`);

    // 5. Seed Kebun Gamboeng & Afdeling Gamboeng
    console.log('5. Seeding Kebun Gamboeng & Afdeling Gamboeng...');
    let kebunRes = await client.query(`
      SELECT id FROM public.kebun WHERE kode_kebun = 'RPN-PPTK-15-KBN48' OR nama_kebun = 'Kebun Gamboeng';
    `);

    let kebunId;
    if (kebunRes.rows.length === 0) {
      const insKbn = await client.query(`
        INSERT INTO public.kebun (kode_kebun, nama_kebun, perusahaan, wilayah, kabupaten_kota, provinsi, komoditas, keterangan)
        VALUES ('RPN-PPTK-15-KBN48', 'Kebun Gamboeng', 'PPTK (Teh & Kina)', 'Gamboeng, Kabupaten Bandung', 'Kabupaten Bandung', 'Jawa Barat', 'Teh', 'Pusat Penelitian Teh dan Kina (PPTK) Unit 15 Gamboeng')
        RETURNING id;
      `);
      kebunId = insKbn.rows[0].id;
      console.log('Created Kebun Gamboeng ID:', kebunId);
    } else {
      kebunId = kebunRes.rows[0].id;
      console.log('Found existing Kebun Gamboeng ID:', kebunId);
    }

    let afdRes = await client.query(`
      SELECT id FROM public.afdeling WHERE kebun_id = $1 AND (kode_afdeling = 'AFD-AFD3-GBG' OR nama_afdeling = 'Afdeling Gamboeng');
    `, [kebunId]);

    let afdId;
    if (afdRes.rows.length === 0) {
      const insAfd = await client.query(`
        INSERT INTO public.afdeling (kebun_id, kode_afdeling, nama_afdeling, keterangan)
        VALUES ($1, 'AFD-AFD3-GBG', 'Afdeling Gamboeng', 'Afdeling 3 Kebun PPTK Gamboeng')
        RETURNING id;
      `, [kebunId]);
      afdId = insAfd.rows[0].id;
      console.log('Created Afdeling Gamboeng ID:', afdId);
    } else {
      afdId = afdRes.rows[0].id;
      console.log('Found existing Afdeling Gamboeng ID:', afdId);
    }

    // 6. Read and seed blocks from gamboeng_blocks.json
    console.log('6. Seeding blocks from gamboeng_blocks.json...');
    const jsonPath = path.join(__dirname, 'gamboeng_blocks.json');
    const excelBlocks = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`Loaded ${excelBlocks.length} blocks from ${jsonPath}`);

    let insertedBlok = 0;
    for (const b of excelBlocks) {
      const kodeBlok = b.Kode_Kebun || `RPN-PPTK-GBG-${b.Name}`;
      const namaBlok = b.Name;
      const luas = parseFloat(b.Luas) || 0;
      const lat = b.Lat || '';
      const lon = b.Long || '';
      const ket = `Luas: ${luas.toFixed(2)} Ha | Centroid: Lat ${lat}, Long ${lon}`;

      const existingBlok = await client.query(
        `SELECT id FROM public.blok WHERE kebun_id = $1 AND LOWER(kode_blok) = LOWER($2);`,
        [kebunId, kodeBlok]
      );

      if (existingBlok.rows.length === 0) {
        await client.query(`
          INSERT INTO public.blok (kebun_id, afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, keterangan)
          VALUES ($1, $2, $3, $4, 'Teh', 2015, $5);
        `, [kebunId, afdId, kodeBlok, namaBlok, ket]);
      } else {
        await client.query(`
          UPDATE public.blok SET
            afdeling_id = $2,
            nama_blok = $3,
            komoditas = 'Teh',
            keterangan = $4
          WHERE id = $1;
        `, [existingBlok.rows[0].id, afdId, namaBlok, ket]);
      }
      insertedBlok++;
    }
    console.log(`Successfully seeded/updated ${insertedBlok} blok rows for Kebun Gamboeng.`);

    await client.query('COMMIT');
    console.log('Fase 1 Migration & Seeding COMPLETED SUCCESSFULLY!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
