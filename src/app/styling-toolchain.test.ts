import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides: Record<string, Record<string, string>>;
};
const ledgerRepository = readFileSync(path.join(root, "src/domain/ledger-repository.ts"), "utf8");
const expenseRow = readFileSync(path.join(root, "src/components/expenses/expense-row.tsx"), "utf8");

describe("styling cleanup contract", () => {
  it("removes unused styling configuration and direct packages", () => {
    expect(existsSync(path.join(root, "components.json"))).toBe(false);
    expect(existsSync(path.join(root, "postcss.config.mjs"))).toBe(false);

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
    expect(baseline).toBeGreaterThanOrEqual(0);
    expect(baseline).toBeLessThan(css.indexOf(".editorial-shell {"));
    expect(css).toMatch(/h1,[\s\S]*?pre,\n?ul \{\n  margin: 0;/);
    expect(css).toMatch(/menu,[\s\S]*?ul \{\n  padding: 0;\n  list-style: none;/);
    expect(css).toMatch(/button,[\s\S]*?textarea \{\n  font: inherit;\n  color: inherit;/);
    expect(css).toMatch(/button \{\n  padding: 0;\n  border: 0;\n  background: transparent;/);
    expect(css).toMatch(/img,[\s\S]*?video \{[\s\S]*?display: block;[\s\S]*?max-width: 100%;/);
    expect(css).toMatch(/audio,[\s\S]*?svg \{[\s\S]*?display: block;/);
    expect(css).toContain("table {\n  border-collapse: collapse;");
    expect(css).toContain("[hidden] {\n  display: none !important;");
    expect(css).toMatch(/body \{[\s\S]*?margin: 0;[\s\S]*?background: var\(--paper\);[\s\S]*?font-family: var\(--font-body\);/);
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
      expect(ledgerRepository).toContain(alias);
    }
  });

  it("uses the domain rupiah formatter in ExpenseRow", () => {
    expect(expenseRow).toContain('import { formatRupiah } from "@/domain/rupiah";');
    expect(expenseRow).not.toMatch(/function formatRupiah\s*\(/);
  });
});
