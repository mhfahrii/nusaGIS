/**
 * NuSaGIS - Modul Standarisasi Wilayah Administratif Perkebunan (Provinsi & Kabupaten/Kota)
 * Mendukung hierarki wilayah 38 provinsi di Indonesia dan penanganan reverse-geocoding koordinat.
 */

export const PROVINSI_INDONESIA: readonly string[] = [
  'Aceh',
  'Sumatera Utara',
  'Sumatera Barat',
  'Riau',
  'Kepulauan Riau',
  'Jambi',
  'Sumatera Selatan',
  'Kepulauan Bangka Belitung',
  'Bengkulu',
  'Lampung',
  'DKI Jakarta',
  'Jawa Barat',
  'Banten',
  'Jawa Tengah',
  'DI Yogyakarta',
  'Jawa Timur',
  'Bali',
  'Nusa Tenggara Barat',
  'Nusa Tenggara Timur',
  'Kalimantan Barat',
  'Kalimantan Tengah',
  'Kalimantan Selatan',
  'Kalimantan Timur',
  'Kalimantan Utara',
  'Sulawesi Utara',
  'Gorontalo',
  'Sulawesi Tengah',
  'Sulawesi Barat',
  'Sulawesi Selatan',
  'Sulawesi Tenggara',
  'Maluku',
  'Maluku Utara',
  'Papua',
  'Papua Barat',
  'Papua Selatan',
  'Papua Tengah',
  'Papua Pegunungan',
  'Papua Barat Daya',
];

export interface ParsedWilayah {
  provinsi: string;
  kabupatenKota: string;
  displayWilayah: string;
}

/**
 * Normalisasi teks untuk perbandingan case-insensitive & trim spasi/tanda baca berlebih
 */
function cleanText(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/[.,;]+$/, '')
    .trim();
}

/**
 * Pecah dan identifikasi Provinsi & Kabupaten/Kota dari string input apa pun.
 * Contoh input:
 * - "Kabupaten Asahan, Sumatera Utara." -> { provinsi: "Sumatera Utara", kabupatenKota: "Kabupaten Asahan", displayWilayah: "Kabupaten Asahan, Sumatera Utara" }
 * - "Pasuruan, Jawa Timur" -> { provinsi: "Jawa Timur", kabupatenKota: "Pasuruan", displayWilayah: "Pasuruan, Jawa Timur" }
 * - "Sumatera Utara" -> { provinsi: "Sumatera Utara", kabupatenKota: "", displayWilayah: "Sumatera Utara" }
 */
export function parseWilayahHierarchy(raw?: string | null): ParsedWilayah {
  const cleaned = cleanText(raw);
  if (!cleaned) {
    return {
      provinsi: '',
      kabupatenKota: '',
      displayWilayah: 'Wilayah Belum Ditentukan',
    };
  }

  // 1. Cek apakah ada pemisah koma: "Kabupaten Asahan, Sumatera Utara"
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',').map((p) => cleanText(p)).filter(Boolean);
    if (parts.length >= 2) {
      const candidateKab = parts[0];
      const candidateProv = parts.slice(1).join(', ');

      // Cocokkan bagian provinsi ke daftar resmi
      const matchedProv = PROVINSI_INDONESIA.find(
        (p) => p.toLowerCase() === candidateProv.toLowerCase()
      );

      if (matchedProv) {
        return {
          provinsi: matchedProv,
          kabupatenKota: candidateKab,
          displayWilayah: `${candidateKab}, ${matchedProv}`,
        };
      }

      // Jika provinsi terbalik (misal "Sumatera Utara, Asahan")
      const invertedProv = PROVINSI_INDONESIA.find(
        (p) => p.toLowerCase() === candidateKab.toLowerCase()
      );
      if (invertedProv) {
        return {
          provinsi: invertedProv,
          kabupatenKota: candidateProv,
          displayWilayah: `${candidateProv}, ${invertedProv}`,
        };
      }

      return {
        provinsi: candidateProv,
        kabupatenKota: candidateKab,
        displayWilayah: `${candidateKab}, ${candidateProv}`,
      };
    }
  }

  // 2. Tanpa koma: cocokkan langsung apakah nama provinsi saja
  const exactProv = PROVINSI_INDONESIA.find(
    (p) => p.toLowerCase() === cleaned.toLowerCase()
  );
  if (exactProv) {
    return {
      provinsi: exactProv,
      kabupatenKota: '',
      displayWilayah: exactProv,
    };
  }

  // 3. Cek apakah memuat nama provinsi di akhir atau di dalam teks
  for (const prov of PROVINSI_INDONESIA) {
    const provLower = prov.toLowerCase();
    const cleanedLower = cleaned.toLowerCase();
    if (cleanedLower.includes(provLower)) {
      const kabPart = cleanText(
        cleaned
          .replace(new RegExp(prov, 'i'), '')
          .replace(/^[, -]+|[, -]+$/g, '')
      );
      return {
        provinsi: prov,
        kabupatenKota: kabPart,
        displayWilayah: kabPart ? `${kabPart}, ${prov}` : prov,
      };
    }
  }

  // 4. Fallback jika tidak teridentifikasi provinsi resmi
  return {
    provinsi: cleaned,
    kabupatenKota: '',
    displayWilayah: cleaned,
  };
}

/**
 * Ambil label Lokasi (Kota/Kabupaten) untuk dropdown & pengelompokan layer.
 * Jika kabupaten/kota kosong, jatuh ke provinsi/teks wilayah agar data lama tidak hilang.
 */
export function resolveLokasiLabel(
  kabupatenKota?: string | null,
  wilayah?: string | null,
  provinsi?: string | null
): string {
  const directKab = cleanText(kabupatenKota);
  if (directKab) return directKab;

  const parsed = parseWilayahHierarchy(wilayah);
  if (parsed.kabupatenKota) return parsed.kabupatenKota;

  const directProv = cleanText(provinsi);
  if (directProv) return directProv;

  return parsed.provinsi || '';
}

/**
 * Evaluasi apakah suatu data lokasi (dari layer atau kebun) cocok dengan filter Lokasi (Kota/Kabupaten) yang dipilih.
 */
export function matchWilayahFilter(
  itemWilayah?: string | null,
  filterWilayah?: string | null,
  itemProvinsi?: string | null,
  itemKabupatenKota?: string | null
): boolean {
  if (!filterWilayah || !filterWilayah.trim()) return true;

  const target = filterWilayah.trim().toLowerCase();

  const resolvedLokasi = resolveLokasiLabel(itemKabupatenKota, itemWilayah, itemProvinsi);
  if (resolvedLokasi && resolvedLokasi.toLowerCase() === target) {
    return true;
  }

  if (itemKabupatenKota && itemKabupatenKota.trim().toLowerCase() === target) {
    return true;
  }

  if (itemProvinsi && itemProvinsi.trim().toLowerCase() === target) {
    return true;
  }

  if (!itemWilayah || !itemWilayah.trim()) return false;

  const itemParsed = parseWilayahHierarchy(itemWilayah);
  if (
    itemParsed.kabupatenKota.toLowerCase() === target ||
    itemParsed.provinsi.toLowerCase() === target
  ) {
    return true;
  }

  const rawItem = itemWilayah.trim().toLowerCase();
  return rawItem === target || rawItem.includes(target);
}

/**
 * Format label Kebun dengan keterangan Kabupaten/Kota
 * Contoh: "Kebun Teluk Dalan (Kabupaten Asahan)"
 */
export function formatKebunOptionLabel(
  namaKebun: string,
  kabupatenKota?: string | null,
  provinsi?: string | null,
  wilayah?: string | null
): string {
  const parsed = parseWilayahHierarchy(wilayah);
  const kab = (kabupatenKota || parsed.kabupatenKota || '').trim();
  const prov = (provinsi || parsed.provinsi || '').trim();

  if (kab) {
    return `${namaKebun} (${kab})`;
  }
  if (prov) {
    return `${namaKebun} (${prov})`;
  }
  return namaKebun;
}
