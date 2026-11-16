import React from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { AuthProvider } from '@/components/AuthProvider';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export function DashboardLayout({ children, title, subtitle }: DashboardLayoutProps) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen bg-slate-50 font-sans antialiased text-slate-800">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header title={title} subtitle={subtitle} />
          <main className="flex-1 p-8 overflow-y-auto">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}
