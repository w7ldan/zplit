import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { alt, contentType, size } from "./opengraph-image";

describe("Open Graph image", () => {
  it("declares the fixed privacy-safe image contract", () => {
    expect({ alt, contentType, size }).toEqual({
      alt: "Zplit shared expense ledger preview",
      contentType: "image/png",
      size: { width: 1200, height: 630 },
    });
  });

  it("uses no external assets or private-data modules", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/opengraph-image.tsx"), "utf8");
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/(?:database|auth|headers|cookies|token|debtor|invitation)/i);
  });
});
