import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { cssBraceDepth, readSource, root } from "./helpers";

const bundle = readCssBundle(root);
const stylesRoot = path.resolve(root, "src/app/styles");
const globalsSource = readSource("src/app/globals.css");
const publicSource = readSource("src/app/styles/10-public.css");
const authenticatedSource = readSource("src/app/styles/20-authenticated-shell.css");
const overviewSource = readSource("src/app/styles/25-overview.css");
const recordsAndFormsSource = readSource("src/app/styles/30-records-and-forms.css");
const personalVnextSource = readSource("src/app/styles/35-personal-vnext.css");
const motionSource = readSource("src/app/styles/40-motion-and-feedback.css");
const lateOverridesSource = readSource("src/app/styles/90-late-overrides.css");
const groupsVnextSource = readSource("src/app/styles/45-groups-vnext.css");
const organizationsVnextSource = readSource("src/app/styles/50-organizations-vnext.css");
const supportVnextSource = readSource("src/app/styles/55-authenticated-support-vnext.css");
const headerVnextSource = readSource("src/app/styles/60-authenticated-header-vnext.css");
const sharedPublicVnextSource = readSource("src/app/styles/65-shared-public-vnext.css");
const publicAuthSource = readSource("src/app/styles/70-public-auth-vnext.css");
const requiredImports = [
  "src/app/styles/00-foundation.css",
  "src/app/styles/05-vnext-foundation.css",
  "src/app/styles/10-public.css",
  "src/app/styles/20-authenticated-shell.css",
  "src/app/styles/25-overview.css",
  "src/app/styles/30-records-and-forms.css",
  "src/app/styles/35-personal-vnext.css",
  "src/app/styles/40-motion-and-feedback.css",
  "src/app/styles/90-late-overrides.css",
  "src/app/styles/45-groups-vnext.css",
  "src/app/styles/50-organizations-vnext.css",
  "src/app/styles/55-authenticated-support-vnext.css",
  "src/app/styles/60-authenticated-header-vnext.css",
  "src/app/styles/65-shared-public-vnext.css",
  "src/app/styles/70-public-auth-vnext.css",
];

describe("Repository CSS architecture contract", () => {
  it("keeps the root manifest exact and declaration-free", () => {
    const expectedManifest = `${requiredImports
      .map((file) => `@import "./${file.slice("src/app/".length)}";`)
      .join("\n")}\n`;

    expect(bundle.manifestSource).toBe(expectedManifest);
    expect(bundle.importedPaths).toEqual(requiredImports);
    expect(bundle.manifestSource).not.toMatch(/[{}]/);
    expect(bundle.manifestSource).not.toMatch(/(^|\n)\s*--?[\w-]+\s*:/);
  });

  it("keeps fragments local, unique, nonempty, and balanced", () => {
    expect(bundle.fragmentSources).toHaveLength(requiredImports.length);
    expect(new Set(bundle.importedPaths).size).toBe(bundle.importedPaths.length);

    for (const [index, importedPath] of bundle.importedPaths.entries()) {
      const resolvedPath = path.resolve(root, importedPath);
      const relativePath = path.relative(stylesRoot, resolvedPath);

      expect(relativePath).not.toBe("");
      expect(relativePath.startsWith(`..${path.sep}`)).toBe(false);
      expect(path.isAbsolute(relativePath)).toBe(false);
      expect(existsSync(resolvedPath)).toBe(true);
      expect(bundle.fragmentSources[index].length).toBeGreaterThan(0);
      expect(bundle.fragmentSources[index]).not.toMatch(/@import\b|@layer\b|@scope\b/);
      expect(cssBraceDepth(bundle.fragmentSources[index])).toBe(0);
    }

    expect(cssBraceDepth(bundle.css)).toBe(0);
  });

  it("keeps root stylesheet ownership and source-order boundaries explicit", () => {
    const layout = readSource("src/app/layout.tsx");
    expect(layout).toContain('import "./globals.css";');
    expect(layout).not.toContain("./styles/");
    expect(bundle.fragmentSources[0]).toContain("/* Explicit Zplit browser baseline. */");
    expect(bundle.fragmentSources.slice(1).join("")).not.toContain("/* Explicit Zplit browser baseline. */");

    const anchors = [
      ".header-shell {",
      ".app-shell {",
      ".friend-row,\n.outing-row,",
      ".live-record-filters {",
      ".record-pagination {\n  display: flex;",
      ".task-panel {",
      ".public-vnext,",
    ].map((anchor) => bundle.css.indexOf(anchor));

    expect(anchors.every((index) => index >= 0)).toBe(true);
    expect(anchors).toEqual([...anchors].sort((left, right) => left - right));
    expect(bundle.css.indexOf(".header-shell {")).toBeLessThan(bundle.css.indexOf(".app-shell {"));
    expect(bundle.fragmentSources[3]).toContain(".app-page__layout");
    expect(overviewSource).toContain(".overview-page {");
    expect(overviewSource).toContain(".overview-signal-zone {");
    expect(overviewSource).not.toContain(".overview-open-tile");
    expect(overviewSource).not.toContain("--overview-pointer");
    expect(personalVnextSource).toContain(".personal-ledger-summary");
    expect(personalVnextSource).not.toContain(".overview-summary");
    expect(personalVnextSource).not.toMatch(/:nth-child\(/);
    expect(personalVnextSource).not.toContain("task-panel.personal-task-panel");
    expect(bundle.fragmentSources[5]).toContain("/* Shared authenticated record filters, pagination, and row actions. */");
    expect(bundle.fragmentSources[5]).toContain(".live-record-filters {");
    expect(bundle.fragmentSources[5]).toContain(".record-pagination {\n  display: flex;");
    expect(personalVnextSource).toContain(".personal-vnext.expenses-page");
    expect(personalVnextSource).toContain(".personal-vnext.repayments-page");
    expect(personalVnextSource).toContain(".personal-vnext.outings-page");
    expect(bundle.fragmentSources[8]).not.toContain(".live-record-filters {");
    expect(bundle.fragmentSources[8]).not.toContain(".record-pagination {");
    expect(bundle.fragmentSources[8]).not.toContain(".personal-vnext");
    expect(groupsVnextSource).toContain(".groups-vnext");
    expect(groupsVnextSource).not.toContain(".personal-vnext");
    expect(groupsVnextSource).not.toContain(".budget-page");
    expect(groupsVnextSource).not.toContain(".overview-page");
    expect(organizationsVnextSource).toContain(".organizations-vnext");
    expect(organizationsVnextSource).not.toContain("90-late-overrides");
    expect(organizationsVnextSource).not.toContain("90rem");
    expect(organizationsVnextSource).toContain(".organization-context__topline > .organization-detail__back");
    expect(organizationsVnextSource).not.toMatch(/(^|\n)\s*\.(?:expense-record|repayment-record|friend-record|trip-record|outing-record|ledger-list)\b/);
    expect(supportVnextSource).toContain(".settings-vnext");
    expect(supportVnextSource).toContain(".inbox-vnext");
    expect(supportVnextSource).not.toContain(".search-vnext");
    expect(supportVnextSource).toContain(".invites-vnext");
    expect(supportVnextSource).not.toContain(".organizations-vnext");
  });

  it("keeps mobile disclosure ownership in the records-and-forms fragment", () => {
    expect(recordsAndFormsSource).toContain("live-record-filters--mobile-disclosure");
    expect(recordsAndFormsSource).toContain("@media (min-width: 768px)");
    expect(recordsAndFormsSource).toContain("__disclosure:not([open])");
    expect(lateOverridesSource).not.toContain("live-record-filters--mobile-disclosure");
    expect(globalsSource).toBe(`${requiredImports.map((file) => `@import \"./${file.slice("src/app/".length)}\";`).join("\n")}\n`);
    expect(cssBraceDepth(recordsAndFormsSource)).toBe(0);
    expect(cssBraceDepth(lateOverridesSource)).toBe(0);
    expect(cssBraceDepth(bundle.css)).toBe(0);
  });

  it("keeps scale-sized names wrappable, clamped in rows, and the viewport gutter stable", () => {
    expect(bundle.css).toContain("scrollbar-gutter: stable;");
    expect(bundle.css).toMatch(/\.friend-row__primary h2 a,[\s\S]*?\.repayment-row__primary h2 a\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?-webkit-line-clamp:\s*2;/);
    expect(bundle.css).toMatch(/\.friend-record__intro h1,[\s\S]*?\.repayment-record__intro h1\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  });

  it("keeps shared header painting in the foundation fragment", () => {
    const foundationSource = bundle.fragmentSources[0];
    const publicSource = bundle.fragmentSources[1];
    const authenticatedSource = bundle.fragmentSources[2];
    expect(foundationSource).toContain(".header-shell {");
    expect(foundationSource).toContain(".header-shell__panel--detached {");
    expect(publicSource).not.toContain(".site-header--detached {");
    expect(authenticatedSource).not.toContain(".app-shell__header-layout");
    expect(headerVnextSource).toContain(".app-shell__header-layout");
    expect(headerVnextSource).toContain("--authenticated-canvas-max-width: 118rem;");
    expect(headerVnextSource).toContain("box-shadow: none;");
    expect(headerVnextSource).toContain(".global-search__dialog");
    expect(authenticatedSource).not.toContain(".global-search__dialog");
    expect(motionSource).not.toContain(".app-shell__mobile-nav");
    expect(motionSource).not.toContain(".account-menu__name");
    expect(lateOverridesSource).not.toMatch(/\.header-shell(?:__[\w-]+)?\b/);
    expect(lateOverridesSource).not.toMatch(/\.app-shell__header(?:-layout)?\b/);
    expect(lateOverridesSource).not.toContain("app-shell__header-layout--detached");
    expect(foundationSource).toMatch(/\.header-shell__panel\s*\{[\s\S]*?width:\s*min\(calc\(100% - 2rem\), 90rem\);[\s\S]*?max-width:\s*90rem;[\s\S]*?border-bottom:\s*1px solid transparent;/);
    expect(headerVnextSource).toMatch(/\.app-shell \.header-shell__panel--detached\s*\{[\s\S]*?transform:\s*translateY\(0\.3rem\);/);
  });

  it("keeps authenticated record selectors out of public and quarantine fragments", () => {
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
    expect(authenticatedSource).not.toMatch(/\.(?:friend|outing|expense|repayment)-(?:row|form)(?:__|\s*\{)/);
    expect(recordsAndFormsSource).toContain(".friend-row {");
    expect(recordsAndFormsSource).toContain(".friend-form {");
    expect(recordsAndFormsSource).toContain(".friends-toolbar {");
    expect(authenticatedSource).not.toMatch(/\.outing-record__meta\s*\{/);
    expect(authenticatedSource).not.toMatch(/\.expense-record__meta\s*\{/);
    expect(authenticatedSource).not.toMatch(/\.repayment-record__meta\s*\{/);
  });

  it("keeps Friend detail styles and public header styles in their owning fragments", () => {
    expect(recordsAndFormsSource).toContain(".friend-record__title");
    expect(recordsAndFormsSource).toContain(".friend-record__summary {");
    expect(recordsAndFormsSource).toContain(".friend-record__workspace {");
    expect(recordsAndFormsSource).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);");
    expect(authenticatedSource).not.toContain(".friend-record__meta");
    expect(authenticatedSource).not.toContain(".friend-record__form");
    expect(lateOverridesSource).not.toContain(".friend-share {");
    expect(authenticatedSource).not.toContain(".site-header");
    expect(authenticatedSource).not.toContain(".public-home");
    expect(publicAuthSource).toContain(".public-vnext .site-header__access");
    expect(publicAuthSource).toContain(".public-vnext .header-shell__panel--detached");
    expect(publicAuthSource).toContain(".access-vnext");
    expect(publicAuthSource).not.toMatch(/journey-|landing-reveal|capability--|story-close/);
    expect(lateOverridesSource).not.toContain(".journey-");
    expect(lateOverridesSource).not.toContain(".landing-reveal");
    expect(lateOverridesSource).not.toContain(".public-home");
  });

  it("keeps Shared/Public Links vNext styles in the canonical fragment", () => {
    expect(recordsAndFormsSource).not.toContain(".friend-share__");
    expect(recordsAndFormsSource).not.toContain(".debtor-statement");
    expect(motionSource).not.toContain(".friend-share__");
    expect(publicSource).not.toContain(".debtor-statement");
    expect(publicAuthSource).not.toContain(".debtor-statement");
    expect(lateOverridesSource).not.toContain(".debtor-statement");
    expect(sharedPublicVnextSource).toContain(".debtor-statement.zplit-vnext");
    expect(sharedPublicVnextSource).toContain(".friend-record .friend-share");
    expect(sharedPublicVnextSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(sharedPublicVnextSource).not.toMatch(/box-shadow|gradient|backdrop-filter/i);
  });
});
