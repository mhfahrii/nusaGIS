'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { LayerPeta } from '@/types/gis';

type InsightTab = 'luas' | 'status' | 'varietas';

interface BlokRecord {
  id: number;
  layerId: number;
  name: string;
  shortName: string;
  luasUkur: number;
  luasBaku: number | null;
  status: string;
  tanaman: string;
  varietas: string;
  mt: string;
  luasTanam: number | null;
  bbox: [number, number, number, number] | null;
}

import { isFeatureMatchingAfdeling } from './MonitoringMap';

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

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const STATUS_COLORS = ['#00D2FF', '#10B981', '#F59E0B', '#A78BFA', '#F472B6', '#38BDF8'];

/** Angka Indonesia "2,31 Ha" -> 2.31 */
function parseHa(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/\s/g, '').match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** PopupInfo KMZ/ArcGIS ("Kunci : Nilai" per baris) -> objek dengan kunci huruf kecil */
function parsePopupInfo(text: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof text !== 'string') return out;
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return out;
}

function pick(props: Record<string, unknown>, popup: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = props[k] ?? props[k.toUpperCase()] ?? popup[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function formatMT(mt: string): string {
  const m = mt.match(/^(\d{1,2})\s*\/\s*(\d{2,4})$/);
  if (!m) return mt;
  const bulan = BULAN[parseInt(m[1], 10) - 1];
  const tahun = m[2].length === 2 ? `20${m[2]}` : m[2];
  return bulan ? `${bulan} ${tahun}` : mt;
}

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

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const r = v / mag;
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  return step * mag;
}

const fmt = (v: number, d = 2) => v.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });

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

  const targetLayerIds = useMemo(() => {
    if (selectedLayerId) return [selectedLayerId];
    return layers.filter((l) => l.terlihat).map((l) => l.id);
  }, [layers, selectedLayerId]);

  // Ambil fitur poligon + atribut DBF asli dari PostGIS
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (targetLayerIds.length === 0) {
        setRecords([]);
        return;
      }
      setLoading(true);
      const all: BlokRecord[] = [];
      for (const layerId of targetLayerIds) {
        try {
          const res = await fetch(`/api/gis/geojson?layer_id=${layerId}`);
          if (!res.ok) continue;
          const json = await res.json();
          const fc = json.data as GeoJSON.FeatureCollection | undefined;
          for (const f of fc?.features || []) {
            const t = f.geometry?.type;
            if (t !== 'Polygon' && t !== 'MultiPolygon') continue;
            if (selectedAfdelingId && !isFeatureMatchingAfdeling(f, selectedAfdelingId, afdelingList)) {
              continue;
            }
            const p = (f.properties || {}) as Record<string, unknown>;
            const popup = parsePopupInfo(p.PopupInfo ?? p.popupinfo);
            const rawName = pick(p, popup, ['Name', 'nama_blok', 'kode_blok', '_label']) || `Fitur #${f.id}`;
            const name = rawName.replace(/;\s*[0-9.,]+\s*Ha\s*$/i, '').trim();
            const luasAttr = parseFloat(String(p.luas ?? p.Luas ?? p.LUAS ?? p.luas_ha ?? ''));
            const luasUkur = Number.isFinite(luasAttr) && luasAttr > 0 ? luasAttr : Number(p._luas_geodesik_ha || 0);
            all.push({
              id: Number(f.id ?? p._feature_id),
              layerId,
              name,
              shortName: name.split(' (')[0].slice(0, 12),
              luasUkur,
              luasBaku: parseHa(pick(p, popup, ['Luas Baku', 'luas_baku'])),
              status: pick(p, popup, ['Status Lahan', 'status_lahan']) || 'Tidak diisi',
              tanaman: pick(p, popup, ['Tanaman', 'komoditas']),
              varietas: pick(p, popup, ['Varietas', 'varietas']),
              mt: pick(p, popup, ['MT', 'masa_tanam']),
              luasTanam: parseHa(pick(p, popup, ['Luas Tanam', 'luas_tanam'])),
              bbox: geometryBbox(f.geometry),
            });
          }
        } catch (err) {
          console.error('Gagal memuat atribut shapefile:', err);
        }
      }
      // Urutkan sesuai nama blok (GPA 1, GPA 2, ...) agar mudah dibaca
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
  }, [targetLayerIds, selectedAfdelingId, afdelingList, dataRevision]);

  const selectBlok = (r: BlokRecord) => {
    onSelectFeature(r.id);
    if (r.bbox && onZoomToFeature) onZoomToFeature(r.bbox);
  };

  // Ringkasan statistik
  const summary = useMemo(() => {
    const totalUkur = records.reduce((s, r) => s + r.luasUkur, 0);
    const withBaku = records.filter((r) => r.luasBaku !== null);
    const totalBaku = withBaku.reduce((s, r) => s + (r.luasBaku || 0), 0);
    const sorted = [...records].sort((a, b) => b.luasUkur - a.luasUkur);
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
    const fields = [
      { label: 'Status Lahan', filled: records.filter((r) => r.status !== 'Tidak diisi').length },
      { label: 'Tanaman', filled: records.filter((r) => r.tanaman).length },
      { label: 'Luas Tanam', filled: records.filter((r) => r.luasTanam !== null).length },
      { label: 'Masa Tanam (MT)', filled: records.filter((r) => r.mt).length },
      { label: 'Varietas', filled: records.filter((r) => r.varietas).length },
    ];
    return {
      totalUkur,
      totalBaku,
      hasBaku: withBaku.length > 0,
      largest: sorted[0],
      smallest: sorted[sorted.length - 1],
      avg: records.length ? totalUkur / records.length : 0,
      statusGroups,
      fields,
      planted: records.filter((r) => r.varietas || r.mt || r.luasTanam !== null),
    };
  }, [records]);

  const tabs: { id: InsightTab; label: string }[] = [
    { id: 'luas', label: 'Profil Luas Blok (Ha)' },
    { id: 'status', label: 'Status Pengelolaan Areal' },
    { id: 'varietas', label: 'Rekap Varietas & Masa Tanam' },
  ];

  // ===== Grafik batang Luas Ukur vs Luas Baku =====
  const svgW = 640, svgH = 150, mL = 40, mR = 12, mT = 14, mB = 26;
  const plotW = svgW - mL - mR, plotH = svgH - mT - mB, zeroY = mT + plotH;
  const yMax = niceMax(Math.max(...records.map((r) => Math.max(r.luasUkur, r.luasBaku || 0)), 0.5));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  const groupW = records.length ? plotW / records.length : plotW;
  const barW = Math.min(18, groupW * (summary.hasBaku ? 0.32 : 0.5));

  const renderBody = () => {
    if (loading) {
      return <div className="flex-1 flex items-center justify-center text-xs text-[#8B9BB4]">Memuat atribut layer dari PostGIS…</div>;
    }
    if (records.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-[#566680] text-center px-6">
          Belum ada layer poligon yang aktif. Unggah shapefile atau aktifkan layer untuk melihat analisis atributnya.
        </div>
      );
    }

    if (tab === 'luas') {
      const selisih = summary.totalUkur - summary.totalBaku;
      return (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0 overflow-hidden">
          <div className="md:col-span-8 bg-[#12192B] border border-[#1E2942] rounded-xl p-2.5 flex flex-col min-h-0">
            <div className="flex items-center justify-between text-[11px] px-1 mb-1">
              <span className="font-bold text-[#F0F6FC]">Luas per Blok ({records.length} poligon)</span>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-[#8B9BB4]"><span className="w-2.5 h-2.5 rounded-sm bg-[#00D2FF]" />Luas Ukur GIS</span>
                {summary.hasBaku && (
                  <span className="flex items-center gap-1 text-[#8B9BB4]"><span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B]" />Luas Baku</span>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 relative">
              <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                {ticks.map((v, i) => {
                  const y = zeroY - (v / yMax) * plotH;
                  return (
                    <g key={i}>
                      <line x1={mL} x2={svgW - mR} y1={y} y2={y} stroke="#1E2942" strokeDasharray={i === 0 ? undefined : '2 3'} />
                      <text x={mL - 6} y={y + 3} textAnchor="end" fill="#8B9BB4" fontSize="9" fontFamily="ui-monospace, monospace">{v.toFixed(v < 1 && v > 0 ? 2 : 1)}</text>
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
                  const xU = summary.hasBaku ? cx - barW - 1 : cx - barW / 2;
                  return (
                    <g
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => selectBlok(r)}
                      onMouseEnter={() => setHoverId(r.id)}
                      onMouseLeave={() => setHoverId(null)}
                    >
                      <rect x={mL + groupW * i} y={mT} width={groupW} height={plotH} fill={isSel || isHover ? '#19233A' : 'transparent'} />
                      <rect x={xU} y={zeroY - hU} width={barW} height={hU} rx={2} fill="#00D2FF" opacity={isSel ? 1 : 0.85} stroke={isSel ? '#FFFFFF' : 'none'} />
                      {summary.hasBaku && r.luasBaku !== null && (
                        <rect x={cx + 1} y={zeroY - hB} width={barW} height={hB} rx={2} fill="#F59E0B" opacity={isSel ? 1 : 0.8} />
                      )}
                      <text x={cx} y={zeroY - Math.max(hU, hB) - 3} textAnchor="middle" fill="#F0F6FC" fontSize="8.5" fontFamily="ui-monospace, monospace">
                        {fmt(r.luasUkur)}
                      </text>
                      <text x={cx} y={zeroY + 12} textAnchor="middle" fill={isSel ? '#00D2FF' : '#8B9BB4'} fontSize="8.5" fontWeight={isSel ? 700 : 400}>
                        {r.shortName}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {hoverId !== null && (() => {
                const r = records.find((x) => x.id === hoverId);
                if (!r) return null;
                return (
                  <div className="absolute top-0 right-1 bg-[#0D1322] border border-[#00D2FF] rounded-md px-2 py-1 text-[10px] space-y-0.5 pointer-events-none shadow-xl">
                    <div className="font-bold text-[#F0F6FC]">{r.name}</div>
                    <div className="text-[#00D2FF] tabular-nums">Luas ukur: {fmt(r.luasUkur)} Ha</div>
                    {r.luasBaku !== null && <div className="text-[#F59E0B] tabular-nums">Luas baku: {fmt(r.luasBaku)} Ha</div>}
                    <div className="text-[#566680]">Klik untuk zoom ke blok</div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="md:col-span-4 grid grid-cols-2 gap-2 content-start overflow-y-auto">
            <StatCard label="Total Luas Ukur" value={`${fmt(summary.totalUkur)} Ha`} accent />
            {summary.hasBaku ? (
              <StatCard
                label="Total Luas Baku"
                value={`${fmt(summary.totalBaku)} Ha`}
                note={`Selisih ${selisih >= 0 ? '+' : ''}${fmt(selisih)} Ha (${summary.totalBaku ? fmt((selisih / summary.totalBaku) * 100, 1) : '0'}%)`}
              />
            ) : (
              <StatCard label="Jumlah Blok" value={`${records.length}`} />
            )}
            <StatCard label="Blok Terluas" value={`${fmt(summary.largest?.luasUkur || 0)} Ha`} note={summary.largest?.name} />
            <StatCard label="Blok Terkecil" value={`${fmt(summary.smallest?.luasUkur || 0)} Ha`} note={summary.smallest?.name} />
            <StatCard label="Rata-rata / Blok" value={`${fmt(summary.avg)} Ha`} note={`${records.length} blok`} />
            <div className="col-span-2 text-[9.5px] text-[#566680] leading-snug px-1">
              Luas ukur dari kolom <code className="text-[#8B9BB4]">luas</code> (ArcGIS Calculate Geometry). Luas baku dari catatan <code className="text-[#8B9BB4]">PopupInfo</code>.
            </div>
          </div>
        </div>
      );
    }

    if (tab === 'status') {
      return (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0 overflow-hidden">
          <div className="md:col-span-5 bg-[#12192B] border border-[#1E2942] rounded-xl p-3 flex flex-col gap-3">
            <span className="text-[11px] font-bold text-[#F0F6FC]">Komposisi Luas per Status Lahan</span>
            <div className="h-5 w-full rounded-md overflow-hidden flex border border-[#1E2942]">
              {summary.statusGroups.map((g) => (
                <div
                  key={g.status}
                  style={{ width: `${(g.luas / (summary.totalUkur || 1)) * 100}%`, background: g.color }}
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
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: g.color }} />
                      <span className="text-[#F0F6FC] font-semibold truncate">{g.status}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[#8B9BB4] shrink-0">
                      <span className="text-[#F0F6FC] font-bold">{fmt(g.luas)} Ha</span> · {fmt(pct, 1)}% · {g.items.length} blok
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="md:col-span-7 grid gap-2 overflow-y-auto content-start" style={{ gridTemplateColumns: `repeat(${Math.min(summary.statusGroups.length, 2)}, minmax(0, 1fr))` }}>
            {summary.statusGroups.map((g) => (
              <div key={g.status} className="bg-[#12192B] border border-[#1E2942] rounded-xl p-2.5" style={{ borderTopColor: g.color, borderTopWidth: 2 }}>
                <div className="text-[11px] font-bold text-[#F0F6FC] mb-1.5 truncate" title={g.status}>{g.status}</div>
                <div className="flex flex-wrap gap-1">
                  {g.items.map((r) => (
                    <button
                      key={r.id}
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

    // tab === 'varietas'
    return (
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0 overflow-hidden">
        <div className="md:col-span-4 flex flex-col gap-2 overflow-y-auto">
          <div className="bg-[#0E3A5D] border border-[#00B4D8] rounded-xl p-2.5">
            <div className="text-[10px] text-[#7DD3FC] font-semibold">Blok dengan data tanam</div>
            <div className="text-xl font-black text-white tabular-nums">
              {summary.planted.length} <span className="text-xs font-semibold text-[#7DD3FC]">dari {records.length} blok</span>
            </div>
            {summary.planted.map((r) => (
              <div key={r.id} className="text-[10px] text-[#F0F6FC] mt-1">
                {r.name}: <span className="text-[#00D2FF] font-bold">{r.varietas || '—'}</span>
                {r.mt && <> · MT {formatMT(r.mt)}</>}
              </div>
            ))}
          </div>
          <div className="bg-[#12192B] border border-[#1E2942] rounded-xl p-2.5 space-y-1.5">
            <div className="text-[10px] font-bold text-[#8B9BB4]">Kelengkapan atribut</div>
            {summary.fields.map((f) => {
              const pct = records.length ? (f.filled / records.length) * 100 : 0;
              return (
                <div key={f.label} className="text-[10px]">
                  <div className="flex justify-between text-[#8B9BB4]">
                    <span>{f.label}</span>
                    <span className="tabular-nums text-[#F0F6FC]">{f.filled}/{records.length}</span>
                  </div>
                  <div className="h-1 bg-[#0A0E1A] rounded mt-0.5">
                    <div className="h-1 rounded" style={{ width: `${pct}%`, background: pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-8 bg-[#12192B] border border-[#1E2942] rounded-xl overflow-auto min-h-0">
          <table className="w-full text-[10.5px]">
            <thead className="sticky top-0 bg-[#0D1322] text-[#8B9BB4]">
              <tr>
                {['Blok', 'Status Lahan', 'Varietas', 'Masa Tanam', 'Luas Tanam', 'Luas Ukur'].map((h) => (
                  <th key={h} className="text-left font-semibold px-2.5 py-1.5 border-b border-[#1E2942] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const empty = <span className="text-[#566680] italic">belum diisi</span>;
                return (
                  <tr
                    key={r.id}
                    onClick={() => selectBlok(r)}
                    className={`cursor-pointer border-b border-[#1E2942]/50 ${r.id === selectedFeatureId ? 'bg-[#0E3A5D]' : 'hover:bg-[#19233A]'}`}
                  >
                    <td className="px-2.5 py-1 text-[#F0F6FC] font-semibold whitespace-nowrap">{r.name}</td>
                    <td className="px-2.5 py-1 text-[#8B9BB4] whitespace-nowrap">{r.status}</td>
                    <td className="px-2.5 py-1 text-[#00D2FF] font-bold">{r.varietas || empty}</td>
                    <td className="px-2.5 py-1 text-[#F0F6FC] whitespace-nowrap">{r.mt ? `${r.mt} (${formatMT(r.mt)})` : empty}</td>
                    <td className="px-2.5 py-1 tabular-nums text-[#F0F6FC]">{r.luasTanam !== null ? `${fmt(r.luasTanam)} Ha` : empty}</td>
                    <td className="px-2.5 py-1 tabular-nums text-[#F0F6FC]">{fmt(r.luasUkur)} Ha</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {renderBody()}
      <div className="h-9 px-4 bg-[#0D1322] border-t border-[#1E2942] flex items-center justify-between shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                tab === t.id
                  ? 'bg-[#132238] border border-[#00D2FF] text-[#00D2FF] font-bold'
                  : 'text-[#8B9BB4] hover:text-[#F0F6FC] hover:bg-[#12192B]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-[#566680] font-mono hidden lg:block">
          Sumber: atribut DBF layer · {records.length} poligon · {fmt(summary.totalUkur)} Ha
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, note, accent }: { label: string; value: string; note?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-2 border ${accent ? 'bg-[#0E3A5D] border-[#00B4D8]' : 'bg-[#12192B] border-[#1E2942]'}`}>
      <div className={`text-[9.5px] font-semibold ${accent ? 'text-[#7DD3FC]' : 'text-[#8B9BB4]'}`}>{label}</div>
      <div className="text-sm font-black text-[#F0F6FC] tabular-nums leading-tight">{value}</div>
      {note && <div className="text-[9px] text-[#566680] truncate" title={note}>{note}</div>}
    </div>
  );
}

