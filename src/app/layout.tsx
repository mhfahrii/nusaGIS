import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GIS Monitoring — Simple GIS Dashboard",
  description: "Web GIS Perkebunan Monitoring Dashboard berbasis PostGIS dan Leaflet",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col font-sans bg-slate-950 text-slate-100 select-none">
        {children}
      </body>
    </html>
  );
}
