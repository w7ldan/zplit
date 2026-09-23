import { describe, expect, it } from "vitest";
import { readSource } from "./helpers";

const publicAuth = readSource("src/app/styles/70-public-auth-vnext.css");
const publicLanding = readSource("src/components/editorial/public-landing.tsx");
const sharedPublic = readSource("src/app/styles/65-shared-public-vnext.css");
const foundation = readSource("src/app/styles/00-foundation.css");
const budgetStyles = readSource("src/app/styles/30-records-and-forms.css");
const authenticatedHeader = readSource("src/app/styles/60-authenticated-header-vnext.css");
const overviewStyles = readSource("src/app/styles/25-overview.css");

describe("Responsive layout contract", () => {
  it("recomposes the public document instead of switching to a second mobile product", () => {
    expect(publicLanding).not.toContain("mobile");
    expect(publicAuth).toContain("@media (max-width: 767px)");
    expect(publicAuth).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.public-vnext__flow\s*\{[\s\S]*?grid-template-columns: 1fr;/);
    expect(publicAuth).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.public-vnext__privacy-example\s*\{[\s\S]*?grid-template-columns: 1fr;/);
    expect(publicAuth).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.public-vnext \.site-header__nav\s*\{[\s\S]*?grid-column: 1 \/ -1;/);
    expect(publicAuth).not.toMatch(/scroll-snap|height:\s*calc\([^)]*svh|position:\s*fixed/);
  });

  it("keeps access forms bounded and usable on narrow screens", () => {
    expect(publicAuth).toContain(".access-vnext__content");
    expect(publicAuth).toContain("overflow-wrap: anywhere;");
    expect(publicAuth).toMatch(/\.access-vnext \.login-form__field input,[\s\S]*?width: 100%;/);
    expect(publicAuth).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.access-vnext \.login-form__submit,[\s\S]*?width: 100%;/);
    expect(publicAuth).toContain("@media (max-height: 640px) and (min-width: 768px)");
  });

  it("leaves accepted Shared/Public Links layout ownership intact", () => {
    expect(sharedPublic).toContain(".debtor-statement__workspace--with-destinations");
    expect(sharedPublic).toContain("@media (max-width: 900px)");
    expect(sharedPublic).toContain("@media (max-width: 640px)");
    expect(sharedPublic).toContain("@media (max-width: 380px)");
    expect(sharedPublic).toContain("@media (prefers-reduced-motion: reduce)");
    expect(foundation).toContain("scrollbar-gutter: stable;");
  });

  it("keeps the paused Budget resume action stacked on narrow screens", () => {
    expect(budgetStyles).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.budget-page\.zplit-vnext \.budget-paused-state__actions\s*\{[^}]*align-items: stretch;[^}]*flex-direction: column;/);
  });

  it("keeps authenticated mobile navigation aligned as a stable second row", () => {
    expect(authenticatedHeader).toMatch(/@media \(max-width: 1199px\)[\s\S]*?\.app-shell__mobile-nav\s*\{[^}]*position: sticky;[^}]*top: var\(--authenticated-header-height\);[^}]*width: min\(calc\(100% - var\(--authenticated-canvas-gutter\)\)/);
    expect(authenticatedHeader).toMatch(/\.app-shell__mobile-link\s*\{[^}]*flex: 1 1 0;[^}]*white-space: nowrap;/);
    expect(authenticatedHeader).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.app-shell \.header-shell__panel,[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto auto auto;/);
  });

  it("gives the Overview Personal signal the available width when no matching action is present", () => {
    expect(overviewStyles).toContain(".overview-signal-zone--personal-only");
    expect(overviewStyles).toMatch(/\.overview-personal__supporting\s*\{[^}]*background: var\(--vnext-surface\);/);
  });

  it("groups public statement records with spacing and a single side marker", () => {
    expect(sharedPublic).toMatch(/\.debtor-statement__list\s*\{[^}]*display: grid;[^}]*gap:/);
    expect(sharedPublic).toMatch(/\.debtor-statement__item,[\s\S]*?\.debtor-statement__repayment\s*\{[^}]*border-inline-start: 2px solid var\(--vnext-rule\);/);
    expect(sharedPublic).not.toMatch(/\.debtor-statement__item-values\s*\{[^}]*border-block-start:/);
  });
});
