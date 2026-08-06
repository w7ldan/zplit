import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";

const css = readCssBundle().css;
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

function cssRuleBody(source: string, selector: string) {
  const expected = selector.trim().replace(/\s+/g, " ");
  for (const match of source.matchAll(/(?:^|\n)([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim().replace(/\s+/g, " ") === expected) return match[2];
  }
  return "";
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
    expect(documentation).not.toContain("Authenticated sticky navigation remains geometrically stable while scrolling; it may change surface emphasis but does not change width, position, alignment, or radius.");
    expect(documentation).toContain("Public and authenticated navigation share the same detached-panel transition.");
    expect(documentation).toContain("Prerequisite creation preserves the owner’s original task and returns automatically.");
    expect(documentation).toContain("Optional create-time fields use native progressive disclosure.");
    expect(documentation).toContain("Returned values and validation errors reveal their containing disclosure.");
    expect(documentation).toContain("Edit forms remain direct when hiding controls would obstruct review.");
    expect(documentation).toContain("Creating the prerequisite Friend from Add repayment returns automatically to Repayment entry with that Friend selected.");
    expect(documentation).toContain("search stays visible while secondary list filters may use a native disclosure");
    expect(documentation).toContain("active-filter count excludes free-text search");
    expect(documentation).toContain("Clear filters remains available whenever filtering is active");
    expect(documentation).toContain("Result updates announce concise matching totals, not entire ledger lists.");
    expect(documentation).toContain("New record-filter and mobile-disclosure rules belong in `30-records-and-forms.css`, not the late-override quarantine.");
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

  it("keeps component typography and link treatments authoritative", () => {
    const baselineStart = css.indexOf("/* Explicit Zplit browser baseline. */");
    const componentStart = css.indexOf(".editorial-shell {");
    const baseline = css.slice(baselineStart, componentStart);
    const headingBaseline = cssRuleBody(baseline, "h1, h2, h3, h4, h5, h6");
    const linkBaseline = cssRuleBody(baseline, "a");

    expect(headingBaseline).toContain("font-size: inherit;");
    expect(headingBaseline).toContain("font-weight: inherit;");
    expect(headingBaseline).not.toMatch(/font-weight:\s*(?:[0-9]+|normal|bold|bolder|lighter)/);
    expect(linkBaseline).toContain("color: inherit;");
    expect(linkBaseline).toContain("text-decoration: inherit;");
    expect(linkBaseline).not.toMatch(/text-decoration:\s*(?:none|underline)/);

    expect(cssRuleBody(css, ".app-page__header h1")).toMatch(/font-size:[\s\S]*font-weight: 800;/);
    expect(cssRuleBody(css, ".principle h3")).toMatch(/font-size:[\s\S]*font-weight: 800;/);
    expect(cssRuleBody(css, ".text-link")).toContain("text-decoration: underline;");
    expect(cssRuleBody(css, ".header-shell__nav a")).toContain("text-decoration: none;");
    expect(cssRuleBody(css, ".friends-page__view")).toContain("text-decoration: none;");
    expect(cssRuleBody(css, ".friends-page__view--selected, .friends-page__view:hover, .friends-page__view:focus-visible")).toContain("text-decoration-line: underline;");
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
    expect(cssRuleBody(css, ".repayment-form__disclosure > summary")).toContain("border-radius: var(--radius-control);");
  });

  it("keeps both headers on one centered three-region detached shell", () => {
    const header = cssRuleBody(css, ".header-shell");
    const panel = cssRuleBody(css, ".header-shell__panel");
    const detachedPanel = cssRuleBody(css, ".header-shell__panel--detached");
    expect(header).toContain("position: sticky;");
    expect(header).toContain("pointer-events: none;");
    expect(panel).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);");
    expect(panel).toContain("width: min(calc(100% - 2rem), 90rem);");
    expect(panel).toContain("max-width: 90rem;");
    expect(panel).toContain("border-bottom: 1px solid transparent;");
    expect(panel).toContain("pointer-events: auto;");
    expect(panel).toContain("transition: width var(--motion-state)");
    expect(detachedPanel).toContain("width: min(calc(100% - 2rem), 72rem);");
    expect(detachedPanel).toContain("max-width: 72rem;");
    expect(detachedPanel).toContain("transform: translateY(0.6rem);");
    expect(detachedPanel).toContain("border: 1px solid var(--rule);");
    expect(detachedPanel).toContain("border-radius: var(--radius-panel);");
    expect(detachedPanel).toContain("background: var(--surface);");
    expect(detachedPanel).toContain("box-shadow:");
    expect(cssRuleBody(css, ".header-shell__brand")).toContain("justify-self: start;");
    expect(cssRuleBody(css, ".header-shell__brand > *")).toContain("display: flex;");
    expect(cssRuleBody(css, ".header-shell__brand > *")).toContain("gap: inherit;");
    expect(cssRuleBody(css, ".header-shell__nav")).toContain("justify-self: center;");
    expect(cssRuleBody(css, ".header-shell__actions")).toContain("justify-self: end;");
    expect(css).not.toContain(".app-shell__header--detached {");
    expect(css).not.toContain(".app-shell__header-layout--detached {");
    expect(css).toMatch(/\.header-shell__nav a::after\s*\{[\s\S]*?transition: transform var\(--motion-instant\) var\(--ease-out\);/);
    expect(css).toMatch(/\.header-shell__nav a:hover::after,[\s\S]*?\.header-shell__nav a\[aria-current="page"\]::after\s*\{[\s\S]*?transform: scaleX\(1\);/);
    expect(cssRuleBody(css, ".app-shell__nav-link:hover, .app-shell__nav-link:focus-visible")).toContain("color: var(--ink);");
    expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.header-shell__panel\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/@media \(max-width: 1023px\)\s*\{[\s\S]*?\.app-shell__mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
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
