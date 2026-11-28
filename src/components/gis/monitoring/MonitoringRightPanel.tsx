'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { IconChevronRight, IconClose } from '../GisIcons';
import type { MonitoringStats } from '@/types/gis';
import type { MapBlokFeature } from './MonitoringMap';
import { extractFeatureIntel } from '@/lib/gis/attributeExtractor';
import { formatPerusahaanForPopup } from '@/lib/gis/rpnEntities';
import { RISK_TIER_META, type BlockRiskDiagnosis, type RiskTier } from '@/lib/gis/rcaEngine';

interface MonitoringRightPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  stats: MonitoringStats | null;
  periodMonth: string;
  periodYear: string;
  activeKebunName?: string;
  activeAfdelingName?: string;
  activeBlokName?: string;
  selectedBlokFeature?: MapBlokFeature | null;
  onClearSelectedBlok?: () => void;
  onFeatureUpdated?: () => void;
  onFeatureDeleted?: (featureId: number, layerId: number) => void;
  isAdmin?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  activeDiagnosis?: BlockRiskDiagnosis | null;
  riskSummary?: Record<RiskTier, number>;
}

const fmt = (val: number | undefined | null, digits = 2) =>
  Number(val || 0).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

function isValidVal(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  const s = String(val).trim();
  return (
    s !== '' &&
    s !== '-' &&
    s !== '--' &&
    s.toLowerCase() !== 'null' &&
    s.toLowerCase() !== 'none' &&
    s.toLowerCase() !== 'undefined'
  );
}

export function MonitoringRightPanel({
  isOpen,
  onToggle,
  isMobileOpen = false,
  onCloseMobile,
  stats,
  periodMonth,
  periodYear,
  activeKebunName,
  activeAfdelingName,
  activeBlokName,
  selectedBlokFeature = null,
  onClearSelectedBlok,
  onFeatureUpdated,
  onFeatureDeleted,
  isAdmin = false,
  canEdit = false,
  canDelete = false,
  activeDiagnosis,
  riskSummary,
}: MonitoringRightPanelProps) {
  // Inline Edit State untuk Detail Blok di Panel Kanan
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editNamaBlok, setEditNamaBlok] = useState('');
  const [editKomoditas, setEditKomoditas] = useState('Teh');
  const [editLuasBaku, setEditLuasBaku] = useState('');
  const [editAfdeling, setEditAfdeling] = useState('');
  const [editStatusLahan, setEditStatusLahan] = useState('');
  const [editTargetTon, setEditTargetTon] = useState('');

  // Reset edit mode ketika user mengklik blok lain
  useEffect(() => {
    setIsEditing(false);
  }, [selectedBlokFeature?.featureId]);

  if (!isOpen && !isMobileOpen) {
    return (
      <div className="hidden lg:flex w-10 bg-[#0D1322] border-l border-[#1E2942] flex-col items-center py-3 select-none shrink-0 z-20">
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded-lg bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors shadow-md cursor-pointer"
          title="Buka Panel Ringkasan Kebun"
          aria-label="Buka Panel Ringkasan Kebun"
        >
          <span className="text-[10px] font-bold text-[#00D2FF]">Info</span>
        </button>
      </div>
    );
  }

  const luasUkurHa = stats?.total_luas_ha ?? 0;
  const luasBakuHa = stats?.total_luas_baku_ha;
  const totalBlok = stats?.total_fitur || stats?.total_blok || 0;
  const komoditas = stats?.komoditas || 'Belum ditentukan';
  const isSingleBoundary = Boolean(stats?.is_single_boundary);

  const ksGpaLuas = stats?.ks_gpa_luas_ha ?? 0;
  const ksGpaCount = stats?.ks_gpa_count ?? 0;
  const ktgLuas = stats?.ktg_luas_ha ?? 0;
  const ktgCount = stats?.ktg_count ?? 0;

  const ksGpaPct = luasUkurHa > 0 ? Math.round((ksGpaLuas / luasUkurHa) * 1000) / 10 : 0;
  const ktgPct = luasUkurHa > 0 ? Math.round((ktgLuas / luasUkurHa) * 1000) / 10 : 0;

  const selisihHa = stats?.selisih_luas_ha;
  const selisihPct = stats?.selisih_luas_pct;
  const auditStatus = stats?.audit_status;

  const cp = stats?.commodity_profile;
  const estPanenTon = stats?.estimasi_panen_ton ?? 0;
  const estOlahanTon = stats?.estimasi_olahan_ton;
  const afdBreakdown = stats?.afdeling_breakdown || [];

  const auditColor =
    auditStatus === 'sesuai'
      ? '#10B981'
      : auditStatus === 'lebih'
      ? '#00D2FF'
      : '#F59E0B';
  const auditLabel =
    auditStatus === 'sesuai'
      ? 'Sesuai Baku'
      : auditStatus === 'lebih'
      ? 'Fisik Lebih Luas'
      : 'Fisik Lebih Kecil';

  // Siapkan data detail blok jika ada blok yang sedang dipilih di peta (Opsi A)
  const renderSelectedBlokDetail = () => {
    if (!selectedBlokFeature) return null;
    const props = (selectedBlokFeature.properties || {}) as Record<string, unknown>;
    const layer = selectedBlokFeature.layer;
    const featId = selectedBlokFeature.featureId;
    const diag = selectedBlokFeature.diagnosis || activeDiagnosis;

    const intel = extractFeatureIntel(props, {
      featId,
      layerName: layer?.nama_layer,
      perusahaan: layer?.perusahaan,
      namaKebun: layer?.nama_kebun,
      wilayah: layer?.wilayah,
      komoditas: layer?.komoditas,
      isSingleBoundaryLayer: layer?.jumlah_fitur === 1,
    });

    // Header Kode Standar RPN di sebelah titik warna (ganti KODE_KEBUN_GAMBUNG menjadi RPN-PPTK-15-KBN48-AFD3-...)
    const kodeRpnHeader = String(
      props.Kode_Kebun ||
        props.kode_kebun ||
        props.KODE_KEBUN ||
        props.kode_blok ||
        props.KODE_BLOK ||
        layer?.nama_kebun ||
        'Blok Kebun'
    ).trim();

    const rawPerusahaan =
      props.perusahaan || props.Perusahaan || props.PERUSAHAAN || props.holding || layer?.perusahaan || '';
    const displayPerusahaan = formatPerusahaanForPopup(String(rawPerusahaan || ''), {
      namaKebun: layer?.nama_kebun,
      wilayah: layer?.wilayah,
      layerName: layer?.nama_layer,
      komoditas: layer?.komoditas,
    });

    // Susun baris atribut bersih: HAPUS redundansi (Kode_Kebun, Puslit, Lokasi) & kolom teknis (OID_, DBF, dll)
    const rows: Array<{ label: string; value: string; accent?: string }> = [];
    if (isValidVal(displayPerusahaan)) {
      rows.push({ label: 'Perusahaan', value: displayPerusahaan });
    }
    rows.push({ label: 'Komoditas', value: intel.commodity.label });
    if (isValidVal(intel.afdelingGroup)) {
      rows.push({ label: 'Afdeling', value: String(intel.afdelingGroup) });
    }
    if (isValidVal(intel.statusLahan)) {
      rows.push({ label: 'Status Lahan', value: intel.statusLahan });
    }
    if (isValidVal(intel.varietas)) {
      rows.push({ label: 'Varietas', value: intel.varietas });
    }
    if (isValidVal(intel.mtFormatted)) {
      rows.push({ label: 'Masa Tanam', value: intel.mtFormatted });
    }
    if (isValidVal(layer?.wilayah)) {
      rows.push({ label: 'Wilayah', value: String(layer?.wilayah) });
    }

    // Kolom Aktivitas Terakhir (hasil input dari Dashboard)
    const rawAkt = String(props.aktivitas_terakhir || '').trim();
    const rawTgl = String(props.tanggal_aktivitas_terakhir || '').trim();
    if (rawAkt) {
      rows.push({
        label: 'Aktivitas Terakhir',
        value: `${rawAkt}${rawTgl ? ` (${rawTgl})` : ''}`,
        accent: '#10B981',
      });
    } else {
      rows.push({
        label: 'Aktivitas Terakhir',
        value: 'Belum ada catatan harian',
        accent: '#94A3B8',
      });
    }

    const rawKendala = String(props.kendala_aktif || '').trim();
    if (rawKendala) {
      rows.push({ label: 'Kendala Lapangan', value: rawKendala, accent: '#F59E0B' });
    }

    // Pertahankan koordinat Lat & Long jika ada di data (sesuai arahan atasan)
    if (isValidVal(props.Lat ?? props.lat)) {
      rows.push({ label: 'Lat', value: String(props.Lat ?? props.lat) });
    }
    if (isValidVal(props.Long ?? props.long)) {
      rows.push({ label: 'Long', value: String(props.Long ?? props.long) });
    }

    const startEdit = () => {
      setEditNamaBlok(intel.blokName);
      setEditKomoditas(intel.commodity.label);
      setEditLuasBaku(intel.luasBakuHa !== null ? String(intel.luasBakuHa) : String(intel.luasUkurHa));
      setEditAfdeling(intel.afdelingGroup || '');
      setEditStatusLahan(intel.statusLahan || '');
      setEditTargetTon(intel.estimasiPanenTon > 0 ? String(intel.estimasiPanenTon) : '');
      setIsEditing(true);
    };

    const handleSaveInlineEdit = async (e: React.FormEvent) => {
      e.preventDefault();
      setSavingEdit(true);
      try {
        const res = await fetch('/api/gis/features', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: featId,
            nama_blok: editNamaBlok.trim(),
            komoditas: editKomoditas,
            luas_baku: editLuasBaku,
            afdeling: editAfdeling.trim(),
            status_lahan: editStatusLahan.trim(),
            target_produksi_ton: editTargetTon,
          }),
        });
        const j = await res.json();
        if (!res.ok) {
          alert(j.message || 'Gagal menyimpan perubahan blok.');
          return;
        }
        setIsEditing(false);
        onFeatureUpdated?.();
      } catch {
        alert('Terjadi kesalahan koneksi saat menyimpan data.');
      } finally {
        setSavingEdit(false);
      }
    };

    const handleDeleteBlock = async () => {
      if (!window.confirm(`Apakah Anda yakin ingin menghapus blok "${intel.blokName}"?`)) return;
      try {
        const res = await fetch(`/api/gis/features?id=${featId}`, { method: 'DELETE' });
        if (res.ok) {
          onFeatureDeleted?.(featId, selectedBlokFeature.layerId);
          onClearSelectedBlok?.();
        } else {
          const j = await res.json();
          alert(j.message || 'Gagal menghapus blok.');
        }
      } catch {
        alert('Terjadi kesalahan jaringan saat menghapus blok.');
      }
    };

    const isProblemBlock = diag && (diag.tier === 'high' || diag.tier === 'critical');

    return (
      <div className="space-y-3 animate-in fade-in duration-150">
        {/* Header Kartu Detail Blok */}
        <div className="p-3 bg-[#12192B] border border-[#00D2FF]/50 rounded-xl space-y-2.5 shadow-md">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: diag?.color || '#10B981' }}
                />
                <span
                  className="text-[10px] font-bold tracking-wide text-[#00D2FF] font-mono truncate"
                  title={kodeRpnHeader}
                >
                  {kodeRpnHeader}
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-white leading-snug truncate" title={intel.blokName}>
                {intel.blokName}
              </h3>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {diag && (
                <span
                  className="px-2 py-0.5 rounded text-[9.5px] font-extrabold text-white"
                  style={{ backgroundColor: diag.color }}
                >
                  {diag.tierBadge}
                </span>
              )}
              {onClearSelectedBlok && (
                <button
                  type="button"
                  onClick={onClearSelectedBlok}
                  className="p-1 rounded-md bg-[#0D1322] hover:bg-[#1E2942] text-[#8B9BB4] hover:text-white transition-colors cursor-pointer"
                  title="Tutup Detail Blok & Kembali ke Ringkasan Kebun"
                >
                  <IconClose className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Luas & Estimasi Produksi Blok */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-[#0A0E1A] border border-[#1E2942]">
              <div className="text-[9px] font-bold text-[#8B9BB4] uppercase">Luas Ukur Peta</div>
              <div className="text-base font-black text-[#00D2FF] font-mono mt-0.5">
                {intel.luasUkurHa > 0 ? `${intel.luasUkurHa.toFixed(2)} Ha` : '-'}
              </div>
            </div>
            {intel.luasBakuHa !== null && intel.luasBakuHa > 0 ? (
              <div className="p-2 rounded-lg bg-[#0A0E1A] border border-[#1E2942]">
                <div className="text-[9px] font-bold text-[#8B9BB4] uppercase">Luas Baku Dokumen</div>
                <div className="text-base font-black text-white font-mono mt-0.5">
                  {intel.luasBakuHa.toFixed(2)} Ha
                </div>
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-[#0A0E1A] border border-[#1E2942]">
                <div className="text-[9px] font-bold text-[#8B9BB4] uppercase">Est. {intel.commodity.yieldUnit}</div>
                <div className="text-base font-black text-emerald-400 font-mono mt-0.5">
                  {intel.estimasiPanenTon.toLocaleString('id-ID', { maximumFractionDigits: 1 })} Ton
                </div>
              </div>
            )}
          </div>

          {intel.luasBakuHa !== null && intel.luasBakuHa > 0 && intel.estimasiPanenTon > 0 && (
            <div className="p-2 rounded-lg bg-[#0F241F] border border-[#10B981]/30 grid grid-cols-2 gap-2">
              <div>
                <div className="text-[8.5px] font-bold text-emerald-300 uppercase">
                  Est. {intel.commodity.yieldUnit}
                </div>
                <div className="text-sm font-black text-emerald-400 font-mono">
                  {intel.estimasiPanenTon.toLocaleString('id-ID', { maximumFractionDigits: 1 })} Ton
                </div>
              </div>
              {intel.estimasiOlahanTon !== null && intel.commodity.processedUnit && (
                <div>
                  <div className="text-[8.5px] font-bold text-sky-300 uppercase">
                    {intel.commodity.processedLabel || 'Hasil Olahan'}
                  </div>
                  <div className="text-sm font-black text-[#00D2FF] font-mono">
                    {intel.estimasiOlahanTon.toLocaleString('id-ID', { maximumFractionDigits: 2 })} Ton
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Diagnosis Masalah Blok (Khusus Oranye High Risk & Merah Pekat Critical) */}
          {isProblemBlock && diag && (
            <div
              className="p-2.5 rounded-lg space-y-2"
              style={{
                backgroundColor: diag.tier === 'critical' ? '#450a0a80' : '#43140780',
                border: `1px solid ${diag.color}`,
              }}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-extrabold text-white uppercase">
                  ⚠️ Masalah Blok ({diag.tier === 'critical' ? 'Kritis' : 'Perhatian'})
                </span>
                <span
                  className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold text-white"
                  style={{ backgroundColor: diag.color }}
                >
                  {diag.perubahanProduksiPct}% vs Target
                </span>
              </div>
              <ul className="space-y-1 text-[10.5px] text-[#F1F5F9] list-disc pl-3.5 leading-snug">
                {diag.problemBullets.slice(0, 3).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              <div className="pt-1.5 border-t border-white/10 space-y-1">
                <div className="text-[9.5px] font-bold text-emerald-300">Rekomendasi Prioritas:</div>
                {diag.recommendations.slice(0, 2).map((rec, i) => (
                  <div key={i} className="text-[10px] text-emerald-100 leading-snug">
                    ✓ {rec}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabel Atribut Bersih atau Mode Inline Edit */}
          {!isEditing ? (
            <div className="rounded-lg border border-[#1E2942] overflow-hidden">
              <table className="w-full text-left border-collapse text-[11px]">
                <tbody className="divide-y divide-[#1E2942]">
                  {rows.map((r, idx) => (
                    <tr key={r.label} className={idx % 2 === 0 ? 'bg-[#0D1322]' : 'bg-[#12192B]'}>
                      <td className="py-1.5 px-2.5 text-[#8B9BB4] font-semibold w-[42%] align-top">
                        {r.label}
                      </td>
                      <td
                        className="py-1.5 px-2.5 font-bold align-top break-words"
                        style={{ color: r.accent || '#F0F6FC' }}
                      >
                        {r.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <form onSubmit={handleSaveInlineEdit} className="space-y-2 p-2.5 rounded-lg bg-[#0A0E1A] border border-[#00D2FF]/40 text-xs">
              <div className="flex items-center justify-between text-[10px] font-bold text-[#00D2FF]">
                <span>Edit Informasi Blok</span>
                <span className="text-[#8B9BB4] font-normal">Luas Peta Terkunci</span>
              </div>
              <div>
                <label className="block text-[10px] text-[#8B9BB4] mb-0.5">Nama Blok / Petak</label>
                <input
                  type="text"
                  value={editNamaBlok}
                  onChange={(e) => setEditNamaBlok(e.target.value)}
                  className="w-full px-2 py-1 rounded bg-[#12192B] border border-[#1E2942] text-xs text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#8B9BB4] mb-0.5">Komoditas</label>
                  <select
                    value={editKomoditas}
                    onChange={(e) => setEditKomoditas(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-[#12192B] border border-[#1E2942] text-xs text-white"
                  >
                    {['Teh', 'Tebu', 'Kelapa Sawit', 'Karet', 'Kina', 'Kopi', 'Kakao'].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#8B9BB4] mb-0.5">Luas Baku (Ha)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editLuasBaku}
                    onChange={(e) => setEditLuasBaku(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-[#12192B] border border-[#1E2942] text-xs text-white font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#8B9BB4] mb-0.5">Afdeling</label>
                  <input
                    type="text"
                    value={editAfdeling}
                    onChange={(e) => setEditAfdeling(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-[#12192B] border border-[#1E2942] text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#8B9BB4] mb-0.5">Status Lahan</label>
                  <input
                    type="text"
                    value={editStatusLahan}
                    onChange={(e) => setEditStatusLahan(e.target.value)}
                    className="w-full px-2 py-1 rounded bg-[#12192B] border border-[#1E2942] text-xs text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-[#8B9BB4] mb-0.5">Target Produksi (Ton)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editTargetTon}
                  onChange={(e) => setEditTargetTon(e.target.value)}
                  className="w-full px-2 py-1 rounded bg-[#12192B] border border-[#1E2942] text-xs text-emerald-400 font-mono font-bold"
                />
              </div>
              <div className="flex items-center justify-end gap-1.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-2.5 py-1 rounded bg-[#12192B] border border-[#1E2942] text-[10px] text-[#8B9BB4] hover:text-white cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-3 py-1 rounded bg-[#00D2FF] text-[#0A0E1A] text-[10px] font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingEdit ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          )}

          {/* Action Bar: Edit Info + (GeoJSON, KML & Hapus KHUSUS ADMIN) */}
          <div className="pt-2 border-t border-[#1E2942] flex flex-wrap items-center justify-between gap-1.5">
            {canEdit && !isEditing && (
              <button
                type="button"
                onClick={startEdit}
                className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 text-[10.5px] font-bold cursor-pointer"
              >
                ✎ Edit Info
              </button>
            )}

            <div className="flex items-center gap-1.5 ml-auto">
              {/* Tombol GeoJSON & KML khusus untuk ADMIN saja */}
              {isAdmin && (
                <>
                  <a
                    href={`/api/gis/export?feature_id=${featId}&format=geojson`}
                    target="_blank"
                    download={`${intel.blokName}.geojson`}
                    className="px-2 py-1 rounded-md bg-[#0E3A5D] hover:bg-[#0E3A5D]/80 border border-[#00B4D8]/60 text-[#00D2FF] text-[10px] font-bold"
                  >
                    GeoJSON
                  </a>
                  <a
                    href={`/api/gis/export?feature_id=${featId}&format=kml`}
                    target="_blank"
                    download={`${intel.blokName}.kml`}
                    className="px-2 py-1 rounded-md bg-[#132238] hover:bg-[#19233A] border border-[#1E2942] text-[#7DD3FC] text-[10px] font-bold"
                  >
                    KML
                  </a>
                </>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={handleDeleteBlock}
                  className="px-2 py-1 rounded-md bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[10px] font-bold cursor-pointer"
                >
                  Hapus
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[1190] bg-black/60 backdrop-blur-[1px] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {!isOpen && (
        <div className="hidden lg:flex w-10 bg-[#0D1322] border-l border-[#1E2942] flex-col items-center py-3 select-none shrink-0 z-20">
          <button
            type="button"
            onClick={onToggle}
            className="p-2 rounded-lg bg-[#12192B] border border-[#1E2942] hover:border-[#00D2FF] text-[#8B9BB4] hover:text-[#00D2FF] transition-colors shadow-md cursor-pointer"
            title="Buka Panel Ringkasan Kebun"
            aria-label="Buka Panel Ringkasan Kebun"
          >
            <span className="text-[10px] font-bold text-[#00D2FF]">Info</span>
          </button>
        </div>
      )}

      <aside
        className={`${
          isMobileOpen
            ? 'fixed inset-y-0 right-0 z-[1200] flex w-[88vw] max-w-[350px] shadow-2xl'
            : 'hidden'
        } ${
          isOpen ? 'lg:static lg:z-20 lg:flex lg:w-72 xl:w-80 lg:shadow-none' : 'lg:hidden'
        } bg-[#0D1322] border-l border-[#1E2942] flex-col select-none shrink-0 h-full overflow-hidden text-[#F0F6FC]`}
      >
        {/* 1. Header Panel (Ramah Pemula, Tanpa Teks Teknis Backend) */}
        <div className="h-12 px-4 bg-[#0D1322] border-b border-[#1E2942] flex items-center justify-between shrink-0">
          <div>
            <div className="text-sm font-bold text-[#F0F6FC] tracking-tight">
              {selectedBlokFeature ? 'Detail Informasi Blok' : `${periodMonth} ${periodYear}`}
            </div>
            <div className="text-[10px] text-[#00D2FF] font-medium">
              {selectedBlokFeature
                ? 'Klik ✕ untuk kembali ke ringkasan kebun'
                : 'Ringkasan Monitoring Kebun & Produksi'}
            </div>
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="hidden lg:inline-flex p-1 rounded text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
            title="Sembunyikan Panel Informasi"
            aria-label="Sembunyikan Panel Informasi"
          >
            <IconChevronRight className="w-3.5 h-3.5" />
          </button>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden min-w-10 min-h-10 flex items-center justify-center rounded-lg text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B] transition-colors cursor-pointer"
              title="Tutup Panel Informasi"
              aria-label="Tutup Panel Informasi"
            >
              <IconClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 2. Body Panel */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {/* OPSI A: Jika ada blok diklik di peta, tampilkan Detail Blok Lengkap di sini (tidak menutupi peta!) */}
          {selectedBlokFeature ? (
            <>
              {renderSelectedBlokDetail()}

              {/* Root Cause Analysis (5 Faktor %) untuk blok terpilih */}
              {activeDiagnosis && (
                <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#00D2FF]">
                    Analisis Faktor Penyebab (RCA)
                  </div>
                  <div className="space-y-1.5">
                    {activeDiagnosis.rcaFactors.map((f) => (
                      <div key={f.key} className="space-y-0.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-[#CBD5E1] truncate pr-2">{f.label}</span>
                          <span className="font-mono font-bold text-white shrink-0">{f.percentage}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-[#0A0E1A] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${f.percentage}%`, backgroundColor: f.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <Link
                    href="/dashboard"
                    className="block w-full text-center py-1.5 mt-2 rounded-lg bg-[#0E3A5D] hover:bg-[#0E3A5D]/80 border border-[#00B4D8]/40 text-[#00D2FF] text-[10px] font-bold transition-colors"
                  >
                    Lihat Analisis &amp; Tren di Dashboard →
                  </Link>
                </div>
              )}
            </>
          ) : (
            /* Ringkasan Umum Kebun (Saat belum ada blok yang diklik) */
            <>
              {/* CARD A: Ringkasan Wilayah & Komoditas */}
              <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
                <div className="flex items-center justify-between text-[11px] text-[#8B9BB4] font-semibold">
                  <span>Ringkasan Unit Kebun</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#1E2942]/60">
                  <div>
                    <div className="text-[10px] text-[#8B9BB4] uppercase">Kebun</div>
                    <div
                      className="text-lg font-black text-[#F0F6FC] font-mono leading-none mt-1 truncate tabular-nums"
                      title={activeKebunName || 'Semua Kebun'}
                    >
                      {activeKebunName ? (
                        <span className="text-xs font-bold text-[#00D2FF]">{activeKebunName}</span>
                      ) : (
                        stats?.total_kebun ?? 0
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#8B9BB4] uppercase">Total Blok</div>
                    <div
                      className="text-lg font-black text-[#F0F6FC] font-mono leading-none mt-1 truncate tabular-nums"
                      title={activeAfdelingName || 'Jumlah Blok'}
                    >
                      {totalBlok}{' '}
                      <span className="text-[10px] font-normal text-[#8B9BB4]">Petak</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#1E2942]/60 space-y-1 text-[10.5px]">
                  {activeBlokName && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#8B9BB4] shrink-0">Blok Aktif:</span>
                      <span className="font-bold text-[#00D2FF] truncate max-w-[155px]">
                        {activeBlokName}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8B9BB4] shrink-0">Komoditas:</span>
                    <span className="font-bold text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/40 px-1.5 py-0.5 rounded truncate max-w-[155px]">
                      {komoditas}
                    </span>
                  </div>
                </div>
              </div>

              {/* Distribusi Risiko Blok */}
              {riskSummary &&
                riskSummary.normal + riskSummary.moderate + riskSummary.high + riskSummary.critical > 0 && (
                  <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
                    <div className="flex items-center justify-between text-xs font-bold text-[#F0F6FC]">
                      <span>Status Kesehatan Blok</span>
                      <span className="text-[10px] font-mono text-rose-400">
                        {riskSummary.high + riskSummary.critical} Perhatian
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                      {(['normal', 'moderate', 'high', 'critical'] as RiskTier[]).map((t) => {
                        const m = RISK_TIER_META[t];
                        return (
                          <div
                            key={t}
                            className="px-2 py-1.5 rounded-lg bg-[#0A0E1A] border border-[#1E2942] flex items-center justify-between"
                          >
                            <span className="flex items-center gap-1.5 text-[#CBD5E1]">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: m.color }}
                              />
                              <span>{m.shortLabel}</span>
                            </span>
                            <span className="font-mono font-bold text-white">{riskSummary[t] || 0}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* CARD B: Rekapitulasi Luas Lahan */}
              <div className="p-3 bg-[#0E3A5D] border border-[#00B4D8] rounded-xl space-y-2 shadow-md shadow-[#00B4D8]/10">
                <div className="text-xs font-bold text-[#FFFFFF]">
                  {isSingleBoundary ? 'Luas Konsesi Kebun (Ha)' : 'Luas Wilayah Kelola (Ha)'}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="text-xs text-[#7DD3FC] font-semibold">Luas Ukur Peta</div>
                    <div className="text-2xl font-extrabold text-[#FFFFFF] font-stat leading-none mt-1">
                      {fmt(luasUkurHa)}
                    </div>
                    <div className="text-[10.5px] text-[#7DD3FC]/90 mt-0.5">Hektar</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#7DD3FC] font-semibold">
                      {luasBakuHa ? 'Luas Baku' : isSingleBoundary ? 'Areal Efektif' : 'Jumlah Blok'}
                    </div>
                    <div className="text-2xl font-extrabold text-[#00D2FF] font-stat leading-none mt-1">
                      {luasBakuHa
                        ? fmt(luasBakuHa)
                        : isSingleBoundary
                        ? fmt(stats?.potensi_tanam_efektif_ha)
                        : totalBlok}
                    </div>
                    <div className="text-[10.5px] text-[#7DD3FC]/90 mt-0.5">
                      {luasBakuHa ? 'Dokumen Legal' : isSingleBoundary ? 'Potensi 85% Tanam' : 'Petak Terdata'}
                    </div>
                  </div>
                </div>

                {selisihHa !== undefined && selisihPct !== undefined && (
                  <div
                    className="p-2.5 rounded-lg border flex items-center justify-between text-xs"
                    style={{
                      background: `${auditColor}14`,
                      borderColor: `${auditColor}50`,
                    }}
                  >
                    <div>
                      <div className="text-[#CBD5E1] font-semibold text-[11px]">Selisih Luas Lahan</div>
                      <div className="text-[10px] font-medium" style={{ color: auditColor }}>
                        {auditLabel}
                      </div>
                    </div>
                    <div className="text-right font-stat font-extrabold text-[12.5px]" style={{ color: auditColor }}>
                      <div>
                        {selisihHa >= 0 ? '+' : ''}
                        {fmt(selisihHa)} Ha
                      </div>
                      <div className="text-[10.5px] font-medium">
                        ({selisihPct >= 0 ? '+' : ''}
                        {fmt(selisihPct, 1)}%)
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* CARD C: Estimasi Produksi & Panen */}
              {estPanenTon > 0 && cp && (
                <div className="p-3 bg-gradient-to-br from-[#0F241F] to-[#12192B] border border-[#10B981]/40 rounded-xl space-y-2 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#ECFDF5] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                      <span>Estimasi Produksi</span>
                    </span>
                    <span className="text-[9.5px] font-mono text-[#10B981] bg-[#10B981]/15 px-1.5 py-0.5 rounded border border-[#10B981]/30">
                      {cp.yieldPerHa} Ton/Ha
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#10B981]/20">
                    <div>
                      <div className="text-[11px] text-[#94A3B8] font-medium">Est. Hasil Panen</div>
                      <div className="text-lg font-black text-[#10B981] font-stat leading-tight mt-0.5">
                        {fmt(estPanenTon, 1)}
                      </div>
                      <div className="text-[10px] text-[#6EE7B7]">{cp.yieldUnit}</div>
                    </div>
                    {estOlahanTon !== null && estOlahanTon !== undefined && cp.processedUnit && (
                      <div>
                        <div className="text-[11px] text-[#94A3B8] font-medium">
                          {cp.processedLabel || 'Hasil Olahan'}
                        </div>
                        <div className="text-lg font-black text-[#00D2FF] font-stat leading-tight mt-0.5">
                          {fmt(estOlahanTon, 2)}
                        </div>
                        <div className="text-[10px] text-[#7DD3FC]">{cp.processedUnit}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CARD D: Rekapitulasi Afdeling */}
              {afdBreakdown.length > 0 && !isSingleBoundary && (
                <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
                  <div className="flex items-center justify-between text-xs font-bold text-[#F0F6FC]">
                    <span>Pembagian Afdeling</span>
                    <span className="text-[9.5px] font-mono text-[#00D2FF]">{afdBreakdown.length} Grup</span>
                  </div>

                  <div className="h-2 w-full bg-[#0A0E1A] rounded-full overflow-hidden flex border border-[#1E2942]">
                    {afdBreakdown.map((a) => (
                      <div
                        key={a.name}
                        style={{
                          width: `${luasUkurHa > 0 ? (a.luas_ukur_ha / luasUkurHa) * 100 : 0}%`,
                          background: a.color,
                        }}
                      />
                    ))}
                  </div>

                  <div className="space-y-1.5 pt-0.5 text-[10.5px]">
                    {afdBreakdown.map((a) => (
                      <div key={a.name} className="flex items-center justify-between gap-1">
                        <span className="flex items-center gap-1.5 text-[#CBD5E1] min-w-0">
                          <span className="w-2 h-2 rounded-xs shrink-0" style={{ background: a.color }} />
                          <span className="truncate font-medium">{a.name}</span>
                          <span className="text-[9.5px] text-[#64748B] shrink-0">({a.count})</span>
                        </span>
                        <span className="font-mono font-bold text-[#F0F6FC] tabular-nums shrink-0">
                          {fmt(a.luas_ukur_ha)} Ha
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CARD E: Status Pengelolaan Areal */}
              {(ksGpaCount > 0 || ktgCount > 0) && (
                <div className="p-3 bg-[#12192B] border border-[#1E2942] rounded-xl space-y-2 shadow-xs">
                  <div className="text-xs font-bold text-[#F0F6FC]">Status Pengelolaan Areal</div>
                  <div className="h-2 w-full bg-[#0A0E1A] rounded-full overflow-hidden flex border border-[#1E2942]">
                    <div style={{ width: `${ksGpaPct}%` }} className="bg-[#00D2FF] h-full" />
                    <div style={{ width: `${ktgPct}%` }} className="bg-[#10B981] h-full" />
                  </div>
                  <div className="space-y-1.5 pt-0.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[#8B9BB4]">
                        <span className="w-2 h-2 rounded-xs bg-[#00D2FF]" />
                        <span>KS GPA 2023 ({ksGpaCount} blok)</span>
                      </span>
                      <span className="font-mono font-bold text-[#F0F6FC]">
                        {fmt(ksGpaLuas)} Ha ({ksGpaPct}%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[#8B9BB4]">
                        <span className="w-2 h-2 rounded-xs bg-[#10B981]" />
                        <span>KTG ({ktgCount} blok)</span>
                      </span>
                      <span className="font-mono font-bold text-[#F0F6FC]">
                        {fmt(ktgLuas)} Ha ({ktgPct}%)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
