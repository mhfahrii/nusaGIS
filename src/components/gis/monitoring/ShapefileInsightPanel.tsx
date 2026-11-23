'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { LayerPeta } from '@/types/gis';
import {
  extractFeatureIntel,
  formatMasaTanam,
  type CommodityProfile,
} from '@/lib/gis/attributeExtractor';
import { isFeatureMatchingAfdeling } from './MonitoringMap';

type InsightTab = 'luas' | 'afdeling' | 'status' | 'varietas';

interface BlokRecord {
  id: number;
  layerId: number;
  layerName: string;
  name: string;
  shortName: string;
  afdelingGroup: string;
  afdelingColor: string;
  luasUkur: number;
  luasUkurSource: string;
  luasBaku: number | null;
  selisihHa: number | null;
  selisihPct: number | null;
  auditStatus: 'sesuai' | 'lebih' | 'kurang' | null;
  kelilingKm: number;
  status: string;
  tanaman: string;
  varietas: string;
  mt: string;
  luasTanam: number | null;
  commodity: CommodityProfile;
  estimasiPanenTon: number;
  estimasiOlahanTon: number | null;
  bbox: [number, number, number, number] | null;
}

interface ShapefileInsightPanelProps {
  layers: LayerPeta[];
  selectedLayerId: number | null;
  selectedFeatureId: number | null;
  onSelectFeature: (id: number | null) => void;
  onZoomToFeature?: (bbox: [number, number, number, number]) => void;
  selectedAfdelingId?: number | null;
  afdelingList?: { id: number; nama_afdeling: string; kode_afdeling: string }[];
  dataRevision?: number;
}

const STATUS_COLORS = ['#00D2FF', '#10B981', '#F59E0B', '#A78BFA', '#F472B6', '#38BDF8'];

function geometryBbox(geom: GeoJSON.Geometry | null): [number, number, number, number] | null {
  if (!geom) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  if ('coordinates' in geom) walk(geom.coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** Hitung keliling kasar (km) dari koordinat poligon WGS84 sebagai fallback jika Shape_Leng kosong */
function computeApproxPerimeterKm(geom: GeoJSON.Geometry | null): number {
  if (!geom || !('coordinates' in geom)) return 0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const haversineKm = (a: number[], b: number[]) => {
    const R = 6371;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const ringLen = (ring: number[][]) => {
    let sum = 0;
    for (let i = 1; i < ring.length; i++) {
      sum += haversineKm(ring[i - 1], ring[i]);
    }
    return sum;
  };
  if (geom.type === 'Polygon') {
    return ringLen(geom.coordinates[0] || []);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((acc, poly) => acc + ringLen(poly[0] || []), 0);
  }
  return 0;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const r = v / mag;
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  return step * mag;
}

const fmt = (v: number, d = 2) =>
  v.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });

export function ShapefileInsightPanel({
  layers,
  selectedLayerId,
  selectedFeatureId,
  onSelectFeature,
  onZoomToFeature,
  selectedAfdelingId = null,
  afdelingList = [],
  dataRevision,
}: ShapefileInsightPanelProps) {
  const [tab, setTab] = useState<InsightTab>('luas');
  const [records, setRecords] = useState<BlokRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoverId, setHoverId] = useState<number | null>(null);

  const targetLayers = useMemo(() => {
    if (selectedLayerId) {
      const found = layers.find((l) => l.id === selectedLayerId);
      if (found) return [found];
    }
    return layers.filter((l) => l.terlihat);
  }, [layers, selectedLayerId]);

  const targetLayerKey = useMemo(
    () => targetLayers.map((l) => l.id).join(','),
    [targetLayers]
  );

  // Ambil fitur poligon + jalankan Mesin Ekstraksi Multi-Kolom Universal
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (targetLayers.length === 0) {
        setRecords([]);
        return;
      }
      setLoading(true);
      const all: BlokRecord[] = [];
      for (const layer of targetLayers) {
        try {
          const res = await fetch(`/api/gis/geojson?layer_id=${layer.id}`);
          if (!res.ok) continue;
          const json = await res.json();
          const fc = json.data as GeoJSON.FeatureCollection | undefined;
          const polyFeatures = (fc?.features || []).filter(
            (f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
          );
          const isSingle = targetLayers.length === 1 && polyFeatures.length === 1;

          for (const f of polyFeatures) {
            if (
              selectedAfdelingId &&
              !isFeatureMatchingAfdeling(f, selectedAfdelingId, afdelingList, layer.kebun_id)
            ) {
              continue;
            }
            const p = (f.properties || {}) as Record<string, unknown>;
            const featId = Number(f.id ?? p._feature_id ?? 0);
            const approxPerim = computeApproxPerimeterKm(f.geometry);
            const intel = extractFeatureIntel(p, {
              featId,
              geomKelilingKm: approxPerim,
              layerName: layer.nama_layer,
              perusahaan: layer.perusahaan,
              namaKebun: layer.nama_kebun,
              wilayah: layer.wilayah,
              komoditas: layer.komoditas,
              isSingleBoundaryLayer: isSingle,
            });

            const afdLabel = intel.afdelingGroup || (isSingle ? 'Batas Konsesi' : 'Lainnya / Non-Blok');
            const effectiveStatus =
              intel.statusLahan ||
              (intel.afdelingGroup ? `Klaster ${intel.afdelingGroup}` : isSingle ? 'Batas Konsesi Kebun' : 'Areal Kebun');

            all.push({
              id: featId,
              layerId: layer.id,
              layerName: layer.nama_layer,
              name: intel.blokName,
              shortName: intel.shortName,
              afdelingGroup: afdLabel,
              afdelingColor: intel.afdelingColor,
              luasUkur: intel.luasUkurHa,
              luasUkurSource: intel.luasUkurSource,
              luasBaku: intel.luasBakuHa,
              selisihHa: intel.selisihHa,
              selisihPct: intel.selisihPct,
              auditStatus: intel.auditStatus,
              kelilingKm: intel.kelilingKm,
              status: effectiveStatus,
              tanaman: intel.tanaman || intel.commodity.shortLabel,
              varietas: intel.varietas,
              mt: intel.mt,
              luasTanam: intel.luasTanamHa,
              commodity: intel.commodity,
              estimasiPanenTon: intel.estimasiPanenTon,
              estimasiOlahanTon: intel.estimasiOlahanTon,
              bbox: geometryBbox(f.geometry),
            });
          }
        } catch (err) {
          console.error('Gagal memuat atribut shapefile:', err);
        }
      }

      // Urutkan sesuai nama blok alami (A1, A2, ..., GPA 1, GPA 2, ...)
      all.sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));
      if (!ignore) {
        setRecords(all);
        setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLayerKey, selectedAfdelingId, afdelingList, dataRevision]);

  const selectBlok = (r: BlokRecord) => {
    onSelectFeature(r.id);
    if (r.bbox && onZoomToFeature) onZoomToFeature(r.bbox);
  };

  // Ringkasan statistik lengkap
  const summary = useMemo(() => {
    const totalUkur = records.reduce((s, r) => s + r.luasUkur, 0);
    const withBaku = records.filter((r) => r.luasBaku !== null);
    const totalBaku = withBaku.reduce((s, r) => s + (r.luasBaku || 0), 0);
    const totalPanen = records.reduce((s, r) => s + r.estimasiPanenTon, 0);
    const totalOlahan = records.reduce((s, r) => s + (r.estimasiOlahanTon || 0), 0);
    const hasOlahan = records.some((r) => r.estimasiOlahanTon !== null);
    const sorted = [...records].sort((a, b) => b.luasUkur - a.luasUkur);
    const primaryCommodity = records[0]?.commodity || null;

    // Grup Status
    const statusMap = new Map<string, { luas: number; items: BlokRecord[] }>();
    for (const r of records) {
      const g = statusMap.get(r.status) || { luas: 0, items: [] };
      g.luas += r.luasUkur;
      g.items.push(r);
      statusMap.set(r.status, g);
    }
    const statusGroups = [...statusMap.entries()]
      .map(([status, g], i) => ({ status, ...g, color: STATUS_COLORS[i % STATUS_COLORS.length] }))
      .sort((a, b) => b.luas - a.luas);

    // Grup Afdeling
    const afdMap = new Map<
      string,
      { luasUkur: number; luasBaku: number; panen: number; color: string; items: BlokRecord[] }
    >();
    for (const r of records) {
      const g = afdMap.get(r.afdelingGroup) || {
        luasUkur: 0,
        luasBaku: 0,
        panen: 0,
        color: r.afdelingColor,
        items: [],
      };
      g.luasUkur += r.luasUkur;
      g.luasBaku += r.luasBaku || 0;
      g.panen += r.estimasiPanenTon;
      g.items.push(r);
      afdMap.set(r.afdelingGroup, g);
    }
    const afdelingGroups = [...afdMap.entries()]
      .map(([name, g]) => ({ name, ...g }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));

    const fields = [
      { label: 'Nama / Kode Blok', filled: records.filter((r) => !r.name.startsWith('Blok #') && !r.name.startsWith('Petak ')).length },
      { label: 'Luas Ukur GIS', filled: records.filter((r) => r.luasUkur > 0).length },
      { label: 'Luas Baku Legal', filled: withBaku.length },
      { label: 'Afdeling / Klaster', filled: records.filter((r) => r.afdelingGroup !== 'Lainnya / Non-Blok').length },
      { label: 'Varietas / MT', filled: records.filter((r) => Boolean(r.varietas || r.mt)).length },
    ];

    return {
      totalUkur,
      totalBaku,
      hasBaku: withBaku.length > 0,
      totalPanen,
      totalOlahan,
      hasOlahan,
      primaryCommodity,
      largest: sorted[0],
      smallest: sorted[sorted.length - 1],
      avg: records.length ? totalUkur / records.length : 0,
      statusGroups,
      afdelingGroups,
      fields,
      planted: records.filter((r) => r.varietas || r.mt || r.luasTanam !== null),
    };
  }, [records]);

  const isSingleBoundary = records.length === 1;

  const tabs: { id: InsightTab; label: string }[] = [
    { id: 'luas', label: 'Profil Luas Blok (Ha)' },
    { id: 'afdeling', label: 'Rekap Afdeling & Produksi' },
    { id: 'status', label: 'Status Pengelolaan Areal' },
    { id: 'varietas', label: 'Varietas, MT & Panen' },
  ];

  // ===== Grafik batang Luas Ukur vs Luas Baku =====
  const svgW = 640, svgH = 150, mL = 40, mR = 12, mT = 14, mB = 26;
  const plotW = svgW - mL - mR, plotH = svgH - mT - mB, zeroY = mT + plotH;
  const yMax = niceMax(
    Math.max(...records.map((r) => Math.max(r.luasUkur, r.luasBaku || 0)), 0.5)
  );
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  const groupW = records.length ? plotW / records.length : plotW;
  const barW = Math.min(18, groupW * (summary.hasBaku ? 0.34 : 0.52));

  const renderSingleBoundaryView = () => {
    const r = records[0];
    const efektifHa = Number((r.luasUkur * r.commodity.effectivePlantableRatio).toFixed(2));
    const luasM2 = Math.round(r.luasUkur * 10000);
    const kelilingM = Math.round(r.kelilingKm * 1000);

    return (
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto">
        {/* Kiri: Profil Konsesi Batas Luar */}
        <div className="md:col-span-5 bg-gradient-to-br from-[#0E3A5D]/80 to-[#12192B] border border-[#00B4D8]/60 rounded-xl p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider bg-[#00D2FF]/15 text-[#00D2FF] border border-[#00D2FF]/40">
                Batas Konsesi Kebun (Outer Perimeter)
              </span>
              <button
                type="button"
                onClick={() => selectBlok(r)}
                className="text-[10px] text-[#00D2FF] hover:underline font-semibold cursor-pointer"
              >
                Zoom ke Batas →
              </button>
            </div>
            <h4 className="text-base font-black text-white leading-tight">{r.name}</h4>
            <p className="text-[10.5px] text-[#94A3B8] mt-1 leading-relaxed">
              Layer ini berisi poligon batas terluar konsesi kebun (bukan petakan blok). Sistem mengekstrak luas total, panjang perimeter, potensi areal efektif tanam, serta estimasi produksi tahunan.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2.5 mt-2 border-t border-[#00B4D8]/30">
            <div>
              <div className="text-[9.5px] text-[#7DD3FC]">Luas Konsesi</div>
              <div className="text-sm sm:text-base font-black text-white font-mono tabular-nums">
                {fmt(r.luasUkur)} Ha
              </div>
              <div className="text-[9px] text-[#94A3B8] font-mono truncate">
                {luasM2.toLocaleString('id-ID')} m²
              </div>
            </div>
            <div>
              <div className="text-[9.5px] text-[#7DD3FC]">Keliling Batas</div>
              <div className="text-sm sm:text-base font-black text-[#00D2FF] font-mono tabular-nums">
                {fmt(r.kelilingKm)} km
              </div>
              <div className="text-[9px] text-[#94A3B8] font-mono truncate">
                {kelilingM.toLocaleString('id-ID')} m
              </div>
            </div>
            <div>
              <div className="text-[9.5px] text-[#7DD3FC]">Areal Efektif</div>
              <div className="text-sm sm:text-base font-black text-[#10B981] font-mono tabular-nums">
                {fmt(efektifHa)} Ha
              </div>
              <div className="text-[9px] text-[#6EE7B7] truncate">~85% Potensi</div>
            </div>
          </div>
        </div>

        {/* Kanan: Estimasi Produksi & Audit Spasial */}
        <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-2.5 content-start">
          <StatCard
            label="Komoditas Wilayah"
            value={r.commodity.shortLabel}
            note={r.commodity.label}
            accent
          />
          <StatCard
            label={`Est. ${r.commodity.yieldUnit}`}
            value={`${fmt(r.estimasiPanenTon, 1)} Ton`}
            note={`Basis ${fmt(efektifHa)} Ha × ${r.commodity.yieldPerHa} Ton/Ha`}
            emerald
          />
          {r.estimasiOlahanTon !== null && r.commodity.processedUnit ? (
            <StatCard
              label={r.commodity.processedLabel || 'Proyeksi Olahan'}
              value={`${fmt(r.estimasiOlahanTon, 2)} Ton`}
              note={r.commodity.processedUnit}
            />
          ) : (
            <StatCard
              label="Sumber Luas"
              value={r.luasUkurSource}
              note="Terverifikasi PostGIS"
            />
          )}
          <StatCard
            label="Areal Non-Tanam (15%)"
            value={`${fmt(r.luasUkur - efektifHa)} Ha`}
            note="Jalan, saluran & buffer"
          />
          <StatCard
            label="Rasio Keliling / Luas"
            value={r.luasUkur > 0 ? `${fmt(kelilingM / r.luasUkur, 0)} m/Ha` : '-'}
            note="Indikator kekompakan batas"
          />
          <StatCard
            label="Standar Agronomi"
            value={`${r.commodity.yieldPerHa} T/Ha`}
            note={r.commodity.standardSource}
          />
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-[#8B9BB4]">
          Memuat dan mengekstrak atribut layer dari PostGIS…
        </div>
      );
    }
    if (records.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-[#566680] text-center px-6">
          Belum ada layer poligon yang aktif pada filter ini. Unggah shapefile atau ubah filter untuk melihat analisis atributnya.
        </div>
      );
    }

    if (isSingleBoundary) {
      return renderSingleBoundaryView();
    }

    if (tab === 'luas') {
      const selisih = summary.totalUkur - summary.totalBaku;
      const selisihPct = summary.totalBaku > 0 ? (selisih / summary.totalBaku) * 100 : 0;
      const denseMode = records.length > 14;

      return (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto md:overflow-hidden">
          <div className="md:col-span-8 bg-[#12192B] border border-[#1E2942] rounded-xl p-2.5 flex flex-col min-h-[190px] md:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] px-1 mb-1">
              <span className="font-bold text-[#F0F6FC]">
                Luas per Blok ({records.length} poligon)
              </span>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-[#8B9BB4]">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#00D2FF]" />
                  Luas Ukur GIS
                </span>
                {summary.hasBaku && (
                  <span className="flex items-center gap-1 text-[#8B9BB4]">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B]" />
                    Luas Baku Dokumen
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 relative">
              <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                className="w-full h-full"
                preserveAspectRatio="xMidYMid meet"
              >
                {ticks.map((v, i) => {
                  const y = zeroY - (v / yMax) * plotH;
                  return (
                    <g key={i}>
                      <line
                        x1={mL}
                        x2={svgW - mR}
                        y1={y}
                        y2={y}
                        stroke="#1E2942"
                        strokeDasharray={i === 0 ? undefined : '2 3'}
                      />
                      <text
                        x={mL - 6}
                        y={y + 3}
                        textAnchor="end"
                        fill="#8B9BB4"
                        fontSize="9"
                        fontFamily="ui-monospace, monospace"
                      >
                        {v.toFixed(v < 1 && v > 0 ? 2 : 1)}
                      </text>
                    </g>
                  );
                })}
                <line x1={mL} x2={mL} y1={mT} y2={zeroY} stroke="#2C3B59" />
                {records.map((r, i) => {
                  const cx = mL + groupW * i + groupW / 2;
                  const isSel = r.id === selectedFeatureId;
                  const isHover = r.id === hoverId;
                  const hU = (r.luasUkur / yMax) * plotH;
                  const hB = ((r.luasBaku || 0) / yMax) * plotH;
                  const xU = summary.hasBaku ? cx - barW - 0.8 : cx - barW / 2;
                  const showTopVal = !denseMode || isSel || isHover || i % 2 === 0;
                  return (
                    <g
                      key={`${r.layerId}-${r.id}`}
                      className="cursor-pointer"
                      onClick={() => selectBlok(r)}
                      onMouseEnter={() => setHoverId(r.id)}
                      onMouseLeave={() => setHoverId(null)}
                    >
                      <rect
                        x={mL + groupW * i}
                        y={mT}
                        width={groupW}
                        height={plotH}
                        fill={isSel || isHover ? '#19233A' : 'transparent'}
                      />
                      <rect
                        x={xU}
                        y={zeroY - hU}
                        width={barW}
                        height={hU}
                        rx={2}
                        fill="#00D2FF"
                        opacity={isSel ? 1 : 0.85}
                        stroke={isSel ? '#FFFFFF' : 'none'}
                      />
                      {summary.hasBaku && r.luasBaku !== null && (
                        <rect
                          x={cx + 0.8}
                          y={zeroY - hB}
                          width={barW}
                          height={hB}
                          rx={2}
                          fill="#F59E0B"
                          opacity={isSel ? 1 : 0.8}
                        />
                      )}
                      {showTopVal && (
                        <text
                          x={cx}
                          y={zeroY - Math.max(hU, hB) - 3}
                          textAnchor="middle"
                          fill="#F0F6FC"
                          fontSize={denseMode ? '7' : '8.5'}
                          fontFamily="ui-monospace, monospace"
                        >
                          {fmt(r.luasUkur, denseMode ? 1 : 2)}
                        </text>
                      )}
                      <text
                        x={cx}
                        y={zeroY + 12}
                        textAnchor="middle"
                        fill={isSel ? '#00D2FF' : '#8B9BB4'}
                        fontSize={denseMode ? '7' : '8.5'}
                        fontWeight={isSel ? 700 : 400}
                      >
                        {denseMode ? r.shortName.slice(0, 6) : r.shortName}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {hoverId !== null &&
                (() => {
                  const r = records.find((x) => x.id === hoverId);
                  if (!r) return null;
                  return (
                    <div className="absolute top-0 right-1 bg-[#0D1322] border border-[#00D2FF] rounded-md px-2.5 py-1.5 text-[10px] space-y-0.5 pointer-events-none shadow-xl z-10">
                      <div className="font-bold text-[#F0F6FC] flex items-center gap-1.5">
                        <span>{r.name}</span>
                        <span className="text-[9px] text-[#8B9BB4] font-normal">
                          · {r.afdelingGroup}
                        </span>
                      </div>
                      <div className="text-[#00D2FF] tabular-nums">
                        Luas ukur: {fmt(r.luasUkur)} Ha
                      </div>
                      {r.luasBaku !== null && (
                        <div className="text-[#F59E0B] tabular-nums">
                          Luas baku: {fmt(r.luasBaku)} Ha{' '}
                          {r.selisihPct !== null
                            ? `(${r.selisihPct >= 0 ? '+' : ''}${fmt(r.selisihPct, 1)}%)`
                            : ''}
                        </div>
                      )}
                      <div className="text-[#10B981] tabular-nums">
                        Est. panen: {fmt(r.estimasiPanenTon, 1)} {r.commodity.yieldUnit}
                      </div>
                      <div className="text-[#566680]">Klik untuk zoom ke blok</div>
                    </div>
                  );
                })()}
            </div>
          </div>

          <div className="md:col-span-4 grid grid-cols-2 gap-2 content-start md:overflow-y-auto">
            <StatCard label="Total Luas Ukur" value={`${fmt(summary.totalUkur)} Ha`} accent />
            {summary.hasBaku ? (
              <StatCard
                label="Audit Luas Baku"
                value={`${fmt(summary.totalBaku)} Ha`}
                note={`Selisih ${selisih >= 0 ? '+' : ''}${fmt(selisih)} Ha (${selisihPct >= 0 ? '+' : ''}${fmt(selisihPct, 1)}%)`}
              />
            ) : (
              <StatCard label="Jumlah Blok" value={`${records.length}`} note="Poligon aktif" />
            )}
            <StatCard
              label="Est. Hasil Panen"
              value={`${fmt(summary.totalPanen, 1)} T`}
              note={summary.primaryCommodity?.yieldUnit || 'Ton Hasil'}
              emerald
            />
            {summary.hasOlahan && summary.primaryCommodity?.processedUnit ? (
              <StatCard
                label={summary.primaryCommodity.processedLabel || 'Hasil Olahan'}
                value={`${fmt(summary.totalOlahan, 2)} T`}
                note={summary.primaryCommodity.processedUnit}
              />
            ) : (
              <StatCard
                label="Rata-rata / Blok"
                value={`${fmt(summary.avg)} Ha`}
                note={`${records.length} blok`}
              />
            )}
            <StatCard
              label="Blok Terluas"
              value={`${fmt(summary.largest?.luasUkur || 0)} Ha`}
              note={summary.largest?.name}
            />
            <StatCard
              label="Blok Terkecil"
              value={`${fmt(summary.smallest?.luasUkur || 0)} Ha`}
              note={summary.smallest?.name}
            />
          </div>
        </div>
      );
    }

    if (tab === 'afdeling') {
      const maxAfdLuas = Math.max(...summary.afdelingGroups.map((g) => g.luasUkur), 1);
      return (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto md:overflow-hidden">
          <div className="md:col-span-5 bg-[#12192B] border border-[#1E2942] rounded-xl p-3 flex flex-col gap-2.5 md:overflow-y-auto">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-[#F0F6FC]">
                Rekap Luas &amp; Produksi per Afdeling
              </span>
              <span className="text-[9.5px] font-mono text-[#00D2FF]">
                {summary.afdelingGroups.length} Klaster
              </span>
            </div>
            <div className="space-y-2.5">
              {summary.afdelingGroups.map((g) => {
                const pct = summary.totalUkur > 0 ? (g.luasUkur / summary.totalUkur) * 100 : 0;
                const barPct = (g.luasUkur / maxAfdLuas) * 100;
                return (
                  <div key={g.name} className="space-y-1">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="flex items-center gap-1.5 font-semibold text-[#F0F6FC]">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ background: g.color }}
                        />
                        <span>{g.name}</span>
                        <span className="text-[9.5px] text-[#64748B] font-normal">
                          ({g.items.length} blok)
                        </span>
                      </span>
                      <span className="font-mono tabular-nums text-[10px]">
                        <span className="font-bold text-[#F0F6FC]">{fmt(g.luasUkur)} Ha</span>
                        <span className="text-[#8B9BB4]"> · {fmt(pct, 1)}%</span>
                        <span className="text-[#10B981]"> · {fmt(g.panen, 0)} T</span>
                      </span>
                    </div>
                    <div className="h-2 bg-[#0A0E1A] rounded-full overflow-hidden border border-[#1E2942]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${barPct}%`, background: g.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className={`md:col-span-7 grid grid-cols-1 ${
              summary.afdelingGroups.length > 1 ? 'sm:grid-cols-2' : ''
            } gap-2 md:overflow-y-auto content-start`}
          >
            {summary.afdelingGroups.map((g) => (
              <div
                key={g.name}
                className="bg-[#12192B] border border-[#1E2942] rounded-xl p-2.5"
                style={{ borderTopColor: g.color, borderTopWidth: 2 }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-[#F0F6FC] truncate">{g.name}</span>
                  <span className="text-[9.5px] font-mono text-[#10B981] tabular-nums">
                    Est. {fmt(g.panen, 1)} T
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.items.map((r) => (
                    <button
                      key={`${r.layerId}-${r.id}`}
                      type="button"
                      onClick={() => selectBlok(r)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors cursor-pointer tabular-nums ${
                        r.id === selectedFeatureId
                          ? 'bg-[#0E3A5D] border-[#00D2FF] text-[#00D2FF]'
                          : 'bg-[#0A0E1A] border-[#1E2942] text-[#8B9BB4] hover:text-[#F0F6FC] hover:border-[#2C3B59]'
                      }`}
                      title={`${r.name} · ${fmt(r.luasUkur)} Ha — klik untuk zoom`}
                    >
                      {r.shortName} · {fmt(r.luasUkur)} Ha
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (tab === 'status') {
      return (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto md:overflow-hidden">
          <div className="md:col-span-5 bg-[#12192B] border border-[#1E2942] rounded-xl p-3 flex flex-col gap-3 md:overflow-y-auto">
            <span className="text-[11px] font-bold text-[#F0F6FC]">
              Komposisi Luas per Status Areal
            </span>
            <div className="h-5 w-full rounded-md overflow-hidden flex border border-[#1E2942]">
              {summary.statusGroups.map((g) => (
                <div
                  key={g.status}
                  style={{
                    width: `${(g.luas / (summary.totalUkur || 1)) * 100}%`,
                    background: g.color,
                  }}
                  title={`${g.status}: ${fmt(g.luas)} Ha`}
                />
              ))}
            </div>
            <div className="space-y-2">
              {summary.statusGroups.map((g) => {
                const pct = (g.luas / (summary.totalUkur || 1)) * 100;
                return (
                  <div key={g.status} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ background: g.color }}
                      />
                      <span className="text-[#F0F6FC] font-semibold truncate">{g.status}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[#8B9BB4] shrink-0">
                      <span className="text-[#F0F6FC] font-bold">{fmt(g.luas)} Ha</span> ·{' '}
                      {fmt(pct, 1)}% · {g.items.length} blok
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className={`md:col-span-7 grid grid-cols-1 ${
              summary.statusGroups.length > 1 ? 'sm:grid-cols-2' : ''
            } gap-2 md:overflow-y-auto content-start`}
          >
            {summary.statusGroups.map((g) => (
              <div
                key={g.status}
                className="bg-[#12192B] border border-[#1E2942] rounded-xl p-2.5"
                style={{ borderTopColor: g.color, borderTopWidth: 2 }}
              >
                <div
                  className="text-[11px] font-bold text-[#F0F6FC] mb-1.5 truncate"
                  title={g.status}
                >
                  {g.status}
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.items.map((r) => (
                    <button
                      key={`${r.layerId}-${r.id}`}
                      type="button"
                      onClick={() => selectBlok(r)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors cursor-pointer tabular-nums ${
                        r.id === selectedFeatureId
                          ? 'bg-[#0E3A5D] border-[#00D2FF] text-[#00D2FF]'
                          : 'bg-[#0A0E1A] border-[#1E2942] text-[#8B9BB4] hover:text-[#F0F6FC] hover:border-[#2C3B59]'
                      }`}
                      title={`${r.name} — klik untuk zoom`}
                    >
                      {r.shortName} · {fmt(r.luasUkur)} Ha
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // tab === 'varietas' (Varietas, MT, Audit & Estimasi Panen)
    return (
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0 overflow-y-auto md:overflow-hidden">
        <div className="md:col-span-4 flex flex-col gap-2 md:overflow-y-auto">
          <div className="bg-gradient-to-br from-[#0F241F] to-[#0E3A5D]/70 border border-[#10B981]/50 rounded-xl p-2.5">
            <div className="text-[10px] text-[#6EE7B7] font-semibold">
              Proyeksi Total Produksi ({summary.primaryCommodity?.shortLabel || 'Kebun'})
            </div>
            <div className="text-lg font-black text-white font-mono tabular-nums mt-0.5">
              {fmt(summary.totalPanen, 1)}{' '}
              <span className="text-[10px] font-semibold text-[#6EE7B7]">
                {summary.primaryCommodity?.yieldUnit}
              </span>
            </div>
            {summary.hasOlahan && summary.primaryCommodity?.processedUnit && (
              <div className="text-[10px] text-[#7DD3FC] font-mono tabular-nums mt-0.5">
                {summary.primaryCommodity.processedLabel}:{' '}
                <strong className="text-[#00D2FF]">
                  {fmt(summary.totalOlahan, 2)} {summary.primaryCommodity.processedUnit}
                </strong>
              </div>
            )}
            {summary.planted.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-[#10B981]/20 space-y-0.5">
                {summary.planted.slice(0, 3).map((r) => (
                  <div key={r.id} className="text-[10px] text-[#F0F6FC]">
                    {r.name}: <span className="text-[#00D2FF] font-bold">{r.varietas || '—'}</span>
                    {r.mt && <> · MT {formatMasaTanam(r.mt)}</>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-[#12192B] border border-[#1E2942] rounded-xl p-2.5 space-y-1.5">
            <div className="text-[10px] font-bold text-[#8B9BB4]">Kelengkapan Ekstraksi Atribut</div>
            {summary.fields.map((f) => {
              const pct = records.length ? (f.filled / records.length) * 100 : 0;
              return (
                <div key={f.label} className="text-[10px]">
                  <div className="flex justify-between text-[#8B9BB4]">
                    <span>{f.label}</span>
                    <span className="tabular-nums text-[#F0F6FC]">
                      {f.filled}/{records.length}
                    </span>
                  </div>
                  <div className="h-1 bg-[#0A0E1A] rounded mt-0.5">
                    <div
                      className="h-1 rounded"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#64748B',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-8 bg-[#12192B] border border-[#1E2942] rounded-xl overflow-x-auto md:overflow-auto min-h-[160px] md:min-h-0">
          <table className="w-full text-[10.5px]">
            <thead className="sticky top-0 bg-[#0D1322] text-[#8B9BB4]">
              <tr>
                {[
                  'Blok',
                  'Afdeling',
                  'Komoditas / Varietas',
                  'Luas Ukur',
                  'Luas Baku & Audit',
                  'Est. Panen',
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left font-semibold px-2.5 py-1.5 border-b border-[#1E2942] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr
                  key={`${r.layerId}-${r.id}`}
                  onClick={() => selectBlok(r)}
                  className={`cursor-pointer border-b border-[#1E2942]/50 ${
                    r.id === selectedFeatureId ? 'bg-[#0E3A5D]' : 'hover:bg-[#19233A]'
                  }`}
                >
                  <td className="px-2.5 py-1 text-[#F0F6FC] font-semibold whitespace-nowrap">
                    {r.name}
                  </td>
                  <td className="px-2.5 py-1 whitespace-nowrap">
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-medium"
                      style={{ color: r.afdelingColor }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: r.afdelingColor }}
                      />
                      {r.afdelingGroup}
                    </span>
                  </td>
                  <td className="px-2.5 py-1 whitespace-nowrap">
                    {r.varietas ? (
                      <span className="text-[#00D2FF] font-bold">
                        {r.varietas}
                        {r.mt ? ` · MT ${r.mt}` : ''}
                      </span>
                    ) : (
                      <span className="text-[#8B9BB4]">{r.tanaman}</span>
                    )}
                  </td>
                  <td className="px-2.5 py-1 tabular-nums font-mono text-[#F0F6FC] whitespace-nowrap">
                    {fmt(r.luasUkur)} Ha
                  </td>
                  <td className="px-2.5 py-1 tabular-nums font-mono whitespace-nowrap">
                    {r.luasBaku !== null ? (
                      <span>
                        <span className="text-[#CBD5E1]">{fmt(r.luasBaku)} Ha</span>
                        {r.selisihPct !== null && (
                          <span
                            className={`ml-1 text-[9.5px] font-bold ${
                              r.auditStatus === 'sesuai'
                                ? 'text-[#10B981]'
                                : r.auditStatus === 'lebih'
                                ? 'text-[#00D2FF]'
                                : 'text-[#F59E0B]'
                            }`}
                          >
                            ({r.selisihPct >= 0 ? '+' : ''}
                            {fmt(r.selisihPct, 1)}%)
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[#566680]">—</span>
                    )}
                  </td>
                  <td className="px-2.5 py-1 tabular-nums font-mono text-[#10B981] font-bold whitespace-nowrap">
                    {fmt(r.estimasiPanenTon, 1)} T
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {renderBody()}
      {!isSingleBoundary && (
        <div className="min-h-10 lg:h-9 px-3 sm:px-4 py-1 lg:py-0 bg-[#0D1322] border-t border-[#1E2942] flex items-center justify-between shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`min-h-8 lg:min-h-0 px-3 py-1 rounded text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                  tab === t.id
                    ? 'bg-[#132238] border border-[#00D2FF] text-[#00D2FF] font-bold'
                    : 'text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-[#8B9BB4] font-mono hidden lg:block">
            Ekstraksi Multi-Kolom · {records.length} poligon · {fmt(summary.totalUkur)} Ha · Est.{' '}
            {fmt(summary.totalPanen, 0)} Ton
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  accent,
  emerald,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
  emerald?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-2 border ${
        accent
          ? 'bg-[#0E3A5D] border-[#00B4D8]'
          : emerald
          ? 'bg-[#0F241F] border-[#10B981]/50'
          : 'bg-[#12192B] border-[#1E2942]'
      }`}
    >
      <div
        className={`text-[9.5px] font-semibold ${
          accent ? 'text-[#7DD3FC]' : emerald ? 'text-[#6EE7B7]' : 'text-[#8B9BB4]'
        }`}
      >
        {label}
      </div>
      <div
        className={`text-sm font-black tabular-nums leading-tight ${
          emerald ? 'text-[#10B981]' : 'text-[#F0F6FC]'
        }`}
      >
        {value}
      </div>
      {note && (
        <div className="text-[9px] text-[#64748B] truncate" title={note}>
          {note}
        </div>
      )}
    </div>
  );
}
