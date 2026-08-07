import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";

const css = readCssBundle().css;
const publicSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/10-public.css"), "utf8");
const authenticatedShellSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/20-authenticated-shell.css"), "utf8");
const recordsAndFormsSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/30-records-and-forms.css"), "utf8");
const lateOverridesSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/90-late-overrides.css"), "utf8");
const siteHeaderSource = readFileSync(path.resolve(process.cwd(), "src/components/editorial/site-header.tsx"), "utf8");
const documentation = readFileSync(path.resolve(process.cwd(), "docs/design-system.md"), "utf8");
const scaleDocumentation = readFileSync(path.resolve(process.cwd(), "docs/scale-testing.md"), "utf8");
const recordPageSources = [
  "friends",
  "outings",
  "expenses",
  "repayments",
].map((name) => readFileSync(path.resolve(process.cwd(), `src/app/app/${name}/page.tsx`), "utf8"));
const selectorActionSources = [
  readFileSync(path.resolve(process.cwd(), "src/app/app/expenses/actions.ts"), "utf8"),
  readFileSync(path.resolve(process.cwd(), "src/app/app/repayments/actions.ts"), "utf8"),
];
const taskPanelSource = readFileSync(path.resolve(process.cwd(), "src/components/app/task-panel.tsx"), "utf8");
const recordConfirmationSource = readFileSync(path.resolve(process.cwd(), "src/components/app/record-confirmation.tsx"), "utf8");
const expenseShareSource = readFileSync(path.resolve(process.cwd(), "src/components/expenses/expense-share-editor.tsx"), "utf8");
const repaymentAllocationSource = readFileSync(path.resolve(process.cwd(), "src/components/repayments/repayment-allocation-editor.tsx"), "utf8");
const expenseFormSource = readFileSync(path.resolve(process.cwd(), "src/components/expenses/expense-form.tsx"), "utf8");
const repaymentFormSource = readFileSync(path.resolve(process.cwd(), "src/components/repayments/repayment-form.tsx"), "utf8");

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
  it("keeps record selectors shared and bounded at the form boundary", () => {
    for (const source of [expenseFormSource, repaymentFormSource]) {
      expect(source).toContain("SearchableCombobox");
      expect(source).not.toContain("InferSelectModel");
    }
  });

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
    expect(css).toContain(".toast-viewport");
    expect(css).toContain("width: min(26rem, calc(100vw - 2rem))");
    expect(css).toContain("bottom: calc(4.5rem + env(safe-area-inset-bottom) + 0.75rem)");
    expect(css).toContain("clip-path: inset(0 0 100%)");
    expect(css).toContain(".toast {\n    clip-path: none !important;");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.toast,[\s\S]*?animation: none !important;/);
  });

  it("keeps financial clarity editorial, bounded, and in its owning fragments", () => {
    expect(authenticatedShellSource).toContain(".overview-ledger-clarity");
    expect(recordsAndFormsSource).toContain(".friend-record__balance");
    expect(recordsAndFormsSource).not.toContain(".expense-share-editor__clarity");
    expect(recordsAndFormsSource).not.toContain(".repayment-allocation-editor__clarity");
    expect(lateOverridesSource).not.toMatch(/overview-ledger-clarity|friend-record__balance|expense-share-editor__clarity|repayment-allocation-editor__clarity/);

    const financialClarityCss = [
      cssRuleBody(css, ".overview-ledger-clarity"),
      cssRuleBody(css, ".friend-record__balance"),
      cssRuleBody(css, ".expense-share-editor__clarity, .repayment-allocation-editor__clarity"),
    ].join("\n");
    expect(financialClarityCss).not.toMatch(/border-radius|background|box-shadow|\b(?:width|min-width):/);

    const mobileFinancialClarityRule = authenticatedShellSource.match(
      /@media \(max-width: 767px\) \{\s*(\.overview-ledger-clarity__relations > section\s*\{[^{}]*\})\s*\}/,
    )?.[1] ?? "";
    expect(mobileFinancialClarityRule).toContain("grid-template-columns: 1fr;");
    expect(mobileFinancialClarityRule).not.toMatch(/overflow-x|\b(?:width|min-width|max-width):/);
    expect(cssRuleBody(css, ".overview-ledger-clarity__relations > section")).toContain("grid-template-columns: minmax(0, 0.35fr) minmax(0, 1.65fr);");
    expect(cssRuleBody(css, ".overview-ledger-clarity > summary")).toContain("list-style: none;");
    expect(css).not.toContain(".overview-ledger-clarity dl");
    expect(lateOverridesSource).not.toContain("overview-ledger-clarity");
  });

  it("keeps authenticated geometry shared and public geometry unchanged", () => {
    expect(cssRuleBody(css, ".editorial-shell")).toContain("width: min(calc(100% - 2rem), 90rem);");
    expect(cssRuleBody(css, ".header-shell__panel")).toContain("max-width: 90rem;");
    expect(cssRuleBody(css, ".header-shell__panel--detached")).toContain("max-width: 72rem;");
    expect(authenticatedShellSource).toContain(".app-shell .editorial-shell {");
    expect(authenticatedShellSource).toContain("width: min(calc(100% - 2rem), 76rem);");
    expect(authenticatedShellSource).toContain("max-width: 76rem;");
    expect(authenticatedShellSource).toContain(".app-shell .header-shell__panel,");
    expect(authenticatedShellSource).toContain(".app-shell .header-shell__panel--detached {");
    expect(authenticatedShellSource).toContain("width: min(calc(100% - 1.5rem), 76rem);");
  });

  it("keeps detail grids owned, stable, and mobile-safe", () => {
    expect(recordsAndFormsSource).not.toContain("grid-column: 1 / span 6");
    expect(recordsAndFormsSource).toContain("grid-template-columns: repeat(12, minmax(0, 1fr));");
    expect(recordsAndFormsSource).toContain("grid-column: 1 / span 8;");
    expect(recordsAndFormsSource).toContain("grid-column: 9 / -1;");
    expect(recordsAndFormsSource).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.friend-record__form,[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?\.expense-record__tasks,[\s\S]*?grid-template-columns: 1fr;/);
    expect(recordsAndFormsSource).not.toContain("overflow-x: clip");
  });

  it("keeps repayment allocation search and selected rows mobile-safe", () => {
    expect(repaymentFormSource).toContain("Add outstanding expense");
    expect(repaymentFormSource).toContain("Search outstanding expenses");
    expect(repaymentFormSource).toContain("SearchableCombobox");
    expect(repaymentFormSource).toContain("selectedAllocationIds");
    expect(repaymentFormSource).toContain('type="button"');
    expect(cssRuleBody(recordsAndFormsSource, ".repayment-form__allocations, .repayment-form__allocation-add, .repayment-form__allocation, .repayment-form__allocation-fallback")).toMatch(/min-width:\s*0;[\s\S]*gap:/);
    expect(cssRuleBody(recordsAndFormsSource, ".repayment-form__allocation-details")).toMatch(/min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere;/);
    expect(recordsAndFormsSource).not.toContain(".repayment-form__allocation {\n    min-width: max-content");
  });

  it("keeps desktop record columns semantic and aligned", () => {
    expect(recordsAndFormsSource).toMatch(/@media \(min-width: 960px\)[\s\S]*?\.expense-row__meta,[\s\S]*?\.repayment-row__meta\s*\{[\s\S]*?display: contents;/);
    expect(recordsAndFormsSource).toContain("minmax(0, 2fr) minmax(7rem, auto) minmax(7rem, auto)");
    expect(recordsAndFormsSource).toContain("minmax(0, 2fr) minmax(7rem, auto) minmax(8rem, auto)");
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
    expect(cssRuleBody(css, "html")).toContain("scrollbar-gutter: stable;");
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
    expect(cssRuleBody(css, ".expense-form__actions")).toMatch(/display:\s*flex;[\s\S]*gap:\s*0\.75rem;/);
  });

  it("keeps long record values inside bounded rows while leaving detail values unclamped", () => {
    expect(css).toMatch(/\.friend-row,[\s\S]*?\.repayment-row\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.friend-row__primary h2 a,[\s\S]*?\.repayment-row__primary h2 a\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/);
    expect(css).toMatch(/\.friend-row__meta > \*,[\s\S]*?\.repayment-row__meta > \*\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.balance-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
    expect(css).toMatch(/\.activity-row small\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/);
    expect(css).toMatch(/\.friend-record__intro h1,[\s\S]*?\.repayment-record__intro h1\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
    expect(cssRuleBody(css, ".friend-record__intro h1, .outing-record__intro h1, .expense-record__intro h1, .repayment-record__intro h1")).not.toContain("-webkit-line-clamp");
  });

  it("keeps scale-sized server results bounded at the page and selector boundaries", () => {
    for (const source of recordPageSources) {
      expect(source).toMatch(/(?:friendPage|outingPage|expensePage|repaymentPage)\.items/);
      expect(source).not.toMatch(/repository\.list(?:Friends|Outings|Expenses|Repayments)\s*\(/);
    }
    for (const source of selectorActionSources) {
      expect(source).toMatch(/search(?:Outings|Friends)/);
      expect(source).not.toMatch(/\.list(?:Outings|Friends)\s*\(/);
    }
    for (const budget of [
      "overview summary: at most 500 ms",
      "recent activity: at most 100 ms",
      "each record page query: at most 300 ms",
      "each selector search: at most 200 ms",
      "selected-friend context: at most 300 ms",
    ]) expect(scaleDocumentation).toContain(budget);
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
    expect(cssRuleBody(css, ".public-home .site-header.header-shell__panel--detached")).toContain("padding-inline: 1rem;");
    expect(css).not.toContain(".app-shell__header--detached {");
    expect(css).not.toContain(".app-shell__header-layout--detached {");
    expect(css).toMatch(/\.header-shell__nav a::after\s*\{[\s\S]*?transition: transform var\(--motion-instant\) var\(--ease-out\);/);
    expect(css).toMatch(/\.header-shell__nav a:hover::after,[\s\S]*?\.header-shell__nav a\[aria-current="page"\]::after\s*\{[\s\S]*?transform: scaleX\(1\);/);
    expect(cssRuleBody(css, ".app-shell__nav-link:hover, .app-shell__nav-link:focus-visible")).toContain("color: var(--ink);");
    expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.header-shell__panel\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/@media \(max-width: 1023px\)\s*\{[\s\S]*?\.app-shell__mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
  });

  it("keeps the landing access link on the shared primary action treatment", () => {
    const header = cssRuleBody(publicSource, ".public-home .site-header");
    const detachedHeader = cssRuleBody(publicSource, ".public-home .site-header.header-shell__panel--detached");
    const wrapper = cssRuleBody(publicSource, ".public-home .site-header-wrapper");
    const detachedWrapper = cssRuleBody(publicSource, ".public-home .site-header-wrapper.header-shell--detached");
    const access = cssRuleBody(publicSource, ".public-home .site-header__access");
    const primary = cssRuleBody(css, ".action-link--primary");

    expect(siteHeaderSource).toContain("import { ActionLink } from \"@/components/editorial/action-link\";");
    expect(siteHeaderSource).toContain('actions={<ActionLink href="/app" variant="primary" className="site-header__access">Open Zplit</ActionLink>}');
    expect(wrapper).toContain("background: var(--paper);");
    expect(detachedWrapper).toContain("background: transparent;");
    expect(header).toContain("background: var(--paper);");
    expect(detachedHeader).toContain("background: var(--paper);");
    expect(access).toContain("min-height: 2.25rem;");
    expect(access).toContain("border-radius: var(--radius-control);");
    expect(access).not.toMatch(/\b(?:background|border|color):/);
    expect(primary).toContain("background: var(--ink);");
    expect(primary).toContain("color: var(--paper);");
    expect(css).toMatch(/\.action-link--primary:hover,[\s\S]*?\.action-link--primary:focus-visible\s*\{[\s\S]*?background: var\(--pastel-blue\);[\s\S]*?color: var\(--ink\);/);
  });

  it("keeps public landing header ownership out of authenticated shell CSS", () => {
    expect(authenticatedShellSource).not.toContain(".site-header");
    expect(authenticatedShellSource).not.toContain(".public-home");
    expect(publicSource).toContain(".public-home .site-header__access");
    expect(publicSource).toContain(".public-home .site-header.header-shell__panel--detached");
  });

  it("keeps the public mobile header grid in the public fragment", () => {
    expect(publicSource).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.public-home \.site-header\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
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
