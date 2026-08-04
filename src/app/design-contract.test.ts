import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const documentation = readFileSync(path.resolve(process.cwd(), "docs/design-system.md"), "utf8");
const taskPanelSource = readFileSync(path.resolve(process.cwd(), "src/components/app/task-panel.tsx"), "utf8");
const recordConfirmationSource = readFileSync(path.resolve(process.cwd(), "src/components/app/record-confirmation.tsx"), "utf8");

function cssBraceDepth(source: string) {
  let depth = 0;
  let quote = "";
  let comment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth < 0) return depth;
    }
  }

  return depth;
}

describe("Zplit design contract", () => {
  it("keeps the palette, geometry, public/authenticated modes, and motion budget explicit", () => {
    for (const token of ["#111315", "#F4F1EA", "#FFFEFA", "#C7E4F6", "#62676B", "#C8C7C1", "--mint", "--peach", "--amber", "--error"]) {
      expect(css).toContain(token);
    }

    expect(css).toContain("--radius: 10px");
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
    expect(css).toMatch(/html\.zplit-product-mode\s*\{[\s\S]*?scroll-behavior:\s*auto;/);
    expect(css).toContain("scroll-behavior: smooth");
    expect(css).toContain("animation: none");
    expect(documentation).toContain("65% clarity, 25% editorial expression, and 10% controlled spectacle");
    expect(documentation).toContain("85% functional clarity");
    expect(documentation).toContain("Product UI is the illustration");
    expect(documentation).toContain("public interactive journey");
    expect(documentation).toContain("separate density modes");
    expect(documentation).toContain("80% on state feedback");
    expect(documentation).toContain("prefers-reduced-motion: reduce");
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
    expect(css).not.toContain("--motion-cinematic");
    expect(css).not.toContain("friend-heading-reveal");
    expect(css).not.toContain("friend-list-reveal");
  });

  it("keeps the authenticated lifecycle and CSS syntax native and bounded", () => {
    expect(cssBraceDepth(css)).toBe(0);
    expect(taskPanelSource).toContain("router?.replace");
    expect(recordConfirmationSource).toContain("router?.replace");
    expect(taskPanelSource).not.toContain("window.history.replaceState");
    expect(recordConfirmationSource).not.toContain("window.history.replaceState");
  });
});
