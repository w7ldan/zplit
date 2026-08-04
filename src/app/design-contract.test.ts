import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const documentation = readFileSync(path.resolve(process.cwd(), "docs/design-system.md"), "utf8");

describe("authenticated design contract", () => {
  it("keeps the palette, geometry, semantic states, and motion budget explicit", () => {
    for (const token of ["#111315", "#F4F1EA", "#FFFEFA", "#C7E4F6", "#62676B", "#C8C7C1", "--mint", "--peach", "--amber", "--error"]) {
      expect(css).toContain(token);
    }

    expect(css).toContain("--radius-control: 10px");
    expect(css).toContain("--radius-panel: 16px");
    for (const timing of ["--motion-press: 100ms", "--motion-fast: 160ms", "--motion-state: 220ms", "--motion-layout: 300ms", "--motion-panel: 360ms", "--motion-reveal: 640ms", "--motion-story: 900ms"]) {
      expect(css).toContain(timing);
    }
    for (const ease of ["--ease-product: cubic-bezier(.2,.8,.2,1)", "--ease-emphasized: cubic-bezier(.22,1,.36,1)", "--ease-standard: cubic-bezier(.4,0,.2,1)"]) {
      expect(css).toContain(ease);
    }
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".app-page h1");
    expect(css).toContain("animation: none");
    expect(documentation).toContain("85% functional clarity");
    expect(documentation).toContain("Ledger rows stay primarily open and rule-based");
    expect(documentation).toContain("Native predictable scrolling");
    expect(documentation).toContain("80% on state feedback");
  });

  it("keeps prohibited visual patterns out of the authenticated contract", () => {
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
    expect(css).not.toContain("box-shadow");
    expect(css).not.toContain("friend-heading-reveal");
    expect(css).not.toContain("friend-list-reveal");
  });
});
