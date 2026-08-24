import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { cssBraceDepth, readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const recordPageSources = ["friends", "trips", "outings", "expenses", "repayments"].map((name) => readSource(`src/app/app/${name}/page.tsx`));
const selectorActionSources = [readSource("src/app/app/expenses/actions.ts"), readSource("src/app/app/repayments/actions.ts")];
const scaleDocumentation = readSource("docs/testing.md");
const expenseFormSource = readSource("src/components/expenses/expense-form.tsx");
const repaymentFormSource = readSource("src/components/repayments/repayment-form.tsx");
const taskPanelSource = readSource("src/components/app/task-panel.tsx");
const recordConfirmationSource = readSource("src/components/app/record-confirmation.tsx");

describe("Repository application-boundary contract", () => {
  it("keeps record selectors shared at the form boundary", () => {
    for (const source of [expenseFormSource, repaymentFormSource]) {
      expect(source).toContain("SearchableCombobox");
      expect(source).not.toContain("InferSelectModel");
    }
  });

  it("keeps scale-sized server results bounded at page and selector boundaries", () => {
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

  it("keeps authenticated lifecycle navigation native and CSS syntax balanced", () => {
    expect(cssBraceDepth(css)).toBe(0);
    expect(taskPanelSource).toContain("router?.replace");
    expect(recordConfirmationSource).toContain("router?.replace");
    expect(taskPanelSource).not.toContain("window.history.replaceState");
    expect(recordConfirmationSource).not.toContain("window.history.replaceState");
  });
});
