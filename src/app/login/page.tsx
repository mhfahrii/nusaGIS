'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/** Hanya izinkan redirect ke path internal untuk mencegah open redirect. */
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith('/login')) return '/';
  return next;
}

function IconUserSolid({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5zm0 2.5c-3.337 0-10 1.675-10 5v1.25c0 .69.56 1.25 1.25 1.25h17.5c.69 0 1.25-.56 1.25-1.25V19.5c0-3.325-6.663-5-10-5z" />
    </svg>
  );
}

function IconLockSolid({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17 9h-1V7a4 4 0 10-8 0v2H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2v-8a2 2 0 00-2-2zm-5 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM9.8 9V7a2.2 2.2 0 114.4 0v2H9.8z" />
    </svg>
  );
}

function IconEyeOffOutline({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function IconEyeOutline({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier || !password) {
      setError('User Name dan Password wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: trimmedIdentifier,
          email: trimmedIdentifier,
          password,
          rememberMe,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(json?.message ?? 'Login gagal. Periksa kembali akun Anda.');
        setSubmitting(false);
        return;
      }

      // Navigasi penuh agar seluruh data dimuat ulang dengan cookie sesi baru.
      window.location.replace(safeNextPath(searchParams.get('next')));
    } catch {
      setError('Tidak dapat terhubung ke server. Periksa koneksi Anda.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-400/45 bg-rose-950/60 backdrop-blur-md px-4 py-2.5 text-xs sm:text-[13px] text-rose-100 text-center shadow-sm"
        >
          {error}
        </div>
      )}

      {/* User Name / Email Input */}
      <div className="relative flex items-center w-full h-12 rounded-xl border border-white/35 bg-white/[0.08] hover:bg-white/[0.12] focus-within:border-emerald-400 focus-within:bg-white/[0.14] focus-within:ring-2 focus-within:ring-emerald-400/25 transition-all">
        <label htmlFor="identifier" className="sr-only">
          User Name
        </label>
        <IconUserSolid className="w-5 h-5 text-white/85 ml-4 shrink-0" />
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="w-full h-full bg-transparent pl-3.5 pr-4 text-sm text-white placeholder:text-white/80 focus:outline-none"
          placeholder="User Name"
          required
        />
      </div>

      {/* Password Input */}
      <div className="relative flex items-center w-full h-12 rounded-xl border border-white/35 bg-white/[0.08] hover:bg-white/[0.12] focus-within:border-emerald-400 focus-within:bg-white/[0.14] focus-within:ring-2 focus-within:ring-emerald-400/25 transition-all">
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <IconLockSolid className="w-5 h-5 text-white/85 ml-4 shrink-0" />
        <input
          id="password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full h-full bg-transparent pl-3.5 pr-11 text-sm text-white placeholder:text-white/80 focus:outline-none"
          placeholder="Password"
          required
        />
        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          className="absolute right-3 p-1.5 rounded-lg text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 transition-colors cursor-pointer"
          aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
          title={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
        >
          {showPassword ? (
            <IconEyeOutline className="w-5 h-5" />
          ) : (
            <IconEyeOffOutline className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Remember Me Checkbox */}
      <div className="pt-0.5 pb-1">
        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none group">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-5 h-5 rounded-[6px] flex items-center justify-center transition-all ${
              rememberMe
                ? 'bg-gradient-to-b from-[#8CE063] to-[#42B35E] border border-white/30 shadow-sm shadow-emerald-950/40'
                : 'border border-white/40 bg-white/10 group-hover:border-white/60'
            }`}
          >
            {rememberMe && (
              <svg
                className="w-3.5 h-3.5 text-white"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4.5 10.5 8.2 14.2 15.5 6.5" />
              </svg>
            )}
          </span>
          <span className="text-xs sm:text-[13px] text-white/90 font-normal">
            Remember me
          </span>
        </label>
      </div>

      {/* Login Button */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full h-12 rounded-xl bg-gradient-to-r from-[#8FE368] via-[#49B963] to-[#238E58] hover:from-[#9AE975] hover:via-[#52C46C] hover:to-[#289D62] text-white font-bold text-base tracking-wide shadow-[0_8px_24px_rgba(35,142,88,0.45),inset_0_1px_1px_rgba(255,255,255,0.4)] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 transition-all cursor-pointer disabled:opacity-65 disabled:cursor-not-allowed"
      >
        {submitting ? 'Memproses...' : 'Login'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main
      className="relative min-h-dvh w-full flex items-center justify-center px-4 py-8 font-sans antialiased overflow-hidden bg-[#020B10] bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/images/login-bg.jpg')" }}
    >
      {/* Subtle dark vignette overlay agar kontras kartu glassmorphism tetap tajam */}
      <div
        className="absolute inset-0 bg-radial from-transparent via-[#020B10]/30 to-[#020B10]/75 pointer-events-none"
        aria-hidden="true"
      />

      {/* Glassmorphism Card sesuai layout Gambar 1 */}
      <div className="relative z-10 w-full max-w-[400px] rounded-[30px] border border-white/25 bg-gradient-to-b from-white/[0.16] via-white/[0.10] to-black/[0.28] backdrop-blur-xl px-8 py-11 sm:px-10 sm:py-12 shadow-[0_24px_64px_rgba(0,0,0,0.65),inset_0_1px_1px_rgba(255,255,255,0.25)]">
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight drop-shadow-xs">
            Login
          </h1>
          <p className="text-xs sm:text-[13px] text-white/85 mt-2.5 font-normal">
            Welcome back please login to your account.
          </p>
        </div>

        <Suspense
          fallback={
            <div className="space-y-4">
              <div className="h-12 rounded-xl bg-white/10 animate-pulse" />
              <div className="h-12 rounded-xl bg-white/10 animate-pulse" />
              <div className="h-5 w-28 rounded bg-white/10 animate-pulse" />
              <div className="h-12 rounded-xl bg-emerald-500/30 animate-pulse" />
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
