import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://idr.wildan.lol"),
  title: "Zplit — Personal Ledger",
  applicationName: "Zplit",
  description: "A personal record for shared expenses, repayments, and open balances.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
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
    title: "Zplit — Personal Ledger",
    description: "A personal record for shared expenses, repayments, and open balances.",
    url: "https://idr.wildan.lol",
    siteName: "Zplit",
    locale: "en_US",
    type: "website",
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
