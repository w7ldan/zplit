import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";

const css = readCssBundle().css;
const foundationSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/00-foundation.css"), "utf8");
const publicSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/10-public.css"), "utf8");
const authenticatedShellSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/20-authenticated-shell.css"), "utf8");
const recordsAndFormsSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/30-records-and-forms.css"), "utf8");
const motionSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/40-motion-and-feedback.css"), "utf8");
const lateOverridesSource = readFileSync(path.resolve(process.cwd(), "src/app/styles/90-late-overrides.css"), "utf8");
const siteHeaderSource = readFileSync(path.resolve(process.cwd(), "src/components/editorial/site-header.tsx"), "utf8");
const documentation = readFileSync(path.resolve(process.cwd(), "docs/design-system.md"), "utf8");
const scaleDocumentation = readFileSync(path.resolve(process.cwd(), "docs/testing.md"), "utf8");
const recordPageSources = [
  "friends",
  "trips",
  "outings",
  "expenses",
  "repayments",
].map((name) => readFileSync(path.resolve(process.cwd(), `src/app/app/${name}/page.tsx`), "utf8"));
const selectorActionSources = [
  readFileSync(path.resolve(process.cwd(), "src/app/app/expenses/actions.ts"), "utf8"),
  readFileSync(path.resolve(process.cwd(), "src/app/app/repayments/actions.ts"), "utf8"),
];
const taskPanelSource = readFileSync(path.resolve(process.cwd(), "src/components/app/task-panel.tsx"), "utf8");
const searchableComboboxSource = readFileSync(path.resolve(process.cwd(), "src/components/records/searchable-combobox.tsx"), "utf8");
const taskPanelRule = cssRuleBody(css, ".task-panel");
const recordConfirmationSource = readFileSync(path.resolve(process.cwd(), "src/components/app/record-confirmation.tsx"), "utf8");
const expenseShareSource = readFileSync(path.resolve(process.cwd(), "src/components/expenses/expense-share-editor.tsx"), "utf8");
const repaymentAllocationSource = readFileSync(path.resolve(process.cwd(), "src/components/repayments/repayment-allocation-editor.tsx"), "utf8");
const journeySource = readFileSync(path.resolve(process.cwd(), "src/components/editorial/journey-showcase.tsx"), "utf8");
const landingMotionSource = readFileSync(path.resolve(process.cwd(), "src/components/editorial/landing-reveal.tsx"), "utf8");
const publicPageSource = readFileSync(path.resolve(process.cwd(), "src/app/page.tsx"), "utf8");
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

function cssAtRuleBodies(source: string, atRule: string) {
  const bodies: string[] = [];
  let searchFrom = 0;
  while (true) {
    const start = source.indexOf(`${atRule} {`, searchFrom);
    if (start < 0) return bodies;
    const open = source.indexOf("{", start);
    let depth = 1;
    for (let index = open + 1; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}" && --depth === 0) {
        bodies.push(source.slice(open + 1, index));
        searchFrom = index + 1;
        break;
      }
    }
  }
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
    expect(cssRuleBody(css, ".overview-ledger-clarity > summary")).toContain("font-size: 0.875rem;");
    expect(cssRuleBody(css, ".overview-ledger-clarity > summary")).toContain("font-weight: 700;");
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

  it("keeps public and authenticated large canvases on the paper token", () => {
    const appShellRules = [...authenticatedShellSource.matchAll(/\.app-shell\s*\{([^{}]*)\}/g)].map((match) => match[1]);

    expect(publicSource).toContain(".public-home { background: var(--paper); }");
    expect(appShellRules.at(-1)).toContain("background: var(--paper);");
    expect(cssRuleBody(authenticatedShellSource, ".app-page")).toContain("background: var(--paper);");
    expect(authenticatedShellSource).not.toMatch(/\.app-shell\s*\{[^{}]*background:\s*var\(--surface\)/);
    expect(authenticatedShellSource).not.toMatch(/\.app-page\s*\{[^{}]*background:\s*var\(--surface\)/);
    expect(cssRuleBody(lateOverridesSource, ".login-form")).toContain("background: var(--surface);");
  });

  it("keeps trip detail wide and repayment activity labels on one line", () => {
    expect(recordsAndFormsSource).toContain(".trip-record__meta,\n  .trip-record__financials,\n  .trip-record__settlement,\n  .trip-record__outings {\n    grid-column: 1 / -1;");
    expect(authenticatedShellSource).toContain("grid-template-columns: minmax(4.5rem, max-content) minmax(0, 1fr) auto;");
    expect(authenticatedShellSource).toContain(".activity-row > span:first-child");
    expect(authenticatedShellSource).toContain("white-space: nowrap;");
  });

  it("keeps authenticated list workspaces and medium history rows staged", () => {
    expect(recordsAndFormsSource).toContain(".records-workspace__toolbar");
    expect(recordsAndFormsSource).toContain(".friends-toolbar");
    expect(recordsAndFormsSource).toMatch(/@media \(min-width: 768px\) and \(max-width: 1099px\)[\s\S]*?\.history-row__link[\s\S]*?grid-template-columns: minmax\(4\.8rem, max-content\) minmax\(0, 1fr\);[\s\S]*?\.history-row__values[\s\S]*?grid-column: 2;/);
    expect(authenticatedShellSource).toContain(".overview-ledger-clarity {\n  border-block: 0;");
  });

  it("keeps authenticated record ownership out of public, motion, and late CSS", () => {
    for (const selector of [".invites-page__columns", ".expense-receipts", ".history-row__link", ".exports-row", ".delete-record-form"]) {
      expect(publicSource).not.toContain(selector);
      expect(recordsAndFormsSource).toContain(selector);
    }

    expect(motionSource).not.toContain(".expense-record__layout");
    expect(motionSource).not.toContain(".repayment-record__layout");
    expect(lateOverridesSource).not.toContain(".live-record-filters {");
    expect(lateOverridesSource).not.toContain(".record-pagination {");
    expect(lateOverridesSource).not.toContain(".repayment-form__allocations");
    expect(lateOverridesSource).not.toContain(".friend-share__");
    expect(authenticatedShellSource).not.toMatch(/\.(?:friend|outing|expense|repayment)-(?:row|form)(?:__|\s*\{)/);
    expect(recordsAndFormsSource).toContain(".friend-row {");
    expect(recordsAndFormsSource).toContain(".friend-form {");
    expect(recordsAndFormsSource).toContain(".friends-toolbar {");
    expect(authenticatedShellSource).not.toMatch(/\.outing-record__meta\s*\{/);
    expect(authenticatedShellSource).not.toMatch(/\.expense-record__meta\s*\{/);
    expect(authenticatedShellSource).not.toMatch(/\.repayment-record__meta\s*\{/);
  });

  it("keeps Friend history actions stacked and aligned by their owning layout", () => {
    expect(cssRuleBody(css, ".record-history__links")).toMatch(/display:\s*grid;[\s\S]*justify-items:\s*start;[\s\S]*gap:\s*0\.35rem;/);
    expect(recordsAndFormsSource).toContain(".record-history__row:not(.record-history__row--share) > .record-history__link");
    expect(recordsAndFormsSource).toMatch(/@media \(min-width: 960px\)[\s\S]*?\.record-history__links\s*\{[\s\S]*?justify-items:\s*end;/);
    expect(cssRuleBody(recordsAndFormsSource, ".record-history__link")).not.toContain("justify-self: end;");
  });

  it("keeps Friend detail ownership and workspace anchors intentional", () => {
    expect(recordsAndFormsSource).toContain(".friend-record__title");
    expect(recordsAndFormsSource).toContain(".friend-record__summary {");
    expect(recordsAndFormsSource).toContain(".friend-record__workspace {");
    expect(recordsAndFormsSource).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);");
    expect(authenticatedShellSource).not.toContain(".friend-record__meta");
    expect(authenticatedShellSource).not.toContain(".friend-record__form");
    expect(lateOverridesSource).not.toContain(".friend-share {");
  });

  it("keeps the desktop Journey on a centered narrower working canvas", () => {
    const desktopStart = publicSource.indexOf("@media (min-width: 960px) and (min-height: 720px) {");
    const mobileStart = publicSource.indexOf("@media (max-width: 959px) {");
    const desktop = publicSource.slice(desktopStart, mobileStart);
    const journeyWidth = "width: min(calc(100% - clamp(4rem, 10vw, 10rem)), 72rem);";

    expect(desktopStart).toBeGreaterThanOrEqual(0);
    expect(mobileStart).toBeGreaterThan(desktopStart);
    expect(desktop).toContain(`.journey-editorial, .journey-stage { ${journeyWidth} margin-inline: auto; }`);
    expect(publicSource).not.toContain("width: min(calc(100% - clamp(4rem, 10vw, 10rem)), 82rem);");
    expect(publicSource.slice(0, desktopStart)).not.toContain(journeyWidth);
    expect(publicSource.slice(mobileStart)).not.toContain(journeyWidth);

    for (const viewport of [1280, 1366, 1440, 1477, 1536, 1920]) {
      const gutter = Math.min(10 * viewport / 100, 10 * 16);
      const width = Math.min(viewport - gutter, 72 * 16);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(1152);
    }
    const viewport = 1477;
    const width = Math.min(viewport - Math.min(10 * viewport / 100, 10 * 16), 72 * 16);
    expect(width).toBe(1152);
    expect((viewport - width) / 2).toBeCloseTo(162.5, 1);
  });

  it("keeps compact Journey density bounded to short pinned desktops", () => {
    const desktopStart = publicSource.indexOf("@media (min-width: 960px) and (min-height: 720px) {");
    const compactStart = publicSource.indexOf("@media (min-width: 960px) and (min-height: 720px) and (max-height: 850px) {");
    const mobileStart = publicSource.indexOf("@media (max-width: 959px) {");
    const compact = publicSource.slice(compactStart, mobileStart);
    const normalDesktop = publicSource.slice(desktopStart, compactStart);

    expect(compactStart).toBeGreaterThan(desktopStart);
    expect(mobileStart).toBeGreaterThan(compactStart);
    expect(compact).toContain(".journey-sticky--pinned {");
    for (const value of [
      "--journey-tab-height: 2.35rem",
      "--journey-tab-number-size: 1.2rem",
      "--journey-announcement-min-height: 2.9rem",
      "--journey-announcement-heading-size: 1.35rem",
      "--journey-frame-body-padding: 0.55rem 1rem",
      "--journey-scene-gap: 1.25rem",
      "--journey-row-height: 2.15rem",
      "--journey-share-row-height: 1.7rem",
    ]) expect(compact).toContain(value);
    expect(normalDesktop).toContain("--journey-tab-height: 2.65rem");
    expect(normalDesktop).toContain("--journey-announcement-min-height: 3.4rem");
    expect(normalDesktop).toContain("--journey-row-height: 2.4rem");
    expect(publicSource.slice(0, compactStart)).not.toContain("max-height: 850px");
    expect(publicSource.slice(mobileStart)).not.toContain("max-height: 850px");
  });

  it("keeps detail grids owned, stable, and mobile-safe", () => {
    expect(recordsAndFormsSource).not.toContain("grid-column: 1 / span 6");
    expect(recordsAndFormsSource).not.toContain("grid-column: 2 / span 5");
    for (const selector of [".outing-record__summary", ".outing-record__workspace", ".expense-record__controls", ".repayment-record__controls", ".trip-record__summary"]) {
      expect(recordsAndFormsSource).toContain(selector);
    }
    expect(recordsAndFormsSource).toContain("grid-template-columns: repeat(12, minmax(0, 1fr));");
    expect(recordsAndFormsSource).toContain("grid-column: 1 / span 8;");
    expect(recordsAndFormsSource).toContain("grid-column: 9 / -1;");
    expect(recordsAndFormsSource).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.friend-record__workspace\s*\{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?\.expense-record__tasks,[\s\S]*?grid-template-columns: 1fr;/);
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

  it("keeps repayment allocation editing wide and visually staged", () => {
    expect(recordsAndFormsSource).toContain(".repayment-allocation-editor__form {\n  display: grid;\n  width: 100%;\n  max-width: none;");
    expect(recordsAndFormsSource).toContain("grid-template-columns: minmax(0, 1.6fr) minmax(16rem, 0.8fr);");
    expect(recordsAndFormsSource).toContain(".repayment-allocation-editor__submit {\n  width: fit-content;\n  justify-self: start;");
    expect(recordsAndFormsSource).toContain(".repayment-allocation-editor > .record-pagination {\n  margin-top: 1rem;");
    expect(recordsAndFormsSource).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.repayment-allocation-editor__row\s*\{[\s\S]*?grid-template-columns: 1fr;/);
    expect(lateOverridesSource).not.toMatch(/repayment-allocation-editor__(?:form|row|submit)|repayment-allocation-editor\s*>\s*\.record-pagination/);
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
    expect(cssRuleBody(css, ".capability__copy h2")).toMatch(/font-size:[\s\S]*font-weight: 800;/);
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
    expect(css).not.toContain("height: calc(100svh - var(--journey-sticky-top) - var(--journey-bottom-clearance))");
    expect(css).toContain(".journey-scene__body");
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

  it("keeps the persistent journey readable without a clipping viewport", () => {
    const editorialHeading = journeySource.indexOf('className="section-heading"');
    const editorialIntro = journeySource.indexOf('className="section-intro"');
    const runwayBoundary = journeySource.indexOf('className="journey-runway"');
    const interactiveJourney = journeySource.indexOf('className="product-journey"');

    expect(editorialHeading).toBeGreaterThanOrEqual(0);
    expect(editorialIntro).toBeGreaterThan(editorialHeading);
    expect(runwayBoundary).toBeGreaterThan(editorialIntro);
    expect(interactiveJourney).toBeGreaterThan(runwayBoundary);
    expect(journeySource).toContain('className="journey-panel journey-panel--active"');
    expect(journeySource).toContain('data-journey-layout="persistent-ledger"');
    expect(journeySource).toContain('className="journey-scene__body" data-repayment-active={showRepayment}');
    expect(journeySource).toContain('className="journey-scene__main"');
    expect(journeySource).toContain('className="journey-scene__summary"');
    expect(journeySource).toContain('data-expense={expense.description}');
    expect(journeySource).toContain('data-layout={showExpenses ? "expanded" : "collapsed"}');
    expect(journeySource).toContain('data-layout={showShares ? "expanded" : "collapsed"}');
    expect(journeySource).toContain('data-layout={showRepaymentState ? "expanded" : "collapsed"}');
    expect(journeySource).toContain('data-layout={showBalances ? "expanded" : "collapsed"}');
    expect(journeySource).toContain('data-summary-slot="state"');
    expect(journeySource).toContain('data-summary-state="repayment"');
    expect(journeySource).toContain('data-summary-state="balances"');
    expect(journeySource).toContain('aria-hidden={!showRepaymentState}');
    expect(journeySource).toContain('aria-hidden={!showBalances}');
    expect(journeySource).toContain('const next = Boolean(wide?.matches && tall?.matches && !reduced?.matches);');
    expect(journeySource).not.toContain("fitsNaturalStage");
    expect(journeySource).not.toContain("new ResizeObserver");
    expect(journeySource).not.toContain("journey-frame__intro");
    expect(publicSource).toMatch(/\.product-journey\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(publicSource).toContain(".journey-scene__section-content");
    expect(publicSource).toMatch(/\.journey-scene__body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 7fr\) minmax\(0, 5fr\);/);
    expect(publicSource).not.toMatch(/\.journey-scene__body\s*\{[^}]*repeat\(3,/);
    expect(publicSource).not.toMatch(/\.journey-panel\s*\{[^}]*grid-template-columns/);
    expect(publicSource).not.toMatch(/\.journey-sticky--pinned[^{}]*\{[^}]*(?<![a-z-])height:/);
    expect(publicSource).not.toContain("max-height: 900px");
    expect(publicSource).not.toContain("max-height: 820px");
    expect(publicSource).not.toContain("max-height: 60rem");
    expect(publicSource).not.toContain("min-height: 30rem");
    expect(publicSource).toMatch(/\.journey-scene__section\s*\{[^}]*grid-template-rows:\s*0fr;/);
    expect(publicSource).toMatch(/\.journey-scene__section\[data-visible="true"\]\s*\{[^}]*grid-template-rows:\s*1fr;/);
    expect(publicSource).toMatch(/\.journey-expense-row__shares\s*\{[^}]*grid-template-rows:\s*0fr;/);
    expect(publicSource).toMatch(/\.journey-allocation\s*\{[^}]*grid-template-rows:\s*0fr;/);
    expect(publicSource).toContain(".journey-scene__section-reveal");
    expect(publicSource).toContain(".journey-expense-row__shares-reveal");
    expect(publicSource).toContain(".journey-allocation__content");
    expect(publicSource).toContain(".journey-summary__state-slot");
    expect(publicSource).toMatch(/@media \(min-width: 960px\) and \(min-height: 720px\)[\s\S]*?\.journey-sticky--pinned \.journey-scene__expenses[\s\S]*?grid-template-rows:\s*1fr;/);
    expect(publicSource).toMatch(/@media \(min-width: 960px\) and \(min-height: 720px\)[\s\S]*?\.journey-sticky--pinned \.journey-summary__state-slot[\s\S]*?display:\s*grid;/);
    for (const selector of [".journey-frame", ".journey-frame__body", ".journey-panel", ".journey-scene__body", ".journey-scene__section", ".journey-scene__section-content"]) {
      expect(cssRuleBody(publicSource, selector)).not.toMatch(/overflow(?:-y)?:\s*(?:auto|hidden)/);
    }
    expect(publicSource).toMatch(/@media \(min-width: 960px\) and \(min-height: 720px\)[\s\S]*?\.journey-sticky--pinned\s*\{[^}]*position:\s*sticky;/);
    expect(publicSource).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.journey-scene__body\s*\{[^}]*grid-template-columns:\s*1fr;/);
    const journeyMobileStart = publicSource.indexOf("@media (max-width: 767px)", publicSource.indexOf(".journey-sticky--pinned"));
    const journeyMobileEnd = publicSource.indexOf("@media (prefers-reduced-motion: reduce)", journeyMobileStart);
    expect(publicSource.slice(journeyMobileStart, journeyMobileEnd)).not.toContain(".journey-sticky--pinned .journey-summary__state-slot");
    expect(publicSource).toContain("transform: scaleX(var(--allocation, 0))");
    expect(publicSource).toContain(".journey-share-detail--covered");
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.journey-share-detail--covered/);
    expect(journeySource).toContain('role="progressbar"');
    expect(journeySource).toContain('aria-valuenow={showRepaymentState ? scenario.repayment.amount : 0}');
  });

  it("keeps public journey ownership in the public stylesheet", () => {
    expect(publicSource).toContain(".journey-scene__body");
    expect(publicSource).toContain(".landing-reveal");
    expect(publicSource).toContain(".capability--search");
    expect(publicSource).toContain(".capability--receipt");
    expect(publicSource).toContain(".capability--private");
    expect(publicSource).toContain(".story-close");
    expect(lateOverridesSource).not.toContain(".journey-");
    expect(lateOverridesSource).not.toContain(".landing-reveal");
    expect(lateOverridesSource).not.toContain(".public-home");
  });

  it("keeps ledger physicality decorative, restrained, and motion-safe", () => {
    expect(journeySource).toContain('data-journey-connectors="desktop"');
    expect(journeySource).toContain('aria-hidden="true"');
    for (const relationship of ["dinner-share", "taxi-share", "repayment-dinner-rani", "repayment-taxi-rani"]) expect(journeySource).toContain(`data-relationship="${relationship}"`);
    expect(journeySource).toContain("ledgerBranchPath");
    expect(journeySource).toContain("data-connector-anchor");
    expect(journeySource).toContain("frameElement.getBoundingClientRect()");
    expect(journeySource).toContain("reconcileConnectors");
    expect(journeySource).toContain("--journey-connector-share-progress");
    expect(journeySource).toContain("--journey-connector-repayment-progress");
    expect(publicSource).toContain("pointer-events: none");
    expect(publicSource).toContain("stroke-dasharray: 1");
    expect(publicSource).toContain(".journey-connectors { display: none;");
    expect(publicSource).toMatch(/@media \(min-width: 960px\) and \(min-height: 720px\)[\s\S]*?\.journey-connectors \{ display: block; \}/);
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.journey-connectors \{ display: none !important; \}/);
    expect(publicSource).toContain("perspective: 1200px;");
    expect(publicSource).toContain("transform: translateY(0) rotateX(0.75deg) rotateZ(-0.35deg)");
    expect(publicSource).toContain("rotateX(5deg) rotateZ(-1deg)");
    expect(publicSource).toContain("transform-origin: 50% 0;");
    expect(publicSource).not.toContain(".expense-proof__receipt:hover");
    expect(publicSource).not.toContain("mousemove");
    expect(publicSource).not.toContain("pointermove");
    expect(publicSource).toContain("perspective(1400px)");
    expect(publicSource).toContain("rotateX(calc(var(--ledger-handoff-depth");
    expect(publicSource).toContain(".public-home .hero__ledger-depth");
    expect(publicSource).toContain(".ledger-handoff__depth");
    expect(publicSource).toMatch(/\.ledger-handoff\s*\{[^}]*transform:\s*translate3d\([^}]+\);/);
    expect(publicSource).toMatch(/\.ledger-handoff__depth\s*\{[^}]*transform:\s*perspective\(1400px\)/);
    expect(landingMotionSource).toContain("--ledger-handoff-depth");
    expect(publicPageSource).toContain("className=\"hero__ledger-depth\"");
    expect(publicPageSource).toContain("className=\"ledger-amount tabular-nums\"");
    expect(publicPageSource.match(/ledger-amount/g)?.length).toBeGreaterThanOrEqual(7);
    expect(publicSource).toContain("font-feature-settings: \"tnum\"");
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.public-home \.hero__ledger-depth, \.ledger-handoff__depth \{ transform: none !important; \}/);
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.capability--receipt \.expense-proof \{ perspective: none; \}/);
  });

  it("keeps the public ledger handoff structural, coordinated, and motion-safe", () => {
    expect(publicPageSource).toContain('import { bandungStory }');
    expect(journeySource).toContain('bandungStory as scenario');
    expect(journeySource).toContain('from "./public-scenario"');
    expect(publicPageSource).toContain('data-ledger-handoff');
    expect(publicPageSource).toContain('Rani assigned');
    expect(publicPageSource).not.toContain("Rani&apos;s share");
    expect(publicPageSource).not.toContain("The same ledger continues");
    expect(publicPageSource).not.toContain('data-story-motion="handoff"');
    expect(publicSource).toContain("height: 30vh");
    expect(publicSource).not.toContain("min-height: 42vh");
    expect(publicSource).not.toContain(".story-motion--visible .ledger-handoff");
    expect(publicSource).not.toMatch(/ledger-handoff[^}]*520ms/);
    expect(publicSource).toContain("--ledger-handoff-width");
    expect(publicSource).toContain("--ledger-handoff-x");
    expect(publicSource).toContain("--ledger-handoff-y");
    expect(publicSource).toMatch(/\.ledger-handoff\s*\{[^}]*position:\s*absolute;/);
    expect(landingMotionSource).toContain("ledgerHandoffProgress(window.scrollY, start, travel)");
    expect(landingMotionSource).toContain("ledgerHandoffTravel(window.innerHeight)");
    expect(landingMotionSource).not.toContain("runway.offsetHeight");
    expect(landingMotionSource).toContain("heroLedger?.getBoundingClientRect()");
    expect(landingMotionSource).toContain("journeyFrame?.getBoundingClientRect()");
    expect(landingMotionSource).toContain('window.requestAnimationFrame(update)');
    expect(landingMotionSource).toContain('window.addEventListener("pageshow", onPageShow)');
    expect(landingMotionSource).not.toMatch(/setState|set[A-Z][A-Za-z]+\(progress/);
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ledger-handoff-runway \{ display: none !important; \}/);
  });

  it("keeps the payoff amount visible first and resolves later states without a blank flow box", () => {
    expect(publicPageSource).toMatch(/className="payoff"[\s\S]*?<strong[^>]*data-payoff-state="amount"[^>]*>\{openBalance\}<\/strong>/);
    expect(publicPageSource).toMatch(/data-payoff-state="amount"[\s\S]*?data-payoff-state="row"[\s\S]*?data-payoff-state="cta"/);
    expect(landingMotionSource).toContain('[data-story-motion="finale"]');
    expect(landingMotionSource).toContain("--payoff-row-progress");
    expect(landingMotionSource).toContain("--payoff-cta-progress");
    expect(landingMotionSource).toContain(':not([data-story-motion="finale"])');
    expect(publicSource).not.toContain(".story-motion--visible .payoff > strong");
    expect(publicSource).toMatch(/\.payoff\s*\{[^}]*grid-template-rows:[^;}]*clamp\(/);
    expect(publicSource).toMatch(/\.payoff > strong\s*\{[^}]*grid-area:\s*2 \/ 1;/);
    expect(publicSource).toMatch(/\.payoff__row\s*\{[^}]*grid-area:\s*2 \/ 1;/);
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.payoff\s*\{\s*display:\s*block;/);
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.payoff__row\s*\{[^}]*margin-top:/);
  });

  it("scopes pinned share and repayment interpolation to persistent visual subtrees", () => {
    expect(publicSource).not.toMatch(/\.journey-sticky--pinned \.journey-expense-row:first-child \.journey-row/);
    expect(publicSource).not.toMatch(/\.journey-sticky--pinned \.journey-expense-row:nth-child\(2\) \.journey-row/);
    expect(publicSource).toContain(".journey-sticky--pinned .journey-expense-row:first-child .journey-expense-row__shares-reveal > .journey-row:first-child");
    expect(publicSource).toContain(".journey-sticky--pinned .journey-expense-row:first-child .journey-expense-row__shares-reveal > .journey-row:nth-child(2)");
    expect(publicSource).toContain(".journey-sticky--pinned .journey-expense-row:nth-child(2) .journey-expense-row__shares-reveal > .journey-row");
    expect(cssRuleBody(publicSource, ".journey-sticky--pinned .journey-repayment__allocation")).toMatch(/visibility:\s*visible;[\s\S]*opacity:\s*1;[\s\S]*transform:\s*none;/);
    expect(cssRuleBody(publicSource, ".journey-sticky--pinned .journey-repayment__allocation .journey-allocation__track span")).toContain("transform: scaleX(var(--journey-repayment-progress, 0));");
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

  it("keeps debtor statement values and headings responsive at the owning breakpoint", () => {
    const valuesSelector = ".debtor-statement .debtor-statement__item-values";
    const headingSelector = ".debtor-statement .debtor-statement__item-heading";
    const mobile = cssAtRuleBodies(publicSource, "@media (max-width: 767px)").find((body) => body.includes(`${valuesSelector} {`));
    const lateMobile = cssAtRuleBodies(lateOverridesSource, "@media (max-width: 767px)").join("\n");

    expect(cssRuleBody(publicSource, valuesSelector)).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(cssRuleBody(publicSource, headingSelector)).toContain("align-items: baseline;");
    expect(cssRuleBody(lateOverridesSource, ".debtor-statement__item-values")).not.toContain("grid-template-columns");
    expect(mobile).toContain(`${headingSelector} {`);
    expect(mobile).toContain("align-items: start;");
    expect(mobile).toContain(`${valuesSelector} {`);
    expect(mobile).toContain("grid-template-columns: 1fr;");
    expect(lateMobile).not.toContain(".debtor-statement__item-heading");
    expect(lateMobile).not.toContain(".debtor-statement__item-values");
  });

  it("keeps scale-sized server results bounded at the page and selector boundaries", () => {
    for (const source of recordPageSources) {
      expect(source).toMatch(/(?:friendPage|tripPage|outingPage|expensePage|repaymentPage)\.items/);
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
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\.header-shell__nav a:hover::after\s*\{[\s\S]*?transform: scaleX\(1\);/);
    expect(cssRuleBody(css, ".app-shell__nav-link:hover, .app-shell__nav-link:focus-visible")).toContain("color: var(--ink);");
    expect(css).toMatch(/@media \(max-width: 1199px\)\s*\{[\s\S]*?\.app-shell__mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
  });

  it("keeps shared/public and authenticated header breakpoints independent", () => {
    const sharedDesktop = cssAtRuleBodies(foundationSource, "@media (min-width: 1024px)");
    const authenticatedDesktop = cssAtRuleBodies(authenticatedShellSource, "@media (min-width: 1200px)");
    const authenticatedPanel = ".app-shell .header-shell__panel,\n.app-shell .header-shell__panel--detached";

    expect(sharedDesktop).toHaveLength(1);
    expect(cssRuleBody(sharedDesktop[0], ".header-shell__panel")).toContain("display: grid;");
    expect(foundationSource).not.toContain("@media (min-width: 1200px)");
    expect(cssRuleBody(publicSource, ".site-header")).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);");
    expect(cssRuleBody(authenticatedShellSource, authenticatedPanel)).toContain("display: flex;");
    expect(authenticatedDesktop).toHaveLength(1);
    expect(cssRuleBody(authenticatedDesktop[0], authenticatedPanel)).toContain("display: grid;");
  });

  it("keeps the expense split summary below the authenticated header", () => {
    expect(authenticatedShellSource).toContain("--authenticated-header-height: 4.5rem;");
    expect(authenticatedShellSource).toContain("min-height: var(--authenticated-header-height);");
    expect(recordsAndFormsSource).toMatch(/\.expense-share-editor__summary\s*\{[\s\S]*?position: sticky;[\s\S]*?z-index: 2;[\s\S]*?top: calc\(var\(--authenticated-header-height\) \+ 0\.75rem\);/);
    expect(cssRuleBody(css, ".expense-share-editor__summary")).toContain("margin-top: 0.75rem;");
    expect(cssRuleBody(css, ".expense-share-editor__summary")).toContain("border-radius: var(--radius-md);");
    expect(lateOverridesSource).not.toContain("expense-share-editor__summary");
  });

  it("keeps charge controls inside their assigned tracks", () => {
    expect(cssRuleBody(css, ".expense-share-editor__charge-fields")).toContain("grid-template-columns: minmax(0, 1fr) minmax(7.5rem, 9rem) minmax(10rem, 11rem);");
    expect(cssRuleBody(css, ".expense-share-editor__charge-fields > *")).toContain("min-width: 0;");
    expect(cssRuleBody(css, ".expense-share-editor__percentage-input")).toMatch(/width: 100%;[\s\S]*min-width: 0;/);
    expect(cssRuleBody(css, ".expense-share-editor__percentage-input input")).toMatch(/width: 100%;[\s\S]*min-width: 0;/);
    expect(cssRuleBody(css, ".expense-share-editor__charge-field select")).toMatch(/width: 100%;[\s\S]*min-width: 0;/);
    expect(expenseShareSource).toContain('inputMode="decimal"');
    expect(expenseShareSource).toContain('placeholder="7.5"');
    expect(expenseShareSource).toContain('aria-hidden="true">%</span>');
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
    expect(expenseShareSource).toContain("data-changed-revision");
    expect(expenseShareSource).not.toContain("setTimeout");
    expect(css).toContain(".changed-value__visual");
  });

  it("keeps the interaction motion pointer-safe and tokenized", () => {
    expect(foundationSource).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.header-shell__nav a:hover::after/);
    expect(authenticatedShellSource).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.ledger-overview__friend-link:hover::after/);
    expect(recordsAndFormsSource).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.outing-row__edit:hover::after/);
    expect(foundationSource).toContain(".header-shell__nav a:focus-visible::after");
    expect(recordsAndFormsSource).toContain(".outing-row__edit:focus-visible::after");
    expect(motionSource).toContain("receipt-preview--closing");
    expect(motionSource).toContain("@keyframes receipt-preview-out");
    expect(recordsAndFormsSource).toContain('.searchable-combobox__panel[data-placement="down"]');
    expect(recordsAndFormsSource).toContain('.searchable-combobox__panel[data-placement="up"]');
    expect(recordsAndFormsSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.searchable-combobox__panel\s*\{[\s\S]*?opacity: 1;[\s\S]*?transform: none;[\s\S]*?animation: none;/);
    expect(publicSource).toContain("animation: masked-hero-reveal var(--motion-reveal) var(--ease-emphasized) both;");
    expect(authenticatedShellSource).toContain("animation: field-reveal var(--motion-reveal) var(--ease-emphasized) both;");
    expect(publicSource).not.toContain("700ms cubic-bezier");
    expect(authenticatedShellSource).not.toContain("850ms");
    expect(publicSource).toContain(".action-link--primary:not(:disabled):active");
    expect(publicSource).toContain("transform: translateY(1px);");
    expect(motionSource).toContain(".action-link--primary:not(:disabled):active");
  });

  it("anchors the native task panel without an implicit dialog gap", () => {
    expect(taskPanelRule).toContain("position: fixed;");
    expect(taskPanelRule).toContain("inset: 0 0 0 auto;");
    expect(taskPanelRule).toContain("margin: 0;");
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.task-panel\s*\{[\s\S]*?inset:\s*auto 0 0;/);
  });

  it("keeps searchable popups outside task-panel scroll clipping", () => {
    expect(searchableComboboxSource).toContain("createPortal");
    expect(searchableComboboxSource).toContain("calculateSearchableComboboxPlacement");
    expect(css).toMatch(/\.searchable-combobox__panel\s*\{[^}]*position:\s*fixed;[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.searchable-combobox__panel\[data-portal="dialog"\]\s*\{[^}]*position:\s*absolute;/);
    expect(css).toMatch(/\.task-panel__surface\s*\{[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.task-panel__body\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/);
  });

  it("uses one stable underline mechanism for friend filters", () => {
    expect(css).not.toContain(".friends-page__view::after");
    expect(css).not.toContain(".friends-page__view--selected::after");
    expect(css).not.toContain(".friends-page__view:hover span");
    expect(css).toMatch(/\.friends-page__view\s*\{[\s\S]*?min-height:\s*2\.75rem;[\s\S]*?text-decoration:\s*none;[\s\S]*?text-decoration-thickness:\s*1px;/);
    expect(css).toMatch(/\.friends-page__view--selected,[\s\S]*?\.friends-page__view:hover,[\s\S]*?\.friends-page__view:focus-visible\s*\{[\s\S]*?text-decoration-line:\s*underline;/);
  });
});
