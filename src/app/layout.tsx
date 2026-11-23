import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GIS Monitoring: Dashboard Spasial Perkebunan",
  description: "Web GIS Perkebunan Monitoring Dashboard berbasis PostGIS dan Leaflet",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0e1a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col font-sans bg-slate-950 text-slate-100 select-none">
        {children}
      </body>
    </html>
  );
}
