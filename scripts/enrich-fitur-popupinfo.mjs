/**
 * Backfill: pecah PopupInfo menjadi kolom datar pada fitur yang sudah ada.
 * node scripts/enrich-fitur-popupinfo.mjs [layer_id]
 */
import pg from 'pg';
import fs from 'node:fs';

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');

const POPUP_FIELD_MAP = {
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

function isNonempty(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  return s.length > 0 && s !== '-' && s !== '—';
}

function parsePopupInfoToMap(text) {
  const out = {};
  if (typeof text !== 'string' || !text.trim()) return out;
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return out;
}

function enrich(atribut) {
  const out = { ...atribut };
  const popupMap = parsePopupInfoToMap(
    atribut.PopupInfo ?? atribut.popupinfo ?? atribut.POPUPINFO
  );
  for (const [popupKey, attrKey] of Object.entries(POPUP_FIELD_MAP)) {
    const fromPopup = popupMap[popupKey];
    if (!isNonempty(fromPopup)) continue;
    if (isNonempty(out[attrKey])) continue;
    out[attrKey] = fromPopup;
    if (attrKey === 'masa_tanam' && !isNonempty(out.mt)) out.mt = fromPopup;
    if (attrKey === 'tanaman' && !isNonempty(out.komoditas)) out.komoditas = fromPopup;
    if (attrKey === 'status_lahan' && !isNonempty(out['Status Lahan'])) {
      out['Status Lahan'] = fromPopup;
    }
    if (attrKey === 'luas_baku' && !isNonempty(out['Luas Baku'])) {
      out['Luas Baku'] = fromPopup;
    }
    if (attrKey === 'varietas' && !isNonempty(out.Varietas)) out.Varietas = fromPopup;
  }
  return out;
}

const layerIdArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'nusagis',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const q = layerIdArg
    ? 'SELECT id, layer_id, atribut FROM public.fitur_peta WHERE layer_id = $1'
  : `SELECT id, layer_id, atribut FROM public.fitur_peta
      WHERE atribut::text ILIKE '%PopupInfo%' OR atribut::text ILIKE '%popupinfo%'`;
  const params = layerIdArg ? [layerIdArg] : [];
  const rows = await client.query(q, params);
  let updated = 0;
  for (const row of rows.rows) {
    const next = enrich(row.atribut || {});
    if (JSON.stringify(next) === JSON.stringify(row.atribut)) continue;
    await client.query('UPDATE public.fitur_peta SET atribut = $1::jsonb WHERE id = $2', [
      JSON.stringify(next),
      row.id,
    ]);
    updated++;
  }
  await client.query('COMMIT');
  console.log(`Selesai. Diperbarui ${updated} dari ${rows.rowCount} fitur.`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}