#!/usr/bin/env node
/**
 * Skrip Inisialisasi Database Satu Pintu (Deployment Bootstrap)
 * Web GIS Perkebunan PT Riset Perkebunan Nusantara (PT RPN)
 *
 * Fungsi:
 * 1. Mengaktifkan ekstensi PostGIS & membangun seluruh 10 tabel struktur kosong
 *    beserta indeks spasial GiST/GIN dari `database/schema.sql`.
 * 2. Opsional (--reset-gis): Mengosongkan data kebun/layer/fitur uji coba
 *    agar database siap mulai bersih dari nol untuk Divisi GIS.
 * 3. Membuat akun Administrator Utama (untuk Kepala Divisi GIS) dengan akses penuh.
 *
 * Penggunaan:
 *   npm run db:init
 *   npm run db:init -- --reset-gis
 */
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const BCRYPT_COST = 12;

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
} else if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

function getPoolConfig() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL } = process.env;
  if (DB_HOST && DB_NAME && DB_USER) {
    return {
      host: DB_HOST,
      port: Number(DB_PORT || 5432),
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD || '',
    };
  }
  if (DATABASE_URL) {
    return { connectionString: DATABASE_URL };
  }
  console.error('✖ Konfigurasi database (DB_* atau DATABASE_URL) belum diatur di .env.local.');
  process.exit(1);
}

const DEFAULT_ADMIN_HAK_AKSES = {
  lihat_peta: true,
  upload_layer: true,
  edit_data: true,
  hapus_data: true,
  kelola_karyawan: true,
};

async function main() {
  const args = process.argv.slice(2);
  const shouldResetGisData = args.includes('--reset-gis');

  const schemaPath = path.join(process.cwd(), 'database', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`✖ File skema tidak ditemukan di: ${schemaPath}`);
    process.exit(1);
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const pool = new pg.Pool(getPoolConfig());

  try {
    console.log('1. Memeriksa koneksi PostgreSQL & menerapkan skema PostGIS (database/schema.sql)...');
    await pool.query(schemaSql);
    console.log('✔ Struktur 10 tabel, ekstensi PostGIS, dan indeks spasial GiST/GIN berhasil disiapkan.');

    if (shouldResetGisData) {
      console.log('2. Mengosongkan data kebun & layer uji coba (--reset-gis) agar siap diisi Divisi GIS...');
      await pool.query(`
        TRUNCATE TABLE
          public.fitur_peta,
          public.layer_peta,
          public.layer_raster,
          public.data_unggahan,
          public.blok,
          public.afdeling,
          public.kebun
        RESTART IDENTITY CASCADE;
      `);
      console.log('✔ Seluruh tabel kebun & layer GIS kini bersih (0 data) dan siap menerima upload resmi Divisi GIS.');
    }

    const adminNama = (process.env.ADMIN_NAMA || 'Kepala Divisi GIS').trim();
    const adminUsername = (process.env.ADMIN_EMAIL || 'admin.gis').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'AdminGIS2026!';

    const existingAdmin = await pool.query(
      `SELECT id, nama, email FROM public.pengguna WHERE LOWER(email) = LOWER($1) OR peran = 'admin' ORDER BY id ASC LIMIT 1;`,
      [adminUsername]
    );

    if (existingAdmin.rowCount === 0) {
      const hash = await bcrypt.hash(adminPassword, BCRYPT_COST);
      const ins = await pool.query(
        `INSERT INTO public.pengguna (nama, email, kata_sandi_hash, peran, aktif, hak_akses)
         VALUES ($1, $2, $3, 'admin', TRUE, $4::jsonb)
         RETURNING id, nama, email;`,
        [adminNama, adminUsername, hash, JSON.stringify(DEFAULT_ADMIN_HAK_AKSES)]
      );
      const adm = ins.rows[0];
      await pool.query(
        `INSERT INTO public.riwayat_aktivitas (pengguna_id, aktivitas, keterangan)
         VALUES ($1, 'init_database', 'Inisialisasi database produksi & pembuatan akun Admin Kepala Divisi GIS.');`,
        [adm.id]
      );
      console.log('✔ Akun Admin Kepala Divisi GIS berhasil dibuat:');
      console.log(`  - Nama          : ${adm.nama}`);
      console.log(`  - ID / Username : ${adm.email}`);
      console.log(`  - Password Awal : ${adminPassword}`);
    } else {
      const current = existingAdmin.rows[0];
      console.log(`✔ Akun Admin sudah tersedia di database: "${current.nama}" (ID/Username: ${current.email}).`);
    }

    console.log('\n✔ Database siap digunakan untuk deployment!');
  } catch (err) {
    const msg = err?.message || err?.code || JSON.stringify(err);
    console.error(`✖ Gagal menginisialisasi database: ${msg}`);
    if (err?.code === 'ECONNREFUSED') {
      console.error('  Pastikan layanan PostgreSQL (Laragon / Windows Service) sedang aktif di port 5432.');
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
