import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const documentation = readFileSync(path.resolve(process.cwd(), "docs/design-system.md"), "utf8");

describe("editorial design contract", () => {
  it("keeps the permanent palette, geometry, motion, and documentation rules intact", () => {
    for (const color of ["#111315", "#F4F1EA", "#C7E4F6", "#5F6468", "#B9BAB6", "#FFFFFF"]) {
      expect(css).toContain(color);
    }

    expect(css).toContain("--pastel-blue: #C7E4F6");
    expect(css).toMatch(/--radius(?:-[a-z]+)?:\s*0px/g);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(documentation).toContain("70/20/10");

    for (const prohibitedPattern of [
      "generic SaaS dashboards",
      "generic rounded cards",
      "excessive pills",
      "colored status dots",
      "glassmorphism",
      "gradient blobs",
      "glowing effects",
      "heavy shadows",
      "decorative 3D",
      "fake analytics",
      "animation on every element",
    ]) {
      expect(documentation).toContain(prohibitedPattern);
    }

    expect(css).not.toMatch(/gradient/i);
    expect(css).not.toContain("backdrop-filter");
    expect(css).not.toMatch(/infinite\s+animation/i);
    expect(css).not.toMatch(/border-radius\s*:\s*(?!0(?:px)?\b)/i);
    expect(css).not.toContain("box-shadow");
  });
});
