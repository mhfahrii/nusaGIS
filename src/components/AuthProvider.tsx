'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PenggunaPublik } from '@/types/auth';

interface AuthContextValue {
  user: PenggunaPublik | null;
  loading: boolean;
  isAdmin: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function redirectToLogin() {
  const next = window.location.pathname + window.location.search;
  const query = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
  window.location.replace(`/login${query}`);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PenggunaPublik | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (ignore) return;
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        const json = await res.json();
        if (!ignore && res.ok) setUser(json.data as PenggunaPublik);
      } catch {
        // Jaringan gagal: biarkan halaman menampilkan error API masing-masing.
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadUser();
    return () => {
      ignore = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.replace('/login');
    }
  }, []);

  return (
    <AuthContext value={{ user, loading, isAdmin: user?.peran === 'admin', logout }}>
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider.');
  return ctx;
}

