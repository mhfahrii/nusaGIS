/**
 * Parser PopupInfo format ArcGIS / KMZ: "Kunci : Nilai" per baris.
 * Dipakai saat import shapefile agar kolom tabel atribut lebih rapi.
 */

const POPUP_FIELD_MAP: Record<string, string> = {
  'luas baku': 'luas_baku',
  'status lahan': 'status_lahan',
  tanaman: 'tanaman',
  'luas tanam': 'luas_tanam',
  mt: 'masa_tanam',
  varietas: 'varietas',
  'jenis pohon': 'jenis_pohon',
  'jumlah pohon': 'jumlah_pohon',
  'jml pohon': 'jumlah_pohon',
  pokok: 'jumlah_pohon',
};

function isNonemptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  return s.length > 0 && s !== '-' && s !== '—';
}

export function parsePopupInfoToMap(text: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof text !== 'string' || !text.trim()) return out;
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function getExisting(props: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in props && isNonemptyValue(props[k])) return props[k];
  }
  return undefined;
}

/**
 * Salin nilai dari PopupInfo ke kunci datar di `atribut` (hanya jika nilainya terisi).
 * Tidak menghapus PopupInfo asli; tidak menimpa kolom DBF yang sudah berisi nilai.
 */
export function enrichFeaturePropertiesFromPopup(
  properties: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...properties };
  const popupRaw =
    properties.PopupInfo ?? properties.popupinfo ?? properties.POPUPINFO;
  const popupMap = parsePopupInfoToMap(popupRaw);

  for (const [popupKey, attrKey] of Object.entries(POPUP_FIELD_MAP)) {
    const fromPopup = popupMap[popupKey];
    if (!isNonemptyValue(fromPopup)) continue;

    const existing = getExisting(
      out,
      attrKey,
      attrKey.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      attrKey
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    );
    if (isNonemptyValue(existing)) continue;

    out[attrKey] = fromPopup;

    if (attrKey === 'masa_tanam' && !isNonemptyValue(out.mt)) out.mt = fromPopup;
    if (attrKey === 'masa_tanam' && !isNonemptyValue(out.MT)) out.MT = fromPopup;
    if (attrKey === 'tanaman' && !isNonemptyValue(out.komoditas)) out.komoditas = fromPopup;
    if (attrKey === 'status_lahan' && !isNonemptyValue(out['Status Lahan'])) {
      out['Status Lahan'] = fromPopup;
    }
    if (attrKey === 'luas_baku' && !isNonemptyValue(out['Luas Baku'])) {
      out['Luas Baku'] = fromPopup;
    }
    if (attrKey === 'luas_tanam' && !isNonemptyValue(out['Luas Tanam'])) {
      out['Luas Tanam'] = fromPopup;
    }
    if (attrKey === 'varietas' && !isNonemptyValue(out.Varietas)) {
      out.Varietas = fromPopup;
    }
  }

  return out;
}