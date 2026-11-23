export const DEFAULT_PERUSAHAAN = 'PT Perkebunan Nusantara I (Regional 4)';

export const BUILTIN_PERUSAHAAN_OPTIONS = [
  DEFAULT_PERUSAHAAN,
  'Pusat Penelitian Perkebunan Gula Indonesia (P3GI)',
] as const;

export const NEW_PERUSAHAAN_SELECT_VALUE = '__new_perusahaan__';

export function kebunPerusahaanLabel(perusahaan?: string | null): string {
  const trimmed = perusahaan?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_PERUSAHAAN;
}

export function listAvailablePerusahaan(
  kebunList: Array<{ perusahaan?: string | null }>
): string[] {
  const fromDb = kebunList
    .map((k) => k.perusahaan?.trim())
    .filter((p): p is string => Boolean(p && p.length > 0));
  return Array.from(new Set([...fromDb, ...BUILTIN_PERUSAHAAN_OPTIONS]));
}