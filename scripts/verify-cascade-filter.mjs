import pg from 'pg';
import fs from 'node:fs';

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');

const DEFAULT_PERUSAHAAN = 'PT Perkebunan Nusantara I (Regional 4)';

function kebunPerusahaanLabel(perusahaan) {
  const t = perusahaan?.trim();
  return t && t.length > 0 ? t : DEFAULT_PERUSAHAAN;
}

function filterLayers(rawLayers, kebunList, filters) {
  const {
    selectedPerusahaan = '',
    selectedWilayah = '',
    selectedKebunId = null,
    selectedAfdelingId = null,
    selectedBlokId = null,
  } = filters;

  let scoped = kebunList;
  if (selectedPerusahaan) {
    scoped = scoped.filter((k) => kebunPerusahaanLabel(k.perusahaan) === selectedPerusahaan);
  }
  if (selectedWilayah) {
    scoped = scoped.filter((k) => k.wilayah?.trim() === selectedWilayah);
  }
  if (selectedKebunId) {
    scoped = scoped.filter((k) => Number(k.id) === selectedKebunId);
  }
  const allowed = new Set(scoped.map((k) => Number(k.id)));
  const hierarchyActive = Boolean(selectedPerusahaan || selectedWilayah || selectedKebunId);

  return rawLayers.filter((l) => {
    if (hierarchyActive) {
      if (!l.kebun_id || !allowed.has(Number(l.kebun_id))) return false;
    }
    if (selectedAfdelingId && l.afdeling_id && Number(l.afdeling_id) !== selectedAfdelingId)
      return false;
    if (selectedBlokId && l.blok_id && Number(l.blok_id) !== selectedBlokId) return false;
    return true;
  });
}

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'nusagis',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function main() {
  const client = await pool.connect();
  try {
    const kebunRes = await client.query(
      'SELECT id, nama_kebun, wilayah, perusahaan FROM public.kebun ORDER BY id'
    );
    const layerRes = await client.query(
      'SELECT id, kebun_id, afdeling_id, blok_id, nama_layer FROM public.layer_peta ORDER BY id'
    );

    console.log('=== DATA MASTER ===');
    console.table(kebunRes.rows);
    console.table(layerRes.rows);

    const kebunList = kebunRes.rows;
    const rawLayers = layerRes.rows;

    const perusahaanSet = [
      ...new Set(kebunList.map((k) => kebunPerusahaanLabel(k.perusahaan))),
      'Pusat Penelitian Perkebunan Gula Indonesia (P3GI)',
    ];

    console.log('\n=== SIMULASI FILTER PERUSAHAAN ===');
    for (const p of perusahaanSet) {
      const out = filterLayers(rawLayers, kebunList, { selectedPerusahaan: p });
      console.log(
        `${p}: ${out.length} layer(s) ->`,
        out.map((l) => `${l.id}:${l.nama_layer}`).join(', ') || '(kosong)'
      );
    }

    console.log('\n=== SIMULASI WILAYAH (tanpa perusahaan) ===');
    const wilayahSet = [...new Set(kebunList.map((k) => k.wilayah?.trim()).filter(Boolean))];
    for (const w of wilayahSet) {
      const out = filterLayers(rawLayers, kebunList, { selectedWilayah: w });
      console.log(`${w}: ${out.length} layer(s)`);
    }

    console.log('\n=== CEK LEAK: wilayah sama, perusahaan beda ===');
    const byWilayah = {};
    for (const k of kebunList) {
      const w = k.wilayah?.trim();
      if (!w) continue;
      if (!byWilayah[w]) byWilayah[w] = [];
      byWilayah[w].push(k);
    }
    let leakRisk = false;
    for (const [w, kebuns] of Object.entries(byWilayah)) {
      if (kebuns.length < 2) continue;
      const companies = new Set(kebuns.map((k) => kebunPerusahaanLabel(k.perusahaan)));
      if (companies.size > 1) {
        leakRisk = true;
        console.log(`Wilayah "${w}" dipakai ${companies.size} perusahaan — filter wilayah saja bisa bocor jika perusahaan juga dipilih tanpa irisan di backend.`);
      }
    }
    if (!leakRisk) console.log('Tidak ada wilayah duplikat antar perusahaan di DB saat ini.');

    const layersNoKebun = rawLayers.filter((l) => !l.kebun_id);
    if (layersNoKebun.length > 0) {
      console.log(
        `\nPERINGATAN: ${layersNoKebun.length} layer tanpa kebun_id — tetap tampil saat filter perusahaan aktif.`
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});