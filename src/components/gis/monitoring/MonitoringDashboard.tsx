'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MonitoringHeader } from './MonitoringHeader';
import { MonitoringSidebar } from './MonitoringSidebar';
import { MonitoringRightPanel } from './MonitoringRightPanel';
import { MonitoringBottomPanel } from './MonitoringBottomPanel';
import { MonitoringMap } from './MonitoringMap';
import { GisUploadModal } from './GisUploadModal';
import SettingsModal from './SettingsModal';
import type { LayerPeta, LayerRaster, MonitoringStats } from '@/types/gis';

interface KebunItem {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  perusahaan?: string | null;
  wilayah: string | null;
}

interface AfdelingItem {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
}

interface BlokItem {
  id: number;
  afdeling_id: number;
  kode_blok: string;
  nama_blok: string;
}

const DEFAULT_PERUSAHAAN = 'PT Perkebunan Nusantara I (Regional 4)';

function normText(s?: string | null): string {
  return (s || '').trim().toLowerCase();
}

function computeUnionBbox(layerList: LayerPeta[]): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const l of layerList) {
    if (!l.bbox || l.bbox.length !== 4) continue;
    const [w, s, e, n] = l.bbox;
    if (
      !Number.isFinite(w) ||
      !Number.isFinite(s) ||
      !Number.isFinite(e) ||
      !Number.isFinite(n) ||
      Math.abs(w) > 180 ||
      Math.abs(e) > 180 ||
      Math.abs(s) > 90 ||
      Math.abs(n) > 90
    ) {
      continue;
    }
    minX = Math.min(minX, w);
    minY = Math.min(minY, s);
    maxX = Math.max(maxX, e);
    maxY = Math.max(maxY, n);
    found = true;
  }

  return found ? [minX, minY, maxX, maxY] : null;
}

export function MonitoringDashboard() {
  // Panel toggles
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [deletedCount, setDeletedCount] = useState<number>(0);

  // Time & Period state
  const selectedYear = '2026';
  const selectedMonth = 'November';

  // Master lists
  const [kebunList, setKebunList] = useState<KebunItem[]>([]);
  const [afdelingList, setAfdelingList] = useState<AfdelingItem[]>([]);
  const [blokList, setBlokList] = useState<BlokItem[]>([]);
  const [rawLayers, setRawLayers] = useState<LayerPeta[]>([]);
  const [rasterLayers, setRasterLayers] = useState<LayerRaster[]>([]);
  const [stats, setStats] = useState<MonitoringStats | null>(null);

  // Filter states
  const [selectedPerusahaan, setSelectedPerusahaan] = useState('');
  const [selectedWilayah, setSelectedWilayah] = useState('');
  const [selectedKebunId, setSelectedKebunId] = useState<number | null>(null);
  const [selectedAfdelingId, setSelectedAfdelingId] = useState<number | null>(null);
  const [selectedBlokId, setSelectedBlokId] = useState<number | null>(null);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'ktg' | 'ks_gpa'>('all');

  // Active map and selection states
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null);
  const [fitBoundsTarget, setFitBoundsTarget] = useState<[number, number, number, number] | null>(null);
  const [dataRevision, setDataRevision] = useState(0);

  // 1. Refresh seluruh master data (kebun, afdeling, blok, layers, rasters, stats, history)
  const refreshStatsAndLayers = useCallback(async () => {
    try {
      const params: string[] = [];
      if (selectedKebunId) params.push(`kebun_id=${selectedKebunId}`);
      else if (selectedWilayah) params.push(`wilayah=${encodeURIComponent(selectedWilayah)}`);
      if (selectedLayerId) params.push(`layer_id=${selectedLayerId}`);
      const statsQuery = params.length > 0 ? `?${params.join('&')}` : '';

      const [kRes, aRes, bRes, lRes, rRes, sRes, hRes] = await Promise.all([
        fetch('/api/kebun'),
        fetch('/api/afdeling'),
        fetch('/api/blok'),
        fetch('/api/gis/layers'),
        fetch('/api/gis/rasters'),
        fetch(`/api/stats${statsQuery}`),
        fetch('/api/gis/history'),
      ]);
      if (kRes.ok) {
        const kj = await kRes.json();
        setKebunList(kj.data || []);
      }
      if (aRes.ok) {
        const aj = await aRes.json();
        setAfdelingList(aj.data || []);
      }
      if (bRes.ok) {
        const bj = await bRes.json();
        setBlokList(bj.data || []);
      }
      if (lRes.ok) {
        const lj = await lRes.json();
        setRawLayers(lj.data || []);
      }
      if (rRes.ok) {
        const rj = await rRes.json();
        setRasterLayers(rj.data || []);
      }
      if (sRes.ok) {
        const sj = await sRes.json();
        setStats(sj.data || null);
      }
      if (hRes.ok) {
        const hj = await hRes.json();
        if (hj.status === 'success' && hj.data?.counts) {
          setDeletedCount(hj.data.counts.total_deleted || 0);
        }
      }
    } catch (err) {
      console.error('Failed to refresh layers and stats:', err);
    }
  }, [selectedWilayah, selectedKebunId, selectedLayerId]);

  // Reaktif perbarui statistik KPI saat filter Wilayah, Kebun, atau Layer berubah
  useEffect(() => {
    let ignore = false;
    async function updateStats() {
      try {
        const params: string[] = [];
        if (selectedKebunId) params.push(`kebun_id=${selectedKebunId}`);
        else if (selectedWilayah) params.push(`wilayah=${encodeURIComponent(selectedWilayah)}`);
        if (selectedLayerId) params.push(`layer_id=${selectedLayerId}`);
        const statsQuery = params.length > 0 ? `?${params.join('&')}` : '';
        const sRes = await fetch(`/api/stats${statsQuery}`);
        if (sRes.ok && !ignore) {
          const sj = await sRes.json();
          setStats(sj.data || null);
        }
      } catch (err) {
        console.error('Failed to update stats:', err);
      }
    }
    updateStats();
    return () => {
      ignore = true;
    };
  }, [selectedWilayah, selectedKebunId, selectedLayerId]);

  useEffect(() => {
    let ignore = false;
    async function loadMasterData() {
      try {
        const statsQuery = selectedKebunId ? `?kebun_id=${selectedKebunId}` : '';
        const [kRes, aRes, bRes, lRes, rRes, sRes] = await Promise.all([
          fetch('/api/kebun'),
          fetch('/api/afdeling'),
          fetch('/api/blok'),
          fetch('/api/gis/layers'),
          fetch('/api/gis/rasters'),
          fetch(`/api/stats${statsQuery}`),
        ]);

        if (!ignore) {
          if (kRes.ok) {
            const kj = await kRes.json();
            setKebunList(kj.data || []);
          }
          if (aRes.ok) {
            const aj = await aRes.json();
            setAfdelingList(aj.data || []);
          }
          if (bRes.ok) {
            const bj = await bRes.json();
            setBlokList(bj.data || []);
          }
          if (lRes.ok) {
            const lj = await lRes.json();
            const data: LayerPeta[] = lj.data || [];
            setRawLayers(data);
            setSelectedLayerId((prev) => {
              if (prev) return prev;
              const urlParams =
                typeof window !== 'undefined'
                  ? new URLSearchParams(window.location.search)
                  : null;
              const paramLayerId = urlParams?.get('layer_id')
                ? Number(urlParams.get('layer_id'))
                : null;
              const paramKebunId = urlParams?.get('kebun_id')
                ? Number(urlParams.get('kebun_id'))
                : null;

              const defaultL =
                (paramLayerId && data.find((l) => l.id === paramLayerId)) ||
                (paramKebunId && data.find((l) => l.kebun_id === paramKebunId)) ||
                data.find((l) => l.terlihat && l.bbox) ||
                data[0];

              if (defaultL?.bbox) {
                setFitBoundsTarget(defaultL.bbox);
              }
              return defaultL ? defaultL.id : null;
            });
          }
          if (rRes.ok) {
            const rj = await rRes.json();
            setRasterLayers(rj.data || []);
          }
          if (sRes.ok) {
            const sj = await sRes.json();
            setStats(sj.data || null);
          }
        }
      } catch (err) {
        console.error('Failed to load master dashboard data:', err);
      }
    }

    loadMasterData();
    return () => {
      ignore = true;
    };
  }, [selectedKebunId]);

  // Helper: cocokkan layer terhadap filter hirarki (cek langsung kolom layer & master kebunList agar tidak pernah terlewat meski kebunList baru dibuat)
  const filterLayersByCriteria = useCallback(
    (
      layersToFilter: LayerPeta[],
      criteria: {
        perusahaan?: string;
        wilayah?: string;
        kebunId?: number | null;
        afdelingId?: number | null;
        blokId?: number | null;
      }
    ) => {
      const kebunById = new Map<number, KebunItem>();
      for (const k of kebunList) {
        kebunById.set(Number(k.id), k);
      }

      const targetPerusahaan = normText(criteria.perusahaan);
      const targetWilayah = normText(criteria.wilayah);

      // Jika Afdeling dipilih, identifikasi Kebun induk dari Afdeling tersebut agar layer kebun/wilayah lain (misal Bandung) TIDAK ikut tampil!
      const matchedAfd =
        criteria.afdelingId && criteria.afdelingId > 0
          ? afdelingList.find((a) => Number(a.id) === Number(criteria.afdelingId))
          : undefined;
      const afdParentKebunId = matchedAfd?.kebun_id ? Number(matchedAfd.kebun_id) : null;

      return layersToFilter.filter((l) => {
        const matchKebun = l.kebun_id ? kebunById.get(Number(l.kebun_id)) : undefined;

        // Filter Perusahaan
        if (targetPerusahaan) {
          const layerPerusahaan = normText(
            l.perusahaan || matchKebun?.perusahaan || DEFAULT_PERUSAHAAN
          );
          if (layerPerusahaan !== targetPerusahaan) {
            return false;
          }
        }

        // Filter Wilayah
        if (targetWilayah) {
          const layerWilayah = normText(l.wilayah || matchKebun?.wilayah);
          if (layerWilayah !== targetWilayah) {
            return false;
          }
        }

        // Filter Kebun
        if (criteria.kebunId && Number(l.kebun_id) !== Number(criteria.kebunId)) {
          return false;
        }

        // Filter Afdeling:
        // 1) Wajib cocok dengan kebun induk milik Afdeling terpilih (cegah Afdeling Bakalan mengarah ke Kebun Bandung!)
        if (afdParentKebunId && Number(l.kebun_id) !== afdParentKebunId) {
          return false;
        }
        // 2) Jika layer memang eksplisit milik afdeling DB lain, sembunyikan
        if (
          criteria.afdelingId &&
          criteria.afdelingId > 0 &&
          l.afdeling_id &&
          Number(l.afdeling_id) !== Number(criteria.afdelingId)
        ) {
          return false;
        }

        // Filter Blok
        if (criteria.blokId && l.blok_id && Number(l.blok_id) !== Number(criteria.blokId)) {
          return false;
        }

        return true;
      });
    },
    [kebunList, afdelingList]
  );

  // 2. Filter layers based on cascading filter
  const displayedLayers = useMemo(() => {
    return filterLayersByCriteria(rawLayers, {
      perusahaan: selectedPerusahaan,
      wilayah: selectedWilayah,
      kebunId: selectedKebunId,
      afdelingId: selectedAfdelingId,
      blokId: selectedBlokId,
    });
  }, [
    filterLayersByCriteria,
    rawLayers,
    selectedPerusahaan,
    selectedWilayah,
    selectedKebunId,
    selectedAfdelingId,
    selectedBlokId,
  ]);

  // 2B. Gabungkan daftar Afdeling DB dengan klaster Afdeling otomatis hasil ekstraksi DBF (misal Afdeling A, B, C, Kebun Rakyat pada Kebun Sarongge)
  const effectiveAfdelingList = useMemo<AfdelingItem[]>(() => {
    const merged: AfdelingItem[] = [...afdelingList];
    const breakdown = stats?.afdeling_breakdown || [];
    if (breakdown.length === 0) return merged;

    const targetKebunId =
      selectedKebunId ||
      displayedLayers.find((l) => l.kebun_id)?.kebun_id ||
      kebunList[0]?.id ||
      0;

    let virtualId = -1;
    for (const item of breakdown) {
      const exists = merged.some(
        (a) =>
          (!targetKebunId || a.kebun_id === targetKebunId) &&
          a.nama_afdeling.trim().toLowerCase() === item.name.trim().toLowerCase()
      );
      if (!exists) {
        merged.push({
          id: virtualId--,
          kebun_id: targetKebunId,
          kode_afdeling: `${item.count} blok · ${item.luas_ukur_ha} Ha`,
          nama_afdeling: item.name,
        });
      }
    }
    return merged;
  }, [afdelingList, stats?.afdeling_breakdown, selectedKebunId, displayedLayers, kebunList]);

  // Handler Perusahaan (cascading reset + zoom ke cakupan perusahaan)
  const handleSelectPerusahaan = useCallback(
    (perusahaanVal: string) => {
      setSelectedPerusahaan(perusahaanVal);
      setSelectedWilayah('');
      setSelectedKebunId(null);
      setSelectedAfdelingId(null);
      setSelectedBlokId(null);
      setSelectedFeatureId(null);

      const matching = filterLayersByCriteria(rawLayers, { perusahaan: perusahaanVal });
      const visible = matching.filter((l) => l.terlihat);
      const targetPool = visible.length > 0 ? visible : matching;
      setSelectedLayerId(targetPool[0]?.id ?? null);
      const bbox = computeUnionBbox(targetPool);
      if (bbox) {
        setFitBoundsTarget([...bbox]);
      }
    },
    [filterLayersByCriteria, rawLayers]
  );

  // Handler Wilayah (cascading reset + sinkron layer aktif + arahkan peta ke lokasi wilayah)
  const handleSelectWilayah = useCallback(
    (wilayahVal: string) => {
      setSelectedWilayah(wilayahVal);
      setSelectedKebunId(null);
      setSelectedAfdelingId(null);
      setSelectedBlokId(null);
      setSelectedFeatureId(null);

      const matching = filterLayersByCriteria(rawLayers, {
        perusahaan: selectedPerusahaan,
        wilayah: wilayahVal,
      });
      const visible = matching.filter((l) => l.terlihat);
      const targetPool = visible.length > 0 ? visible : matching;

      setSelectedLayerId(targetPool[0]?.id ?? null);

      const bbox = computeUnionBbox(targetPool);
      if (bbox) {
        setFitBoundsTarget([...bbox]);
      } else if (!wilayahVal) {
        const fallbackBbox = computeUnionBbox(rawLayers);
        if (fallbackBbox) {
          setFitBoundsTarget([...fallbackBbox]);
        }
      }
    },
    [filterLayersByCriteria, rawLayers, selectedPerusahaan]
  );

  // Handler Kebun (cascading reset + zoom gabungan seluruh layer kebun)
  const handleSelectKebun = useCallback(
    (id: number | null) => {
      setSelectedKebunId(id);
      setSelectedAfdelingId(null);
      setSelectedBlokId(null);
      setSelectedFeatureId(null);

      const matching = filterLayersByCriteria(rawLayers, {
        perusahaan: selectedPerusahaan,
        wilayah: selectedWilayah,
        kebunId: id,
      });
      const visible = matching.filter((l) => l.terlihat);
      const targetPool = visible.length > 0 ? visible : matching;

      if (targetPool.length > 0) {
        setSelectedLayerId(targetPool[0].id);
      } else if (id) {
        setSelectedLayerId(null);
      }

      const bbox = computeUnionBbox(targetPool);
      if (bbox) {
        setFitBoundsTarget([...bbox]);
      }
    },
    [filterLayersByCriteria, rawLayers, selectedPerusahaan, selectedWilayah]
  );

  // Handler Afdeling (pastikan fokus ke kebun induk milik afdeling + sinkron layer aktif & peta)
  const handleSelectAfdeling = useCallback(
    (id: number | null) => {
      setSelectedAfdelingId(id);
      setSelectedBlokId(null);
      setSelectedFeatureId(null);

      if (id) {
        const afd = effectiveAfdelingList.find((a) => Number(a.id) === Number(id));
        const targetKebun = afd?.kebun_id ? Number(afd.kebun_id) : selectedKebunId;
        const matching = filterLayersByCriteria(rawLayers, {
          perusahaan: selectedPerusahaan,
          wilayah: selectedWilayah,
          kebunId: targetKebun || null,
          afdelingId: id,
        });
        const visible = matching.filter((l) => l.terlihat);
        const targetPool = visible.length > 0 ? visible : matching;
        if (targetPool.length > 0) {
          setSelectedLayerId(targetPool[0].id);
        }
      } else {
        const matching = filterLayersByCriteria(rawLayers, {
          perusahaan: selectedPerusahaan,
          wilayah: selectedWilayah,
          kebunId: selectedKebunId,
        });
        const visible = matching.filter((l) => l.terlihat);
        const targetPool = visible.length > 0 ? visible : matching;
        if (targetPool.length > 0) {
          setSelectedLayerId(targetPool[0].id);
          const bbox = computeUnionBbox(targetPool);
          if (bbox) setFitBoundsTarget([...bbox]);
        }
      }
    },
    [
      effectiveAfdelingList,
      filterLayersByCriteria,
      rawLayers,
      selectedPerusahaan,
      selectedWilayah,
      selectedKebunId,
    ]
  );

  // Reset filters
  const handleResetFilters = () => {
    setSelectedPerusahaan('');
    setSelectedWilayah('');
    setSelectedKebunId(null);
    setSelectedAfdelingId(null);
    setSelectedBlokId(null);
    setSelectedFeatureId(null);
    const visible = rawLayers.filter((l) => l.terlihat);
    const pool = visible.length > 0 ? visible : rawLayers;
    if (pool.length > 0) {
      setSelectedLayerId(pool[0].id);
    }
    const bbox = computeUnionBbox(pool);
    if (bbox) {
      setFitBoundsTarget([...bbox]);
    }
  };

  // Toggle layer visibility
  const handleToggleLayerVisibility = async (layerId: number, visible: boolean) => {
    setRawLayers((prev) =>
      prev.map((l) => (l.id === layerId ? { ...l, terlihat: visible } : l))
    );
    try {
      await fetch('/api/gis/layers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: layerId, terlihat: visible }),
      });
    } catch (err) {
      console.error('Toggle visibility error:', err);
    }
  };

  // Toggle raster visibility
  const handleToggleRasterVisibility = async (rasterId: number, visible: boolean) => {
    setRasterLayers((prev) =>
      prev.map((r) => (r.id === rasterId ? { ...r, terlihat: visible } : r))
    );
    try {
      await fetch('/api/gis/rasters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rasterId, terlihat: visible }),
      });
    } catch (err) {
      console.error('Toggle raster visibility error:', err);
    }
  };

  // Change raster opacity
  const handleChangeRasterOpacity = async (rasterId: number, opacity: number) => {
    setRasterLayers((prev) =>
      prev.map((r) => (r.id === rasterId ? { ...r, transparansi: opacity } : r))
    );
    try {
      await fetch('/api/gis/rasters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rasterId, transparansi: opacity }),
      });
    } catch (err) {
      console.error('Change raster opacity error:', err);
    }
  };

  // Rename layer handler
  const handleRenameLayer = async (layerId: number, newName: string) => {
    try {
      const res = await fetch('/api/gis/layers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: layerId, nama_layer: newName }),
      });
      if (res.ok) {
        setRawLayers((prev) =>
          prev.map((l) => (l.id === layerId ? { ...l, nama_layer: newName } : l))
        );
      }
    } catch (err) {
      console.error('Failed to rename layer:', err);
    }
  };

  // Hapus 1 file/layer tertentu (dengan cascade update jika wilayah ikut terhapus)
  const handleDeleteLayer = async (layerId: number, layerName: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/gis/layers?id=${layerId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (res.ok && json.status === 'success') {
        setRawLayers((prev) => prev.filter((l) => l.id !== layerId));
        if (selectedLayerId === layerId) {
          setSelectedLayerId(null);
        }

        // Jika backend menandai bahwa wilayah ikut terhapus karena ini file terakhir
        if (json.data?.wilayahDeleted && json.data?.wilayah) {
          const wName = json.data.wilayah.trim().toLowerCase();
          setKebunList((prev) =>
            prev.filter((k) => (k.wilayah || '').trim().toLowerCase() !== wName)
          );
          if (selectedWilayah.trim().toLowerCase() === wName) {
            setSelectedWilayah('');
            setSelectedKebunId(null);
            setSelectedAfdelingId(null);
            setSelectedBlokId(null);
          }
        } else if (json.data?.kebunDeleted && json.data?.deletedKebunId) {
          setKebunList((prev) => prev.filter((k) => k.id !== json.data.deletedKebunId));
          if (selectedKebunId === json.data.deletedKebunId) {
            setSelectedKebunId(null);
            setSelectedAfdelingId(null);
            setSelectedBlokId(null);
          }
        }

        return true;
      } else {
        alert(json.detail || json.message || `Gagal menghapus layer "${layerName}".`);
        return false;
      }
    } catch (err) {
      console.error('Delete layer error:', err);
      alert(`Terjadi kesalahan saat menghapus layer "${layerName}".`);
      return false;
    }
  };

  // Hapus seluruh data pada satu wilayah
  const handleDeleteWilayah = async (wilayahName: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/gis/layers?wilayah=${encodeURIComponent(wilayahName)}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (res.ok && json.status === 'success') {
        const deletedLayerIds: number[] = json.data?.deletedLayerIds || [];
        const deletedKebunIds: number[] = json.data?.deletedKebunIds || [];
        const wName = wilayahName.trim().toLowerCase();

        setRawLayers((prev) =>
          prev.filter(
            (l) =>
              !deletedLayerIds.includes(l.id) &&
              (l.wilayah || '').trim().toLowerCase() !== wName
          )
        );
        setKebunList((prev) =>
          prev.filter(
            (k) =>
              !deletedKebunIds.includes(k.id) &&
              (k.wilayah || '').trim().toLowerCase() !== wName
          )
        );

        if (selectedWilayah.trim().toLowerCase() === wName) {
          setSelectedWilayah('');
          setSelectedKebunId(null);
          setSelectedAfdelingId(null);
          setSelectedBlokId(null);
        }
        if (selectedLayerId && deletedLayerIds.includes(selectedLayerId)) {
          setSelectedLayerId(null);
        }
        return true;
      } else {
        alert(json.detail || json.message || `Gagal menghapus data wilayah "${wilayahName}".`);
        return false;
      }
    } catch (err) {
      console.error('Delete wilayah error:', err);
      alert(`Terjadi kesalahan saat menghapus data wilayah "${wilayahName}".`);
      return false;
    }
  };

  // Upload success handler
  const handleUploadSuccess = (
    newLayers: LayerPeta[],
    bbox: [number, number, number, number] | null
  ) => {
    setRawLayers((prev) => [...prev, ...newLayers]);
    if (newLayers.length > 0) {
      setSelectedLayerId(newLayers[0].id);
    }
    if (bbox) {
      setFitBoundsTarget(bbox);
    }
    // Refresh stats from database
    refreshStatsAndLayers();
  };

  // Handler when a new parcel/feature is digitized via Pencil Tool
  const handleFeatureCreated = (newFeature: Record<string, unknown>, layerId: number) => {
    setDataRevision((prev) => prev + 1);
    refreshStatsAndLayers();
    if (newFeature && typeof newFeature.id === 'number') {
      setSelectedFeatureId(newFeature.id);
    }
    setSelectedLayerId(layerId);
  };

  // Handler when a parcel/feature is deleted
  const handleFeatureDeleted = () => {
    setSelectedFeatureId(null);
    setDataRevision((prev) => prev + 1);
    refreshStatsAndLayers();
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0A0E1A] text-[#F0F6FC] font-sans antialiased select-none">
      {/* 1. TOP HEADER (RPN Monitoring Dashboard Style) */}
      <MonitoringHeader
        kebunList={kebunList}
        selectedKebunId={selectedKebunId}
        selectedStatusFilter={selectedStatusFilter}
        onSelectStatusFilter={(val) => setSelectedStatusFilter(val as 'all' | 'ktg' | 'ks_gpa')}
        activeCommodity={stats?.komoditas}
        onOpenUpload={() => setIsUploadModalOpen(true)}
      />

      {/* 2. MAIN WORKSPACE BODY */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Filter Sidebar */}
        <MonitoringSidebar
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
          kebunList={kebunList}
          afdelingList={effectiveAfdelingList}
          blokList={blokList}
          selectedPerusahaan={selectedPerusahaan}
          onSelectPerusahaan={handleSelectPerusahaan}
          selectedWilayah={selectedWilayah}
          onSelectWilayah={handleSelectWilayah}
          selectedKebunId={selectedKebunId}
          onSelectKebun={handleSelectKebun}
          selectedAfdelingId={selectedAfdelingId}
          onSelectAfdeling={handleSelectAfdeling}
          selectedBlokId={selectedBlokId}
          onSelectBlok={setSelectedBlokId}
          onResetFilters={handleResetFilters}
          layers={displayedLayers}
          allLayers={rawLayers}
          selectedLayerId={selectedLayerId}
          onSelectLayer={(id) => setSelectedLayerId(id)}
          onToggleLayerVisibility={handleToggleLayerVisibility}
          onZoomToLayer={(bbox) => setFitBoundsTarget([...bbox])}
          onRenameLayer={handleRenameLayer}
          onDeleteLayer={handleDeleteLayer}
          onDeleteWilayah={handleDeleteWilayah}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          deletedCount={deletedCount}
        />

        {/* Center: Main Map View + Collapsible Bottom Panel */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden">
          {/* Main Map Viewport */}
          <div className="flex-1 min-h-0 relative">
            <MonitoringMap
              layers={displayedLayers}
              rasterLayers={rasterLayers}
              stats={stats}
              selectedWilayah={selectedWilayah}
              selectedLayerId={selectedLayerId}
              statusFilter={selectedStatusFilter}
              selectedAfdelingId={selectedAfdelingId}
              afdelingList={effectiveAfdelingList}
              onSelectFeature={(featId, layerId) => {
                setSelectedFeatureId(featId);
                if (layerId) setSelectedLayerId(layerId);
              }}
              selectedFeatureId={selectedFeatureId}
              fitBoundsTarget={fitBoundsTarget}
              onToggleLayerVisibility={handleToggleLayerVisibility}
              onToggleRasterVisibility={handleToggleRasterVisibility}
              onChangeRasterOpacity={handleChangeRasterOpacity}
              onFeatureCreated={handleFeatureCreated}
              onFeatureDeleted={handleFeatureDeleted}
              dataRevision={dataRevision}
            />
          </div>

          {/* Bottom Information & Attribute Table Panel */}
          <MonitoringBottomPanel
            isOpen={isBottomPanelOpen}
            onToggle={() => setIsBottomPanelOpen((prev) => !prev)}
            layers={displayedLayers}
            selectedLayerId={selectedLayerId}
            onSelectLayer={(id) => setSelectedLayerId(id)}
            selectedFeatureId={selectedFeatureId}
            onSelectFeature={(id) => setSelectedFeatureId(id)}
            onZoomToFeature={(bbox) => setFitBoundsTarget([...bbox])}
            selectedKebunId={selectedKebunId}
            selectedAfdelingId={selectedAfdelingId}
            selectedBlokId={selectedBlokId}
            kebunList={kebunList}
            afdelingList={effectiveAfdelingList}
            blokList={blokList}
            stats={stats}
            periodYear={selectedYear}
            periodMonth={selectedMonth}
            onFeatureDeleted={handleFeatureDeleted}
            dataRevision={dataRevision}
          />
        </div>

        {/* Right Information & KPI Panel */}
        <MonitoringRightPanel
          isOpen={isRightPanelOpen}
          onToggle={() => setIsRightPanelOpen((prev) => !prev)}
          stats={stats}
          periodMonth={selectedMonth}
          periodYear={selectedYear}
          activeKebunName={kebunList.find((k) => k.id === selectedKebunId)?.nama_kebun}
          activeAfdelingName={effectiveAfdelingList.find((a) => a.id === selectedAfdelingId)?.nama_afdeling}
        />
      </div>

      {/* 3. UPLOAD & DATA MAPPING MODAL */}
      <GisUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />

      {/* 4. SETTINGS, BACKUP & TRASH RECYCLE BIN MODAL */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onDataChanged={() => {
          setDataRevision((prev) => prev + 1);
          refreshStatsAndLayers();
        }}
      />
    </div>
  );
}
