import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const documentation = readSource("docs/design-system.md");

describe("Repository design-system contract", () => {
  it("keeps design tokens, browser behavior, and documented density modes explicit", () => {
    for (const token of ["#111315", "#F4F1EA", "#FFFEFA", "#C7E4F6", "#62676B", "#C8C7C1", "--mint", "--peach", "--amber", "--error"]) {
      expect(css).toContain(token);
    }

    const darkPalette = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const token of [
      "--paper: #171816",
      "--surface: #20211F",
      "--ink: #E8E4DC",
      "--muted-ink: #A8A39A",
      "--rule: #42433F",
      "--pastel-blue: #263C47",
      "--mint: #22372C",
      "--amber: #3B3321",
      "--peach: #3A2825",
    ]) {
      expect(darkPalette).toContain(token);
    }
    for (const radius of ["--radius-sm: 6px", "--radius-md: 10px", "--radius-lg: 16px", "--radius-xl: 20px", "--radius-control: 10px", "--radius-panel: 16px"]) {
      expect(css).toContain(radius);
    }
    for (const timing of ["--motion-press: 100ms", "--motion-fast: 160ms", "--motion-state: 220ms", "--motion-layout: 300ms", "--motion-panel: 360ms", "--motion-reveal: 640ms", "--motion-instant: 100ms"]) {
      expect(css).toContain(timing);
    }
    for (const ease of ["--ease-product: cubic-bezier(.2,.8,.2,1)", "--ease-emphasized: cubic-bezier(.22,1,.36,1)", "--ease-standard: cubic-bezier(.4,0,.2,1)", "--ease-out: cubic-bezier(.22,1,.36,1)"]) {
      expect(css).toContain(ease);
    }
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".app-page h1");
    expect(css).toMatch(/html\.zplit-product-mode\s*\{[\s\S]*?scroll-behavior:\s*auto;/);
    expect(css).toContain("scroll-behavior: smooth");
    expect(css).toContain("animation: none");
    expect(css.indexOf("/* Explicit Zplit browser baseline. */")).toBeGreaterThanOrEqual(0);
    expect(css.indexOf("/* Explicit Zplit browser baseline. */")).toBeLessThan(css.indexOf(".editorial-shell {"));
    for (const statement of [
      "65% clarity, 25% editorial expression, and 10% controlled spectacle",
      "85% functional clarity",
      "Product UI is the illustration",
      "public interactive journey",
      "separate density modes",
      "80% on state feedback",
      "prefers-reduced-motion: reduce",
      "expressive editorial scale",
      "prioritize task density",
      "Motion communicates insertion, completion, state change, or spatial entry/exit",
      "Frequent financial inputs remain immediate",
      "Reduced motion removes spatial effects",
      "Public and authenticated navigation share the same detached-panel transition.",
      "Prerequisite creation preserves the owner’s original task and returns automatically.",
      "Optional create-time fields use native progressive disclosure.",
      "Returned values and validation errors reveal their containing disclosure.",
      "Edit forms remain direct when hiding controls would obstruct review.",
      "Creating the prerequisite Friend from Add repayment returns automatically to Repayment entry with that Friend selected.",
      "search stays visible while secondary list filters may use a native disclosure",
      "active-filter count excludes free-text search",
      "Clear filters remains available whenever filtering is active",
      "Result updates announce concise matching totals, not entire ledger lists.",
      "New record-filter and mobile-disclosure rules belong in `30-records-and-forms.css`, not the late-override quarantine.",
    ]) {
      expect(documentation).toContain(statement);
    }
    expect(documentation).not.toContain("Authenticated sticky navigation remains geometrically stable while scrolling; it may change surface emphasis but does not change width, position, alignment, or radius.");
  });

  it("keeps prohibited visual patterns out of the product contract", () => {
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
    expect(css).toContain("box-shadow: 0 0.35rem 1rem var(--shadow)");
    expect(css).not.toContain("--motion-cinematic");
    expect(css).not.toContain("friend-heading-reveal");
    expect(css).not.toContain("friend-list-reveal");
    expect(css).toContain(".toast-viewport");
    expect(css).toContain("width: min(26rem, calc(100vw - 2rem))");
    expect(css).toContain("bottom: calc(4.5rem + env(safe-area-inset-bottom) + 0.75rem)");
    expect(css).toContain(".toast__position");
    expect(css).toContain("transition: opacity var(--motion-state) var(--ease-product), transform var(--motion-state) var(--ease-product);");
    expect(css).not.toContain("@keyframes toast-in");
    expect(css).not.toContain("@keyframes toast-out");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.toast,[\s\S]*?animation: none !important;/);
  });
});
