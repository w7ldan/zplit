import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { cssRuleBody, readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const foundationSource = readSource("src/app/styles/00-foundation.css");
const publicSource = readSource("src/app/styles/10-public.css");
const authenticatedShellSource = readSource("src/app/styles/20-authenticated-shell.css");
const scenes = readSource("src/components/editorial/public-scenes.tsx");
const motion = readSource("src/components/editorial/public-motion.tsx");
const interactions = readSource("src/components/editorial/public-interactions.tsx");
const siteHeaderSource = readSource("src/components/editorial/site-header.tsx");

describe("Public UI contract", () => {
  it("keeps the shared mobile editorial grid below public specialization", () => {
    expect(foundationSource).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.editorial-grid\s*\{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    expect(publicSource).toContain(".public-hero__layout { grid-template-columns: minmax(0, 1fr); }");
    expect(authenticatedShellSource).not.toContain(".editorial-grid");
  });

  it("recomposes financial surfaces from the canonical state", () => {
    expect(scenes).toContain('className="flow-composition"');
    expect(motion).toContain('card.setAttribute("data-expanded", String(index === step))');
    expect(motion).toContain('item.setAttribute("aria-current", "step")');
    expect(motion).toContain("Flip.killFlipsOf(cards)");
    expect(motion).toContain("animateRecordFlow(root, state.step, immediate)");
    expect(publicSource).toContain('.flow-card[data-expanded="true"]');

    const activeFlow = cssRuleBody(publicSource, '.public-home .flow-card[data-expanded="true"], .public-home .flow-balance[data-expanded="true"]');
    const relation = cssRuleBody(publicSource, ".public-home .scope-relations > span");
    const detachedHeader = cssRuleBody(publicSource, ".public-home .header-shell.header-shell--detached");
    expect(activeFlow).toContain("background: var(--paper);");
    expect(activeFlow).toContain("box-shadow: 0 .45rem 0 var(--shadow);");
    expect(relation).toContain("border: 1px solid var(--rule);");
    expect(detachedHeader).toContain("border-bottom-color: transparent;");
  });

  it("distinguishes context, coordination, evidence, and retrieval", () => {
    expect(scenes).toContain("Membership does not create a financial share.");
    expect(scenes).toContain("Settlements connect debtor → creditor");
    expect(interactions).toContain("CHAT ≠ LEDGER");
    expect(interactions).toContain("Conversation does not create");
    expect(scenes).toContain("ledgerStory.receipt.items.map");
    expect(scenes).toContain("The same record. Later.");
    expect(interactions).toContain("Paid by you · Raka + Sari · market-picnic.jpg");
    expect(interactions).not.toContain("setView");
    expect(motion).not.toContain("reorderHistory");
  });

  it("preserves scope accessibility and static reduced motion", () => {
    expect(motion).toContain('state.setAttribute("aria-hidden", active ? "false" : "true")');
    expect(motion).toContain("state.inert = !active");
    expect(motion).toContain('state.removeAttribute("aria-hidden")');
    expect(motion).toContain('media.add("(prefers-reduced-motion: reduce)"');
    expect(publicSource).toMatch(/\.scope-state\s*\{\s*grid-area: auto;\s*visibility: visible !important;/);
    expect(publicSource).toContain('[data-lifecycle-panel][data-lifecycle-active="false"]');
    expect(publicSource).toContain(".record-lifecycle__stage");
    expect(motion).toContain("publicRecordLifecycleState(step)");
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
