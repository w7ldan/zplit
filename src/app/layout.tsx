import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://idr.wildan.lol"),
  title: "Zplit — Shared expenses, clearly settled",
  applicationName: "Zplit",
  description: "Record outings, assign friend shares, and track repayments until every balance is clear.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Zplit",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Zplit — Shared expenses, clearly settled",
    description: "Record outings, assign friend shares, and track repayments until every balance is clear.",
    url: "https://idr.wildan.lol",
    siteName: "Zplit",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Zplit — Shared expenses, clearly settled",
    description: "Record outings, assign friend shares, and track repayments until every balance is clear.",
  },
};

export const viewport: Viewport = {
  themeColor: "#111315",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><ServiceWorkerRegistration />{children}</body>
    </html>
  );
}
