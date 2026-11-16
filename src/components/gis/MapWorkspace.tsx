'use client';

import React from 'react';
import { ViewMode } from './MapViewTabs';
import { SceneViewPlaceholder } from './SceneViewPlaceholder';
import { ActiveTool } from './GisRibbon';
import { MonitoringMap } from './monitoring/MonitoringMap';
import type { LayerPeta } from '@/types/gis';

interface MapWorkspaceProps {
  viewMode: ViewMode;
  activeTool: ActiveTool;
  layers: LayerPeta[];
  selectedLayerId: number | null;
  onPointerMove?: (lat: number, lng: number) => void;
  onSelectFeature?: (featureId: number | null, layerId?: number) => void;
  selectedFeatureId?: number | null;
  fitBoundsTarget?: [number, number, number, number] | null;
}

export function MapWorkspace({
  viewMode,
  layers,
  selectedLayerId,
  onSelectFeature,
  selectedFeatureId,
  fitBoundsTarget,
}: MapWorkspaceProps) {
  if (viewMode === '3D') {
    return <SceneViewPlaceholder />;
  }

  return (
    <MonitoringMap
      layers={layers}
      selectedLayerId={selectedLayerId}
      onSelectFeature={onSelectFeature}
      selectedFeatureId={selectedFeatureId}
      fitBoundsTarget={fitBoundsTarget}
    />
  );
}
