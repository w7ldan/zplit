import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://idr.wildan.lol"),
  title: "Zplit — Personal Ledger",
  description: "A personal record for shared expenses, repayments, and open balances.",
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
  themeColor: "#F4F1EA",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
