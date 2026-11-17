export function toMasterId(id: string | number | null | undefined): number | null {
  if (id === null || id === undefined || id === '') return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}