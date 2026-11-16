'use client';

import React from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { MonitoringDashboard } from '@/components/gis/monitoring/MonitoringDashboard';

export default function MonitoringDashboardPage() {
  return (
    <AuthProvider>
      <MonitoringDashboard />
    </AuthProvider>
  );
}
