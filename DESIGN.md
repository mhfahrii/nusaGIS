# NusaGIS Monitoring — Arah visual

**Produk:** dashboard operasional GIS perkebunan (internal).  
**Audience:** staf kebun, GIS, admin data.  
**Dial:** ENERGY 2 / RHYTHM 2 / MOTION 1

## Identitas

- Gelap sebagai default: kontras dengan peta satelit dan layer vektor (bukan “tech bro aesthetic”).
- Satu aksen operasional: cyan `#00D2FF` hanya untuk **aksi utama** (upload, simpan, fokus layer aktif).
- Hierarki: peta (fokus) > panel filter > tabel atribut.

## Palet

| Peran | Dark | Light |
|-------|------|-------|
| Latar kerja | `#0A0E1A` | `#F1F5F9` |
| Panel / chrome | `#0D1322` | `#FFFFFF` |
| Permukaan | `#12192B` | `#F8FAFC` |
| Border | `#1E2942` | `#E2E8F0` |
| Teks utama | `#F0F6FC` | `#0F172A` |
| Teks sekunder | `#8B9BB4` | `#64748B` |
| Aksen (CTA) | `#00D2FF` | `#0284C7` |
| Sukses | `#10B981` | `#059669` |

## Tipografi

- UI: system sans (`ui-sans-serif`, Geist jika tersedia).
- Data spasial / CRS / koordinat: monospace untuk angka dan kode layer.

## Radius (sistem)

- `4px` — badge kecil, chip
- `8px` (`rounded-lg`) — input, tombol sekunder
- `12px` (`rounded-xl`) — kartu modal, section besar
- Hindari pill di semua elemen; pill hanya status binary (on/off) jika perlu.

## Komponen

- Ikon: set `GisIcons` (stroke konsisten), hindari emoji sebagai ikon UI.
- Modal: overlay gelap solid, **tanpa** blur di banyak lapisan sekaligus.
- Fokus keyboard: class `nusa-focus` (ring cyan, offset 2px).
- Target sentuh minimum ~44px pada kontrol primer di sidebar dan upload.

## Copy

- Bahasa Indonesia operasional; hindari badge dekoratif “ArcGIS” tanpa fungsi.
- Kolom wajib ditandai `*` di form impor.