import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { cssAtRuleBodies, cssRuleBody, readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const foundationSource = readSource("src/app/styles/00-foundation.css");
const publicSource = readSource("src/app/styles/10-public.css");
const authenticatedShellSource = readSource("src/app/styles/20-authenticated-shell.css");
const recordsAndFormsSource = readSource("src/app/styles/30-records-and-forms.css");
const lateOverridesSource = readSource("src/app/styles/90-late-overrides.css");

describe("Responsive layout contract", () => {
  it("keeps public and authenticated geometry on their intended canvases", () => {
    expect(cssRuleBody(css, ".editorial-shell")).toContain("width: min(calc(100% - 2rem), 90rem);");
    expect(cssRuleBody(css, ".header-shell__panel")).toContain("max-width: 90rem;");
    expect(cssRuleBody(css, ".header-shell__panel--detached")).toContain("max-width: 72rem;");
    expect(authenticatedShellSource).toContain(".app-shell .editorial-shell {");
    expect(authenticatedShellSource).toContain("width: min(calc(100% - 2rem), 76rem);");
    expect(authenticatedShellSource).toContain("max-width: 76rem;");
    expect(authenticatedShellSource).toContain(".app-shell .header-shell__panel,");
    expect(authenticatedShellSource).toContain(".app-shell .header-shell__panel--detached {");
    expect(authenticatedShellSource).toContain("width: min(calc(100% - 1.5rem), 76rem);");

    const appShellRules = [...authenticatedShellSource.matchAll(/\.app-shell\s*\{([^{}]*)\}/g)].map((match) => match[1]);
    expect(publicSource).toContain(".public-home { background: var(--paper); }");
    expect(appShellRules.at(-1)).toContain("background: var(--paper);");
    expect(cssRuleBody(authenticatedShellSource, ".app-page")).toContain("background: var(--paper);");
    expect(authenticatedShellSource).not.toMatch(/\.app-shell\s*\{[^{}]*background:\s*var\(--surface\)/);
    expect(authenticatedShellSource).not.toMatch(/\.app-page\s*\{[^{}]*background:\s*var\(--surface\)/);
    expect(cssRuleBody(lateOverridesSource, ".login-form")).toContain("background: var(--surface);");
  });

  it("keeps trip detail columns wide and repayment activity labels on one line", () => {
    expect(recordsAndFormsSource).toMatch(/\.trip-record__meta,[\s\S]*?\.trip-record__outings\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/);
    expect(authenticatedShellSource).toContain("grid-template-columns: minmax(4.5rem, max-content) minmax(0, 1fr) auto;");
    expect(authenticatedShellSource).toContain(".activity-row > span:first-child");
    expect(authenticatedShellSource).toContain("white-space: nowrap;");
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

  it("keeps desktop record columns semantic and aligned", () => {
    expect(recordsAndFormsSource).toMatch(/@media \(min-width: 960px\)[\s\S]*?\.expense-row__meta,[\s\S]*?\.repayment-row__meta\s*\{[\s\S]*?display: contents;/);
    expect(recordsAndFormsSource).toContain("minmax(0, 2fr) minmax(7rem, auto) minmax(7rem, auto)");
    expect(recordsAndFormsSource).toContain("minmax(0, 2fr) minmax(7rem, auto) minmax(8rem, auto)");
  });

  it("keeps long record values bounded in rows while leaving detail values unclamped", () => {
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
    expect(panel).toMatch(/transition:\s*width\s+var\(--motion-state\)/);
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
    expect(css).toMatch(/@media \(max-width: 1199px\)\s*\{[\s\S]*?\.app-shell__mobile-nav\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
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

  it("keeps the public mobile header grid in the public fragment", () => {
    expect(publicSource).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.public-home \.site-header\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  });
});
