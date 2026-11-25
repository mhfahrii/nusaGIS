#!/usr/bin/env node
/**
 * Membuat akun admin pertama untuk Web GIS Perkebunan.
 *
 * Kredensial diambil dari environment variable:
 *   ADMIN_NAMA, ADMIN_EMAIL, ADMIN_PASSWORD
 * Jika tidak tersedia dan terminal interaktif, script akan menanyakannya
 * (password diketik tanpa ditampilkan).
 *
 * Penggunaan:
 *   npm run admin:create
 *
 * Koneksi database memakai DB_* / DATABASE_URL dari .env.local.
 * Password tidak pernah dicetak atau disimpan selain dalam bentuk hash bcrypt.
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const BCRYPT_COST = 12;
const PASSWORD_MIN_LENGTH = 4;
const PASSWORD_MAX_BYTES = 72;
const DEFAULT_ADMIN_HAK_AKSES = {
  lihat_peta: true,
  upload_layer: true,
  edit_data: true,
  hapus_data: true,
  kelola_karyawan: true,
};

if (existsSync('.env.local')) {
  // Tidak menimpa variabel yang sudah di-set di shell.
  process.loadEnvFile('.env.local');
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        stdin.setRawMode(false);
        reject(new Error('Dibatalkan.'));
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function fail(message) {
  console.error(`\u2716 ${message}`);
  process.exit(1);
}

async function readCredentials() {
  let nama = process.env.ADMIN_NAMA?.trim() ?? '';
  let email = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? '';
  let password = process.env.ADMIN_PASSWORD ?? '';
  const interactive = Boolean(process.stdin.isTTY);

  if (!nama && interactive) nama = await ask('Nama admin            : ');
  if (!email && interactive) email = (await ask('ID / Username admin   : ')).toLowerCase();
  if (!password && interactive) {
    password = await askHidden('Password admin        : ');
    const confirm = await askHidden('Ulangi password       : ');
    if (password !== confirm) fail('Konfirmasi password tidak cocok.');
  }

  if (!nama || !email || !password) {
    fail('ADMIN_NAMA, ADMIN_EMAIL (ID/Username), dan ADMIN_PASSWORD wajib diisi.');
  }
  if (email.length < 3 || email.length > 150) fail('ID / Username minimal 3 karakter.');
  if (password.length < PASSWORD_MIN_LENGTH) fail(`Password minimal ${PASSWORD_MIN_LENGTH} karakter.`);
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) fail(`Password maksimal ${PASSWORD_MAX_BYTES} byte.`);
  return { nama, email, password };
}

function poolConfig() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL } = process.env;
  if (DB_HOST && DB_NAME && DB_USER) {
    return { host: DB_HOST, port: Number(DB_PORT || 5432), database: DB_NAME, user: DB_USER, password: DB_PASSWORD };
  }
  if (DATABASE_URL) return { connectionString: DATABASE_URL };
  fail('Konfigurasi database (DB_* atau DATABASE_URL) tidak ditemukan.');
}

async function main() {
  const { nama, email, password } = await readCredentials();
  const pool = new pg.Pool(poolConfig());
  try {
    const existing = await pool.query('SELECT id FROM pengguna WHERE LOWER(email) = $1', [email]);
    if (existing.rowCount > 0) {
      fail(`Email ${email} sudah terdaftar. Tidak ada perubahan yang dilakukan.`);
    }

    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const res = await pool.query(
      `INSERT INTO pengguna (nama, email, kata_sandi_hash, peran, aktif, hak_akses)
       VALUES ($1, $2, $3, 'admin', TRUE, $4::jsonb) RETURNING id`,
      [nama, email, hash, JSON.stringify(DEFAULT_ADMIN_HAK_AKSES)]
    );
    const id = Number(res.rows[0].id);
    await pool.query(
      'INSERT INTO riwayat_aktivitas (pengguna_id, aktivitas, keterangan) VALUES ($1, $2, $3)',
      [id, 'buat_admin', 'Akun admin dibuat melalui script setup.']
    );
    console.log(`\u2714 Admin dibuat: ${email} (id ${id}).`);
    if (process.env.ADMIN_PASSWORD) {
      console.log('  Hapus ADMIN_PASSWORD dari environment / .env.local setelah ini.');
    }
  } catch (err) {
    fail(`Gagal membuat admin: ${err.message}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => fail(err.message));

