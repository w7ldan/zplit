import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

function pngSize(file: string) {
  const data = readFileSync(path.resolve(process.cwd(), file));
  expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe("PWA manifest", () => {
  it("uses the Zplit install metadata and current identity colors", () => {
    const value = manifest();
    expect(value).toMatchObject({
      name: "Zplit",
      short_name: "Zplit",
      id: "/",
      start_url: "/app",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#F4F1EA",
      theme_color: "#111315",
    });
    expect(value.description).toMatch(/shared-expense ledger/i);
  });

  it("commits valid icons at every required size", () => {
    expect(pngSize("public/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/icons/icon-512-maskable.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(valueIcon("maskable")).toMatchObject({ purpose: "maskable", sizes: "512x512" });
  });

  it("keeps the favicon as the two-color Zplit mark source", () => {
    const source = readFileSync(path.resolve(process.cwd(), "public/icons/favicon.svg"), "utf8");
    expect(source).toContain('<rect width="512" height="512" fill="#C7E4F6"/>');
    expect(source).toContain('x="256" y="256"');
    expect(source).toContain('fill="#111315"');
    expect(source).toContain('font-family="Arial, &quot;Helvetica Neue&quot;, Helvetica, sans-serif"');
    expect(source).toContain('font-weight="800"');
    expect(source).not.toContain("#F4F1EA");
  });
});

function valueIcon(kind: "maskable") {
  return manifest().icons?.find((icon) => typeof icon !== "string" && icon.purpose === kind);
}
