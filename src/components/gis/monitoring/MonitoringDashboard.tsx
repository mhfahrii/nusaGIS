'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { hasPermission } from '@/types/auth';
import { MonitoringHeader } from './MonitoringHeader';
import { MonitoringSidebar } from './MonitoringSidebar';
import { MonitoringRightPanel } from './MonitoringRightPanel';
import { MonitoringMap, type CompanyLocationPin } from './MonitoringMap';
import { GisUploadModal } from './GisUploadModal';
import SettingsModal from './SettingsModal';
import { IconFilter } from '../GisIcons';
import { IconMap, IconDashboard } from '@/components/icons';
import { DEFAULT_PERUSAHAAN, matchPerusahaanFilter } from '@/lib/gis/rpnEntities';
import { matchWilayahFilter } from '@/lib/gis/wilayah';
import type { LayerPeta, LayerRaster, MonitoringStats } from '@/types/gis';

interface KebunItem {
  id: number;
  kode_kebun: string;
  nama_kebun: string;
  perusahaan?: string | null;
  wilayah: string | null;
  provinsi?: string | null;
  kabupaten_kota?: string | null;
}

interface AfdelingItem {
  id: number;
  kebun_id: number;
  kode_afdeling: string;
  nama_afdeling: string;
}

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
  const { user, loading: authLoading } = useAuth();
  const canViewMap = hasPermission(user, 'lihat_peta');
  const canUpload = hasPermission(user, 'upload_layer');
  const canEdit = hasPermission(user, 'edit_data');
  const canDelete = hasPermission(user, 'hapus_data');

  // Panel toggles (desktop docked vs mobile overlay drawer)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'filter' | 'kpi'>('none');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [deletedCount, setDeletedCount] = useState<number>(0);

  // Time & Period state
  const selectedYear = '2026';
  const selectedMonth = 'November';

  // Master lists
  const [kebunList, setKebunList] = useState<KebunItem[]>([]);
  const [afdelingList, setAfdelingList] = useState<AfdelingItem[]>([]);
  const [rawLayers, setRawLayers] = useState<LayerPeta[]>([]);
  const [rasterLayers, setRasterLayers] = useState<LayerRaster[]>([]);
  const [stats, setStats] = useState<MonitoringStats | null>(null);

  // Filter states
  const [selectedPerusahaan, setSelectedPerusahaan] = useState('');
  const [selectedWilayah, setSelectedWilayah] = useState('');
  const [selectedKebunId, setSelectedKebunId] = useState<number | null>(null);
  const [selectedAfdelingId, setSelectedAfdelingId] = useState<number | null>(null);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'ktg' | 'ks_gpa'>('all');

  // Active map and selection states
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null);
  const [fitBoundsTarget, setFitBoundsTarget] = useState<[number, number, number, number] | null>(null);
  const [dataRevision, setDataRevision] = useState(0);

  // 1. Refresh seluruh master data (kebun, afdeling, layers, rasters, stats, history) setelah mutasi data
  const refreshStatsAndLayers = useCallback(async () => {
    try {
      const params: string[] = [];
      if (selectedKebunId) params.push(`kebun_id=${selectedKebunId}`);
      else {
        if (selectedWilayah) params.push(`wilayah=${encodeURIComponent(selectedWilayah)}`);
        if (selectedPerusahaan) params.push(`perusahaan=${encodeURIComponent(selectedPerusahaan)}`);
      }
      if (selectedLayerId) params.push(`layer_id=${selectedLayerId}`);
      const statsQuery = params.length > 0 ? `?${params.join('&')}` : '';

      const [kRes, aRes, lRes, rRes, sRes, hRes] = await Promise.all([
        fetch('/api/kebun'),
        fetch('/api/afdeling'),
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
  }, [selectedPerusahaan, selectedWilayah, selectedKebunId, selectedLayerId]);

  // Reaktif perbarui statistik KPI saat filter Perusahaan, Wilayah, Kebun, atau Layer berubah (dengan AbortController standar ArcGIS Web SDK)
  useEffect(() => {
    const controller = new AbortController();
    async function updateStats() {
      try {
        const params: string[] = [];
        if (selectedKebunId) params.push(`kebun_id=${selectedKebunId}`);
        else {
          if (selectedWilayah) params.push(`wilayah=${encodeURIComponent(selectedWilayah)}`);
          if (selectedPerusahaan) params.push(`perusahaan=${encodeURIComponent(selectedPerusahaan)}`);
        }
        if (selectedLayerId) params.push(`layer_id=${selectedLayerId}`);
        const statsQuery = params.length > 0 ? `?${params.join('&')}` : '';
        const sRes = await fetch(`/api/stats${statsQuery}`, {
          signal: controller.signal,
        });
        if (sRes.ok && !controller.signal.aborted) {
          const sj = await sRes.json();
          if (!controller.signal.aborted) {
            setStats(sj.data || null);
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.error('Failed to update stats:', err);
      }
    }
    updateStats();
    return () => {
      controller.abort();
    };
  }, [selectedPerusahaan, selectedWilayah, selectedKebunId, selectedLayerId]);

  // Inisialisasi master data 1x saat mount (tanpa duplikasi /api/stats dan tanpa reload saat filter kebun berganti)
  useEffect(() => {
    const controller = new AbortController();
    async function loadMasterData() {
      try {
        const [kRes, aRes, lRes, rRes, hRes] = await Promise.all([
          fetch('/api/kebun', { signal: controller.signal }),
          fetch('/api/afdeling', { signal: controller.signal }),
          fetch('/api/gis/layers', { signal: controller.signal }),
          fetch('/api/gis/rasters', { signal: controller.signal }),
          fetch('/api/gis/history', { signal: controller.signal }),
        ]);

        if (!controller.signal.aborted) {
          if (kRes.ok) {
            const kj = await kRes.json();
            setKebunList(kj.data || []);
          }
          if (aRes.ok) {
            const aj = await aRes.json();
            setAfdelingList(aj.data || []);
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

              const explicitLayer =
                (paramLayerId && data.find((l) => l.id === paramLayerId)) ||
                (paramKebunId && data.find((l) => l.kebun_id === paramKebunId));

              if (explicitLayer) {
                if (explicitLayer.bbox) {
                  setFitBoundsTarget([...explicitLayer.bbox]);
                }
                return explicitLayer.id;
              }

              const visiblePool = data.filter((l) => l.terlihat);
              const unionBbox = computeUnionBbox(visiblePool.length > 0 ? visiblePool : data);
              if (unionBbox) {
                setFitBoundsTarget([...unionBbox]);
              }
              return null;
            });
          }
          if (rRes.ok) {
            const rj = await rRes.json();
            setRasterLayers(rj.data || []);
          }
          if (hRes.ok) {
            const hj = await hRes.json();
            if (hj.status === 'success' && hj.data?.counts) {
              setDeletedCount(hj.data.counts.total_deleted || 0);
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.error('Failed to load master dashboard data:', err);
      }
    }

    loadMasterData();
    return () => {
      controller.abort();
    };
  }, []);

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
          const layerPerusahaan = l.perusahaan || matchKebun?.perusahaan || DEFAULT_PERUSAHAAN;
          if (!matchPerusahaanFilter(layerPerusahaan, criteria.perusahaan || '')) {
            return false;
          }
        }

        // Filter Wilayah (Provinsi)
        if (targetWilayah) {
          const matchProv = matchWilayahFilter(
            l.wilayah || matchKebun?.wilayah,
            criteria.wilayah,
            l.provinsi || matchKebun?.provinsi
          );
          if (!matchProv) {
            return false;
          }
        }

        // Filter Kebun
        if (criteria.kebunId && Number(l.kebun_id) !== Number(criteria.kebunId)) {
          return false;
        }

        // Filter Afdeling:
        // Wajib cocok dengan kebun induk milik Afdeling terpilih (cegah Afdeling Bakalan mengarah ke Kebun Sarongge/Bandung)
        if (afdParentKebunId && Number(l.kebun_id) !== afdParentKebunId) {
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
    });
  }, [
    filterLayersByCriteria,
    rawLayers,
    selectedPerusahaan,
    selectedWilayah,
    selectedKebunId,
    selectedAfdelingId,
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

  // Daftar lokasi/kebun yang dimiliki Perusahaan / Puslit terpilih untuk pin & kartu peta
  const companyLocations = useMemo<CompanyLocationPin[]>(() => {
    if (!selectedPerusahaan) return [];
    const matchingKebun = kebunList.filter((k) =>
      matchPerusahaanFilter(k.perusahaan, selectedPerusahaan)
    );
    const matchingLayers = filterLayersByCriteria(rawLayers, { perusahaan: selectedPerusahaan });

    const byKebunId = new Map<number, CompanyLocationPin>();
    for (const k of matchingKebun) {
      const kLayers = matchingLayers.filter((l) => Number(l.kebun_id) === Number(k.id));
      const unionBox = computeUnionBbox(kLayers);
      const center: [number, number] | null = unionBox
        ? [(unionBox[1] + unionBox[3]) / 2, (unionBox[0] + unionBox[2]) / 2]
        : null;
      byKebunId.set(Number(k.id), {
        kebunId: Number(k.id),
        namaKebun: k.nama_kebun,
        wilayah: k.wilayah || kLayers[0]?.wilayah || 'Wilayah Operasional',
        layerCount: kLayers.length,
        totalFitur: kLayers.reduce((s, l) => s + Number(l.jumlah_fitur || 0), 0),
        bbox: unionBox,
        center,
      });
    }

    // Sertakan juga layer yang belum terikat di kebunList jika ada
    for (const l of matchingLayers) {
      const kId = Number(l.kebun_id || -l.id);
      if (!byKebunId.has(kId)) {
        const unionBox = computeUnionBbox([l]);
        const center: [number, number] | null = unionBox
          ? [(unionBox[1] + unionBox[3]) / 2, (unionBox[0] + unionBox[2]) / 2]
          : null;
        byKebunId.set(kId, {
          kebunId: kId,
          namaKebun: l.nama_kebun || l.nama_layer,
          wilayah: l.wilayah || 'Wilayah Operasional',
          layerCount: 1,
          totalFitur: Number(l.jumlah_fitur || 0),
          bbox: unionBox,
          center,
        });
      }
    }

    return Array.from(byKebunId.values());
  }, [selectedPerusahaan, kebunList, rawLayers, filterLayersByCriteria]);

  // Handler Perusahaan (cascading reset + zoom mencakup seluruh sebaran lokasi PT tersebut)
  const handleSelectPerusahaan = useCallback(
    (perusahaanVal: string) => {
      setSelectedPerusahaan(perusahaanVal);
      setSelectedWilayah('');
      setSelectedKebunId(null);
      setSelectedAfdelingId(null);
      setSelectedFeatureId(null);

      const matching = filterLayersByCriteria(rawLayers, { perusahaan: perusahaanVal });
      const visible = matching.filter((l) => l.terlihat);
      const targetPool = visible.length > 0 ? visible : matching;
      // Jika PT memiliki lebih dari 1 layer/kebun, biarkan selectedLayerId = null agar semua kebun dianalisis & ditampilkan bersama
      setSelectedLayerId(targetPool.length === 1 ? targetPool[0].id : null);
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
      setSelectedFeatureId(null);

      if (id) {
        const afd = effectiveAfdelingList.find((a) => Number(a.id) === Number(id));
        const targetKebun = afd?.kebun_id ? Number(afd.kebun_id) : selectedKebunId;
        if (targetKebun && targetKebun !== selectedKebunId) {
          setSelectedKebunId(targetKebun);
        }
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
          if (!targetPool[0].terlihat) {
            setRawLayers((prev) =>
              prev.map((l) => (l.id === targetPool[0].id ? { ...l, terlihat: true } : l))
            );
          }
          const bbox = computeUnionBbox(targetPool);
          if (bbox) setFitBoundsTarget([...bbox]);
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
    setSelectedFeatureId(null);
    setSelectedLayerId(null);
    const visible = rawLayers.filter((l) => l.terlihat);
    const pool = visible.length > 0 ? visible : rawLayers;
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
    if (!canEdit) return;
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
    if (!canEdit) return;
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
    if (!canEdit) return;
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
          }
        } else if (json.data?.kebunDeleted && json.data?.deletedKebunId) {
          setKebunList((prev) => prev.filter((k) => k.id !== json.data.deletedKebunId));
          if (selectedKebunId === json.data.deletedKebunId) {
            setSelectedKebunId(null);
            setSelectedAfdelingId(null);
          }
        }

        refreshStatsAndLayers();
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
              !matchWilayahFilter(l.wilayah, wilayahName, l.provinsi)
          )
        );
        setKebunList((prev) =>
          prev.filter(
            (k) =>
              !deletedKebunIds.includes(k.id) &&
              !matchWilayahFilter(k.wilayah, wilayahName, k.provinsi)
          )
        );

        if (selectedWilayah.trim().toLowerCase() === wName) {
          setSelectedWilayah('');
          setSelectedKebunId(null);
          setSelectedAfdelingId(null);
        }
        if (selectedLayerId && deletedLayerIds.includes(selectedLayerId)) {
          setSelectedLayerId(null);
        }
        refreshStatsAndLayers();
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

  const activeFilterCount =
    (selectedPerusahaan ? 1 : 0) +
    (selectedWilayah ? 1 : 0) +
    (selectedKebunId ? 1 : 0) +
    (selectedAfdelingId ? 1 : 0) +
    (selectedStatusFilter !== 'all' ? 1 : 0);

  const isFilteredByHierarchy = Boolean(
    selectedPerusahaan || selectedWilayah || selectedKebunId || selectedAfdelingId
  );
  const headerCommodityLabel = isFilteredByHierarchy
    ? stats?.komoditas || 'Semua Komoditas'
    : 'Semua Komoditas';

  if (!authLoading && user && !canViewMap) {
    return (
      <div className="h-dvh w-full overflow-hidden flex flex-col bg-[#0A0E1A] text-[#F0F6FC] font-sans antialiased select-none">
        <MonitoringHeader
          kebunList={kebunList}
          selectedKebunId={selectedKebunId}
          selectedStatusFilter={selectedStatusFilter}
          onSelectStatusFilter={(val) => setSelectedStatusFilter(val as 'all' | 'ktg' | 'ks_gpa')}
          activeCommodity={headerCommodityLabel}
          onOpenUpload={() => {
            if (canUpload) setIsUploadModalOpen(true);
          }}
        />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0D1322] border border-[#1E2942] rounded-2xl p-6 text-center shadow-2xl space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <IconMap className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-[#F0F6FC]">
                Akses Lihat Peta Belum Diaktifkan
              </h2>
              <p className="text-xs text-[#8B9BB4] leading-relaxed">
                Akun Anda ({user.nama}) saat ini tidak memiliki hak akses <strong className="text-[#00D2FF]">Lihat Peta &amp; Statistik Spasial</strong>. Hubungi Administrator untuk mengaktifkan izin akses peta pada akun Anda.
              </p>
            </div>
            <div className="pt-2 flex items-center justify-center gap-3">
              <Link
                href="/dashboard"
                className="px-4 py-2 rounded-lg bg-[#00D2FF] hover:bg-[#38BDF8] text-[#0A0E1A] font-bold text-xs transition-colors shadow-md shadow-[#00D2FF]/20"
              >
                Buka Halaman Profil &amp; Hak Akses
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh w-full overflow-hidden flex flex-col bg-[#0A0E1A] text-[#F0F6FC] font-sans antialiased select-none">
      {/* 1. TOP HEADER (RPN Monitoring Dashboard Style) */}
      <MonitoringHeader
        kebunList={kebunList}
        selectedKebunId={selectedKebunId}
        selectedStatusFilter={selectedStatusFilter}
        onSelectStatusFilter={(val) => setSelectedStatusFilter(val as 'all' | 'ktg' | 'ks_gpa')}
        activeCommodity={headerCommodityLabel}
        onOpenUpload={() => {
          if (canUpload) setIsUploadModalOpen(true);
        }}
      />

      {/* 2. MAIN WORKSPACE BODY */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Filter Sidebar */}
        <MonitoringSidebar
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
          isMobileOpen={mobileDrawer === 'filter'}
          onCloseMobile={() => setMobileDrawer('none')}
          selectedStatusFilter={selectedStatusFilter}
          onSelectStatusFilter={(val) => setSelectedStatusFilter(val as 'all' | 'ktg' | 'ks_gpa')}
          kebunList={kebunList}
          afdelingList={effectiveAfdelingList}
          selectedPerusahaan={selectedPerusahaan}
          onSelectPerusahaan={handleSelectPerusahaan}
          selectedWilayah={selectedWilayah}
          onSelectWilayah={handleSelectWilayah}
          selectedKebunId={selectedKebunId}
          onSelectKebun={handleSelectKebun}
          selectedAfdelingId={selectedAfdelingId}
          onSelectAfdeling={handleSelectAfdeling}
          onResetFilters={handleResetFilters}
          layers={displayedLayers}
          allLayers={rawLayers}
          selectedLayerId={selectedLayerId}
          onSelectLayer={(id) => setSelectedLayerId(id)}
          onToggleLayerVisibility={handleToggleLayerVisibility}
          onZoomToLayer={(bbox) => {
            setFitBoundsTarget([...bbox]);
            setMobileDrawer('none');
          }}
          onRenameLayer={canEdit ? handleRenameLayer : undefined}
          onDeleteLayer={canDelete ? handleDeleteLayer : undefined}
          onDeleteWilayah={canDelete ? handleDeleteWilayah : undefined}
          onOpenSettings={() => {
            setMobileDrawer('none');
            setIsSettingsModalOpen(true);
          }}
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
              selectedPerusahaan={selectedPerusahaan}
              companyLocations={companyLocations}
              onSelectCompanyLocation={(kebunId) => {
                if (kebunId > 0) handleSelectKebun(kebunId);
              }}
              onClearPerusahaan={() => handleSelectPerusahaan('')}
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
              onFeatureCreated={canEdit ? handleFeatureCreated : undefined}
              onFeatureDeleted={canDelete ? handleFeatureDeleted : undefined}
              canEdit={canEdit}
              canDelete={canDelete}
              dataRevision={dataRevision}
            />
          </div>
        </div>

        {/* Right Information & KPI Panel */}
        <MonitoringRightPanel
          isOpen={isRightPanelOpen}
          onToggle={() => setIsRightPanelOpen((prev) => !prev)}
          isMobileOpen={mobileDrawer === 'kpi'}
          onCloseMobile={() => setMobileDrawer('none')}
          stats={stats}
          periodMonth={selectedMonth}
          periodYear={selectedYear}
          activeKebunName={kebunList.find((k) => k.id === selectedKebunId)?.nama_kebun}
          activeAfdelingName={effectiveAfdelingList.find((a) => a.id === selectedAfdelingId)?.nama_afdeling}
        />
      </div>

      {/* Mobile & Tablet Bottom Navigation Bar (< lg) */}
      <nav
        aria-label="Navigasi Mobile GIS"
        className="lg:hidden shrink-0 bg-[#0D1322] border-t border-[#1E2942] grid grid-cols-3 pb-[env(safe-area-inset-bottom)] z-[1160]"
      >
        <button
          type="button"
          onClick={() => setMobileDrawer('none')}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer ${
            mobileDrawer === 'none'
              ? 'text-[#00D2FF] bg-[#12192B]/80'
              : 'text-[#8B9BB4] active:bg-[#12192B]'
          }`}
        >
          <IconMap className="w-5 h-5" />
          <span>Peta</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileDrawer((prev) => (prev === 'filter' ? 'none' : 'filter'))}
          className={`min-h-[56px] relative flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer ${
            mobileDrawer === 'filter'
              ? 'text-[#00D2FF] bg-[#12192B]/80'
              : 'text-[#8B9BB4] active:bg-[#12192B]'
          }`}
        >
          <div className="relative">
            <IconFilter className="w-5 h-5" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-[#00D2FF] text-[#0A0E1A] text-[9px] font-extrabold flex items-center justify-center tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </div>
          <span>Filter</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileDrawer((prev) => (prev === 'kpi' ? 'none' : 'kpi'))}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer ${
            mobileDrawer === 'kpi'
              ? 'text-[#00D2FF] bg-[#12192B]/80'
              : 'text-[#8B9BB4] active:bg-[#12192B]'
          }`}
        >
          <IconDashboard className="w-5 h-5" />
          <span>KPI</span>
        </button>
      </nav>

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
