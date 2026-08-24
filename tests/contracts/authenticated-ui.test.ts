import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { cssRuleBody, readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const authenticatedShellSource = readSource("src/app/styles/20-authenticated-shell.css");
const recordsAndFormsSource = readSource("src/app/styles/30-records-and-forms.css");
const lateOverridesSource = readSource("src/app/styles/90-late-overrides.css");
const repaymentFormSource = readSource("src/components/repayments/repayment-form.tsx");
const expenseShareSource = readSource("src/components/expenses/expense-share-editor.tsx");

describe("Authenticated UI contract", () => {
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

  it("keeps authenticated list workspaces and medium history rows staged", () => {
    expect(recordsAndFormsSource).toContain(".records-workspace__toolbar");
    expect(recordsAndFormsSource).toContain(".friends-toolbar");
    expect(recordsAndFormsSource).toMatch(/@media \(min-width: 768px\) and \(max-width: 1099px\)[\s\S]*?\.history-row__link[\s\S]*?grid-template-columns: minmax\(4\.8rem, max-content\) minmax\(0, 1fr\);[\s\S]*?\.history-row__values[\s\S]*?grid-column: 2;/);
    expect(authenticatedShellSource).toContain(".overview-ledger-clarity {\n  border-block: 0;");
  });

  it("keeps Friend history actions stacked and aligned by their owning layout", () => {
    expect(cssRuleBody(css, ".record-history__links")).toMatch(/display:\s*grid;[\s\S]*justify-items:\s*start;[\s\S]*gap:\s*0\.35rem;/);
    expect(recordsAndFormsSource).toContain(".record-history__row:not(.record-history__row--share) > .record-history__link");
    expect(recordsAndFormsSource).toMatch(/@media \(min-width: 960px\)[\s\S]*?\.record-history__links\s*\{[\s\S]*?justify-items:\s*end;/);
    expect(cssRuleBody(recordsAndFormsSource, ".record-history__link")).not.toContain("justify-self: end;");
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

  it("keeps repayment allocation editing wide, staged, and owned by records-and-forms CSS", () => {
    expect(recordsAndFormsSource).toMatch(/\.repayment-allocation-editor__form\s*\{[\s\S]*?display: grid;[\s\S]*?width: 100%;[\s\S]*?max-width: none;/);
    expect(recordsAndFormsSource).toContain("grid-template-columns: minmax(0, 1.6fr) minmax(16rem, 0.8fr);");
    expect(recordsAndFormsSource).toMatch(/\.repayment-allocation-editor__submit\s*\{[\s\S]*?width: fit-content;[\s\S]*?justify-self: start;/);
    expect(recordsAndFormsSource).toMatch(/\.repayment-allocation-editor\s*>\s*\.record-pagination\s*\{[\s\S]*?margin-top: 1rem;/);
    expect(recordsAndFormsSource).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.repayment-allocation-editor__row\s*\{[\s\S]*?grid-template-columns: 1fr;/);
    expect(lateOverridesSource).not.toMatch(/repayment-allocation-editor__(?:form|row|submit)|repayment-allocation-editor\s*>\s*\.record-pagination/);
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
});
