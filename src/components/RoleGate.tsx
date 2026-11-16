'use client';

import React from 'react';
import { useAuth } from '@/components/AuthProvider';

/**
 * Menampilkan children hanya untuk admin. Ini sekadar penyesuaian UI;
 * otorisasi sebenarnya ditegakkan di API (requireUser).
 */
export function AdminOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { isAdmin } = useAuth();
  return <>{isAdmin ? children : fallback}</>;
}

/** Render-prop untuk komponen yang perlu mengetahui status admin. */
export function WithAdmin({ children }: { children: (isAdmin: boolean) => React.ReactNode }) {
  const { isAdmin } = useAuth();
  return <>{children(isAdmin)}</>;
}

