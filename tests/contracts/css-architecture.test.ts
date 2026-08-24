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
const recordsAndFormsSource = readSource("src/app/styles/30-records-and-forms.css");
const motionSource = readSource("src/app/styles/40-motion-and-feedback.css");
const lateOverridesSource = readSource("src/app/styles/90-late-overrides.css");
const requiredImports = [
  "src/app/styles/00-foundation.css",
  "src/app/styles/10-public.css",
  "src/app/styles/20-authenticated-shell.css",
  "src/app/styles/30-records-and-forms.css",
  "src/app/styles/40-motion-and-feedback.css",
  "src/app/styles/90-late-overrides.css",
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
      ".public-home {",
      ".app-shell {",
      ".app-shell__header-layout {",
      ".friend-row,\n.outing-row,",
      ".live-record-filters {",
      ".record-pagination {\n  display: flex;",
      ".task-panel {",
    ].map((anchor) => bundle.css.indexOf(anchor));

    expect(anchors.every((index) => index >= 0)).toBe(true);
    expect(anchors).toEqual([...anchors].sort((left, right) => left - right));
    expect(bundle.css.indexOf(".header-shell {")).toBeLessThan(bundle.css.indexOf(".app-shell {"));
    expect(bundle.fragmentSources[2]).toContain(".app-page__layout");
    expect(bundle.fragmentSources[3]).toContain("/* Shared authenticated record filters, pagination, and row actions. */");
    expect(bundle.fragmentSources[3]).toContain(".live-record-filters {");
    expect(bundle.fragmentSources[3]).toContain(".record-pagination {\n  display: flex;");
    expect(bundle.fragmentSources[5]).not.toContain(".live-record-filters {");
    expect(bundle.fragmentSources[5]).not.toContain(".record-pagination {");
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
    expect(authenticatedSource).not.toContain(".app-shell__header-layout--detached {");
    expect(lateOverridesSource).not.toMatch(/\.header-shell(?:__[\w-]+)?\b/);
    expect(lateOverridesSource).not.toMatch(/\.app-shell__header(?:-layout)?\b/);
    expect(lateOverridesSource).not.toContain("app-shell__header-layout--detached");
    expect(foundationSource).toMatch(/\.header-shell__panel\s*\{[\s\S]*?width:\s*min\(calc\(100% - 2rem\), 90rem\);[\s\S]*?max-width:\s*90rem;[\s\S]*?border-bottom:\s*1px solid transparent;/);
    expect(foundationSource).toMatch(/\.header-shell__panel--detached\s*\{[\s\S]*?width:\s*min\(calc\(100% - 2rem\), 72rem\);[\s\S]*?max-width:\s*72rem;[\s\S]*?transform:\s*translateY\(0\.6rem\);/);
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
    expect(publicSource).toContain(".public-home .site-header__access");
    expect(publicSource).toContain(".public-home .site-header.header-shell__panel--detached");
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
});
