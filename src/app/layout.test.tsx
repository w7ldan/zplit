import { describe, expect, it } from "vitest";
import { metadata, viewport } from "./layout";

describe("root PWA metadata", () => {
  it("links the manifest, favicon, install icons, and Apple web-app metadata", () => {
    expect(metadata).toMatchObject({
      applicationName: "Zplit",
      manifest: "/manifest.webmanifest",
      appleWebApp: { capable: true, title: "Zplit", statusBarStyle: "default" },
    });
    expect(viewport).toEqual({ themeColor: "#F4F1EA" });
    expect(metadata.icons).toMatchObject({
      icon: [
        { url: "/icons/favicon.svg", type: "image/svg+xml" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { url: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png" },
      ],
      apple: "/icons/apple-touch-icon.png",
    });
  });

  it("publishes generic Open Graph and Twitter metadata", () => {
    expect(metadata).toMatchObject({
      title: { default: "Zplit — Shared expenses, clearly settled", template: "%s · Zplit" },
      description: "Record outings, assign friend shares, and track repayments until every balance is clear.",
      metadataBase: new URL("https://idr.wildan.lol"),
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
    });
  });
});
