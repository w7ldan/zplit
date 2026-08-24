import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { cssRuleBody, readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const searchableComboboxSource = readSource("src/components/records/searchable-combobox.tsx");

describe("Component and accessibility contract", () => {
  it("keeps browser defaults neutral and component typography authoritative", () => {
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

  it("keeps navigation, focus, and row actions geometrically bounded", () => {
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

  it("anchors the native task panel without an implicit dialog gap", () => {
    const taskPanelRule = cssRuleBody(css, ".task-panel");
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
