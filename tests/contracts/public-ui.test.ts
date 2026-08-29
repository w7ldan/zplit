import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { cssRuleBody, readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const publicSource = readSource("src/app/styles/10-public.css");
const journeySource = readSource("src/components/editorial/journey-showcase.tsx");
const siteHeaderSource = readSource("src/components/editorial/site-header.tsx");

describe("Public UI contract", () => {
  it("keeps the persistent Journey readable without a clipping viewport", () => {
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
    expect(journeySource).toMatch(/aria-valuenow=\{\s*showRepaymentState\s*\?\s*scenario\.repayment\.amount\s*:\s*0\s*\}/);
  });

  it("keeps the landing access link on the shared primary action treatment", () => {
    const header = cssRuleBody(publicSource, ".public-home .site-header");
    const detachedHeader = cssRuleBody(publicSource, ".public-home .site-header.header-shell__panel--detached");
    const wrapper = cssRuleBody(publicSource, ".public-home .site-header-wrapper");
    const detachedWrapper = cssRuleBody(publicSource, ".public-home .site-header-wrapper.header-shell--detached");
    const access = cssRuleBody(publicSource, ".public-home .site-header__access");
    const primary = cssRuleBody(css, ".action-link--primary");

    expect(siteHeaderSource).toMatch(/import \{ ActionLink \} from "@\/components\/editorial\/action-link";/);
    expect(siteHeaderSource).toMatch(/actions=\{<ActionLink href="\/app" variant="primary" className="site-header__access">Open Zplit<\/ActionLink>\}/);
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
});
