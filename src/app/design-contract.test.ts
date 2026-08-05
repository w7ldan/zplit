import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const documentation = readFileSync(path.resolve(process.cwd(), "docs/design-system.md"), "utf8");
const taskPanelSource = readFileSync(path.resolve(process.cwd(), "src/components/app/task-panel.tsx"), "utf8");
const recordConfirmationSource = readFileSync(path.resolve(process.cwd(), "src/components/app/record-confirmation.tsx"), "utf8");
const expenseShareSource = readFileSync(path.resolve(process.cwd(), "src/components/expenses/expense-share-editor.tsx"), "utf8");
const repaymentAllocationSource = readFileSync(path.resolve(process.cwd(), "src/components/repayments/repayment-allocation-editor.tsx"), "utf8");

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
    expect(documentation).toContain("65% clarity, 25% editorial expression, and 10% controlled spectacle");
    expect(documentation).toContain("85% functional clarity");
    expect(documentation).toContain("Product UI is the illustration");
    expect(documentation).toContain("public interactive journey");
    expect(documentation).toContain("separate density modes");
    expect(documentation).toContain("80% on state feedback");
    expect(documentation).toContain("prefers-reduced-motion: reduce");
    expect(documentation).toContain("expressive editorial scale");
    expect(documentation).toContain("prioritize task density");
    expect(documentation).toContain("Motion communicates insertion, completion, state change, or spatial entry/exit");
    expect(documentation).toContain("Frequent financial inputs remain immediate");
    expect(documentation).toContain("Reduced motion removes spatial effects");
    expect(documentation).toContain("Authenticated sticky navigation remains geometrically stable while scrolling; it may change surface emphasis but does not change width, position, alignment, or radius.");
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
    expect(css).toContain("box-shadow: 0 0.35rem 1rem rgb(17 19 21 / 10%)");
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

  it("keeps navigation, showcase, focus, and row actions geometrically bounded", () => {
    expect(css).toContain("overflow-x: clip");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)");
    expect(css).toContain(".journey-sticky--pinned");
    expect(css).toContain("height: calc(100svh - var(--journey-sticky-top) - var(--journey-bottom-clearance))");
    expect(css).toContain(".journey-sticky--pinned .journey-stage");
    expect(css).toContain(":is(input, select, textarea):focus-visible");
    expect(css).not.toMatch(/\.friend-form__field[^{}]*:focus(?!-)/);
    expect(css).not.toMatch(/\.repayment-form__field[^{}]*:focus(?!-)/);
    expect(css).toMatch(/\.friend-row__edit,[\s\S]*?text-decoration: none;/);
    expect(css).toContain("min-height: 2.75rem");
    expect(css).not.toContain(".friend-row__edit:hover span");
    expect(css).not.toContain(".outing-row__edit:hover span");
    expect(css).not.toContain(".expense-row__edit:hover span");
  });

  it("keeps the authenticated desktop header in one centered three-region grid", () => {
    expect(css).toMatch(/\.app-shell__header-layout\s*\{[\s\S]*?padding:\s*0\.75rem 1rem;/);
    expect(css).toMatch(/\.app-shell__header-layout\s*\{[\s\S]*?width:\s*min\(calc\(100% - 2rem\), 72rem\);[\s\S]*?max-width:\s*72rem;[\s\S]*?border-radius:\s*var\(--radius-panel\);/);
    expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.app-shell__header-layout\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.app-shell__brand\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?justify-self:\s*start;[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/\.app-shell__nav\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?justify-self:\s*center;[\s\S]*?width:\s*max-content;/);
    expect(css).toMatch(/\.app-shell__actions\s*\{[\s\S]*?display:\s*flex;[\s\S]*?grid-column:\s*3;[\s\S]*?justify-self:\s*end;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*0\.75rem;[\s\S]*?width:\s*max-content;/);
    expect(css).not.toMatch(/\.app-shell__nav\s*\{[^}]*flex:\s*1/);
    expect(css).toMatch(/\.app-shell__header-layout--detached\s*\{[^}]*border-color:\s*var\(--rule\);[^}]*background:\s*var\(--surface\);[^}]*box-shadow:/);
    expect(css).not.toMatch(/\.app-shell__header-layout--detached\s*\{[^}]*\b(?:width|max-width|transform|border-radius|padding|margin)/);
    expect(css).toMatch(/@media \(max-width: 1023px\)\s*\{[\s\S]*?\.app-shell__mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
    expect(css).toContain(".site-header--detached {\n  width: min(calc(100% - 2rem), 72rem);");
  });

  it("keeps the requested bounded motion primitives consistent", () => {
    expect(css).toContain("animation: row-in var(--motion-layout) var(--ease-product) both;");
    expect(css).not.toContain("row-insert");
    expect(css).toContain("@keyframes row-in {");
    expect(css).toContain("@keyframes result-in {");
    expect(css).toContain(".invite-form__result {");
    expect(css).toContain(".friend-share__result {");
    expect(css).toContain("transform-origin: left center;");
    expect(css).toContain("transition: transform var(--motion-state) var(--ease-product), background-color var(--motion-state) var(--ease-product);");
    expect(css).toMatch(/\.allocation-bar__fill\s*\{[\s\S]*?width:\s*100%;[\s\S]*?transform-origin:\s*left center;[\s\S]*?transition:\s*transform var\(--motion-state\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.allocation-bar__fill\s*\{[\s\S]*?transform-origin:\s*left center;[\s\S]*?animation:\s*none !important;[\s\S]*?transition:\s*none !important;/);
    expect(css).not.toMatch(/\.allocation-bar__fill\s*\{[^}]*transform:\s*(?:none|scaleX\(1\))/);
    expect(css).toMatch(/\.task-panel--closing,[\s\S]*?transform:\s*none !important;/);
    expect(expenseShareSource).toContain("style={{ transform: `scaleX(${allocationProgress})` }}");
    expect(repaymentAllocationSource).toContain("style={{ transform: `scaleX(${allocationProgress})` }}");
    expect(expenseShareSource).not.toContain("style={{ width:");
    expect(repaymentAllocationSource).not.toContain("style={{ width:");
    expect(taskPanelSource).toContain("task-panel--closing");
    expect(taskPanelSource).toContain("onTransitionEnd");
    expect(taskPanelSource).not.toContain("onAnimationEnd");
    expect(recordConfirmationSource).toContain('"entering"');
    expect(recordConfirmationSource).toContain('"exiting"');
    expect(recordConfirmationSource).toContain("return null");
  });

  it("uses one stable underline mechanism for friend filters", () => {
    expect(css).not.toContain(".friends-page__view::after");
    expect(css).not.toContain(".friends-page__view--selected::after");
    expect(css).not.toContain(".friends-page__view:hover span");
    expect(css).toMatch(/\.friends-page__view\s*\{[\s\S]*?min-height:\s*2\.75rem;[\s\S]*?text-decoration:\s*none;[\s\S]*?text-decoration-thickness:\s*1px;/);
    expect(css).toMatch(/\.friends-page__view--selected,[\s\S]*?\.friends-page__view:hover,[\s\S]*?\.friends-page__view:focus-visible\s*\{[\s\S]*?text-decoration-line:\s*underline;/);
  });
});
