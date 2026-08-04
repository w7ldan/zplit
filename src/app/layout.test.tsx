import { describe, expect, it } from "vitest";
import { metadata, viewport } from "./layout";

describe("root PWA metadata", () => {
  it("links the manifest, install icons, and Apple web-app metadata", () => {
    expect(metadata).toMatchObject({
      applicationName: "Zplit",
      manifest: "/manifest.webmanifest",
      appleWebApp: { capable: true, title: "Zplit", statusBarStyle: "default" },
    });
    expect(viewport).toEqual({ themeColor: "#111315" });
    expect(metadata.icons).toMatchObject({ apple: "/icons/apple-touch-icon.png" });
  });
});
