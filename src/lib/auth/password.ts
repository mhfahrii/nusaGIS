import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt hanya memproses 72 byte pertama; tolak yang lebih panjang agar tidak terpotong diam-diam.
export const PASSWORD_MAX_BYTES = 72;

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password wajib diisi.';
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password maksimal ${PASSWORD_MAX_BYTES} byte.`;
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Hash acak untuk menyamakan waktu respons saat email tidak terdaftar,
// sehingga penyerang tidak bisa menebak email valid dari lamanya respons.
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = bcrypt.hash(crypto.randomUUID(), BCRYPT_COST);
  }
  return dummyHash;
}

