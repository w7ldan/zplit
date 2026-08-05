import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";

const root = process.cwd();
const bundle = readCssBundle(root);
const stylesRoot = path.resolve(root, "src/app/styles");
const globalsSource = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const recordsAndFormsSource = readFileSync(path.join(stylesRoot, "30-records-and-forms.css"), "utf8");
const lateOverridesSource = readFileSync(path.join(stylesRoot, "90-late-overrides.css"), "utf8");
const requiredImports = [
  "src/app/styles/00-foundation.css",
  "src/app/styles/10-public.css",
  "src/app/styles/20-authenticated-shell.css",
  "src/app/styles/30-records-and-forms.css",
  "src/app/styles/40-motion-and-feedback.css",
  "src/app/styles/90-late-overrides.css",
];

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
    } else if (character === '"' || character === "'") {
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

describe("CSS architecture", () => {
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
    const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('import "./globals.css";');
    expect(layout).not.toContain("./styles/");
    expect(bundle.fragmentSources[0]).toContain("/* Explicit Zplit browser baseline. */");
    expect(bundle.fragmentSources.slice(1).join("")).not.toContain("/* Explicit Zplit browser baseline. */");

    const anchors = [
      ".site-header-wrapper {",
      ".app-shell {",
      ".app-shell__header-layout {",
      ".friend-row,\n.outing-row,",
      ".task-panel {",
      ".public-home {",
      ".live-record-filters {",
      ".record-pagination {",
    ].map((anchor) => bundle.css.indexOf(anchor));

    expect(anchors.every((index) => index >= 0)).toBe(true);
    expect(anchors).toEqual([...anchors].sort((left, right) => left - right));
    expect(bundle.css.indexOf(".site-header-wrapper {")).toBeLessThan(bundle.css.indexOf(".app-shell {"));
    expect(bundle.fragmentSources[5]).toContain("/* Refined authenticated controls and row actions. */");
    expect(bundle.fragmentSources[5]).toContain(".live-record-filters {");
    expect(bundle.fragmentSources[5]).toContain(".record-pagination {");
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

  it("keeps authenticated header painting in its owning fragment", () => {
    expect(lateOverridesSource).not.toMatch(/\.app-shell__header(?:-layout)?\b/);
    expect(bundle.css).toContain(".app-shell__header {\n");
    expect(bundle.css).toContain(".app-shell__header-layout--detached {\n");
    expect(lateOverridesSource).not.toContain("app-shell__header-layout--detached");
    expect(bundle.css).toMatch(/\.app-shell__header\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
    expect(bundle.css).toMatch(/\.app-shell__header-layout\s*\{[\s\S]*?border:\s*1px solid transparent;[\s\S]*?background:\s*transparent;/);
    expect(bundle.css).toMatch(/\.app-shell__header-layout--detached\s*\{[\s\S]*?border-color:\s*var\(--rule\);[\s\S]*?border-radius:\s*var\(--radius-panel\);[\s\S]*?background:\s*var\(--surface\);[\s\S]*?box-shadow:/);
  });
});
