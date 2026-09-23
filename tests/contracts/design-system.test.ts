import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const documentation = readSource("docs/design-system.md");
const foundation = readSource("src/app/styles/00-foundation.css");
const authenticatedHeader = readSource("src/app/styles/60-authenticated-header-vnext.css");
const appShell = readSource("src/components/app/app-shell.tsx");
const globalSearch = readSource("src/components/app/global-search.tsx");

describe("Repository design-system contract", () => {
  it("keeps the vNext warm surface canonical in both themes", () => {
    const lightTokens = foundation.match(/\.vnext-token-scope\s*\{([^}]*)\}/)?.[1] ?? "";
    const darkTokens = foundation.match(/:root\[data-theme="dark"\]\s+\.vnext-token-scope\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(lightTokens).toContain("--vnext-surface-warm: #FFFFFF;");
    expect(darkTokens).toContain("--vnext-surface-warm: #20211F;");
    expect(lightTokens).not.toMatch(/(?:^|\n)\s*(?:background|color|color-scheme|font-family|font-weight)\s*:/);
    expect(css).not.toContain("#FAF7F1");
    expect(css).not.toContain("#211F1B");
    expect(darkTokens).toContain("--vnext-canvas: #171816;");
    expect(darkTokens).toContain("--vnext-paper: #1D1E1C;");
    expect(darkTokens).toContain("--vnext-surface: #20211F;");
    expect(css).toContain("#F4F1EA");
  });

  it("keeps authenticated Header surfaces on vNext semantic tokens", () => {
    expect(authenticatedHeader).toContain("--authenticated-header-canvas: var(--vnext-canvas);");
    expect(authenticatedHeader).toContain("--authenticated-header-surface: var(--vnext-surface);");
    expect(authenticatedHeader).not.toMatch(/var\(--(?:paper|surface)\)/);
    expect(authenticatedHeader).not.toMatch(/#(?:F4F1EA|FFFEFA|FAF7F1|211F1B)/i);
    expect(appShell).toContain("app-shell vnext-token-scope");
    expect(appShell).not.toContain("app-shell zplit-vnext");
    expect(globalSearch).toContain('className="global-search__backdrop vnext-token-scope"');
  });

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
      "information-clear",
      "Public surfaces can be more expressive",
      "The Journey is a keyboard-operable five-step scenario",
      "prefers-reduced-motion: reduce",
      "The authenticated shell currently has a compact header.",
      "Record retrieval is URL-backed.",
      "The searchable combobox contract is strict:",
      "The repayment-destination list is the reference for simple list reordering:",
      "The current toast system is a bounded, polite status surface",
      "Future realtime updates must use the same restraint",
      "Receipt and payment-proof previews use a bounded overlay.",
      "Future implementation prompts must follow both documents.",
      "Edit forms remain direct",
      "Creating the prerequisite Friend from Add repayment returns to",
      "On mobile, search stays visible",
      "fixed bottom tab bar",
      "active-filter count excludes free-text search",
      "filters remains available whenever filtering is active.",
      "Result updates announce",
      "`30-records-and-forms` owns record rows",
    ]) {
      expect(documentation).toContain(statement);
    }
    expect(documentation).not.toContain("Authenticated sticky navigation remains geometrically stable while scrolling; it may change surface emphasis but does not change width, position, alignment, or radius.");
  });

  it("keeps prohibited visual patterns out of the product contract", () => {
    for (const prohibitedPattern of [
      "generic SaaS-dashboard aesthetic",
      "Ledger rows are not generic",
      "excessive pills",
      "colored “Live” status-dot styling",
      "glassmorphism",
      "gradient",
      "heavy shadows",
      "decorative 3D",
      "fake analytics",
      "perpetual animation",
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
    expect(css).toContain("top: var(--authenticated-header-height);");
    expect(css).toContain(".toast__position");
    expect(css).toContain("transition: opacity var(--motion-state) var(--ease-product), transform var(--motion-state) var(--ease-product);");
    expect(css).not.toContain("@keyframes toast-in");
    expect(css).not.toContain("@keyframes toast-out");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.toast,[\s\S]*?animation: none !important;/);
  });
});
