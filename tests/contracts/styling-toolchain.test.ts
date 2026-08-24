import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";

const root = process.cwd();
const css = readCssBundle(root).css;
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides: Record<string, Record<string, string>>;
};
const ledgerRepository = readFileSync(path.join(root, "src/domain/ledger-repository.ts"), "utf8");
const ledgerTypes = readFileSync(path.join(root, "src/domain/ledger/types.ts"), "utf8");
const expenseRow = readFileSync(path.join(root, "src/components/expenses/expense-row.tsx"), "utf8");

function cssRuleBody(source: string, selector: string) {
  const expected = selector.trim().replace(/\s+/g, " ");
  for (const match of source.matchAll(/(?:^|\n)([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim().replace(/\s+/g, " ") === expected) return match[2];
  }
  return "";
}

describe("Repository styling toolchain contract", () => {
  it("removes unused styling configuration and direct packages", () => {
    expect(existsSync(path.join(root, "components.json"))).toBe(false);
    expect(existsSync(path.join(root, "postcss.config.mjs"))).toBe(false);
    for (const file of ["tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs", "tailwind.config.ts"]) {
      expect(existsSync(path.join(root, file))).toBe(false);
    }

    const directDependencies = new Set([...Object.keys(packageJson.dependencies), ...Object.keys(packageJson.devDependencies)]);
    for (const dependency of ["clsx", "tailwind-merge", "@tailwindcss/postcss", "postcss", "tailwindcss"]) {
      expect(directDependencies).not.toContain(dependency);
    }
    expect(packageJson.overrides["next@16.2.12"]).toMatchObject({ postcss: "8.5.25", sharp: "0.35.3" });
  });

  it("keeps the explicit browser baseline before Zplit component rules", () => {
    expect(css).not.toMatch(/@import\s+["']tailwindcss["']/);
    expect(css).not.toContain("@theme");
    for (const alias of ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring"]) {
      expect(css).not.toMatch(new RegExp(`(?:^|\\s)--${alias}\\s*:`));
    }

    const baseline = css.indexOf("/* Explicit Zplit browser baseline. */");
    const componentStyles = css.indexOf(".editorial-shell {");
    expect(baseline).toBeGreaterThanOrEqual(0);
    expect(baseline).toBeLessThan(componentStyles);
    const baselineCss = css.slice(baseline, componentStyles);

    expect(cssRuleBody(baselineCss, "h1, h2, h3, h4, h5, h6")).toContain("font-size: inherit;");
    expect(cssRuleBody(baselineCss, "h1, h2, h3, h4, h5, h6")).toContain("font-weight: inherit;");
    expect(cssRuleBody(baselineCss, "a")).toMatch(/color: inherit;[\s\S]*text-decoration: inherit;/);

    const controls = cssRuleBody(baselineCss, "button, input, optgroup, option, select, textarea");
    for (const declaration of ["font: inherit;", "font-feature-settings: inherit;", "font-variation-settings: inherit;", "letter-spacing: inherit;", "color: inherit;"]) {
      expect(controls).toContain(declaration);
    }
    expect(controls).toMatch(/background-color: transparent;[\s\S]*border-radius: 0;[\s\S]*opacity: 1;/);
    expect(cssRuleBody(baselineCss, "::file-selector-button")).toContain("font: inherit;");
    expect(cssRuleBody(baselineCss, 'input[type="search"]')).toMatch(/appearance: textfield;[\s\S]*outline-offset: -2px;/);
    expect(cssRuleBody(baselineCss, 'input[type="search"]::-webkit-search-decoration')).toContain("-webkit-appearance: none;");

    expect(cssRuleBody(baselineCss, "h1, h2, h3, h4, h5, h6, p, blockquote, dl, dd, figure, menu, ol, pre, ul")).toContain("margin: 0;");
    expect(cssRuleBody(baselineCss, "menu, ol, ul")).toMatch(/padding: 0;[\s\S]*list-style: none;/);
    expect(cssRuleBody(baselineCss, "button")).toMatch(/padding: 0;[\s\S]*border: 0;[\s\S]*background: transparent;/);
    expect(cssRuleBody(baselineCss, "img, video")).toMatch(/display: block;[\s\S]*max-width: 100%;/);
    expect(cssRuleBody(baselineCss, "audio, canvas, embed, iframe, object, svg")).toContain("display: block;");
    expect(cssRuleBody(baselineCss, "table")).toContain("border-collapse: collapse;");
    expect(cssRuleBody(baselineCss, "[hidden]")).toContain("display: none !important;");
    expect(cssRuleBody(baselineCss, "body")).toMatch(/margin: 0;[\s\S]*background: var\(--paper\);[\s\S]*font-family: var\(--font-body\);/);
  });

  it("removes only the dead files and preserves authoritative paths", () => {
    for (const file of ["src/components/editorial/chapter-label.tsx", "src/components/editorial/product-journey.tsx", "src/components/editorial/product-journey.test.tsx", "src/lib/utils.ts", "src/lib/utils.test.ts"]) {
      expect(existsSync(path.join(root, file))).toBe(false);
    }
    for (const file of ["src/components/editorial/journey-showcase.tsx", "src/components/editorial/journey-showcase.test.tsx", "src/auth/cli.ts"]) {
      expect(existsSync(path.join(root, file))).toBe(true);
    }
    expect(css).toContain(".product-journey {");
    for (const alias of ["CreateFriendInput", "UpdateFriendInput", "CreateOutingInput", "UpdateOutingInput", "CreateExpenseInput", "UpdateExpenseInput", "CreateRepaymentInput", "UpdateRepaymentInput"]) {
      expect(ledgerTypes).toContain(alias);
    }
    expect(ledgerRepository).toContain('export type * from "./ledger/types";');
  });

  it("uses the domain rupiah formatter in ExpenseRow", () => {
    expect(expenseRow).toContain('import { formatRupiah } from "@/domain/rupiah";');
    expect(expenseRow).not.toMatch(/function formatRupiah\s*\(/);
  });
});
