import { describe, expect, it } from "vitest";
import { readSource } from "./helpers";

const publicAuth = readSource("src/app/styles/70-public-auth-vnext.css");
const publicLanding = readSource("src/components/editorial/public-landing.tsx");
const sharedPublic = readSource("src/app/styles/65-shared-public-vnext.css");
const foundation = readSource("src/app/styles/00-foundation.css");
const budgetStyles = readSource("src/app/styles/30-records-and-forms.css");
const authenticatedHeader = readSource("src/app/styles/60-authenticated-header-vnext.css");
const overviewStyles = readSource("src/app/styles/25-overview.css");
const tabletHeaderRules = authenticatedHeader.split("@media (max-width: 1199px)")[1]?.split("@media (max-width: 767px)")[0] ?? "";
const phoneHeaderRules = authenticatedHeader.split("@media (max-width: 767px)")[1]?.split("@media (prefers-reduced-motion: reduce)")[0] ?? "";
const phoneMobileNav = phoneHeaderRules.match(/\.app-shell__mobile-nav\s*\{([^}]+)\}/)?.[1] ?? "";
const phoneMain = phoneHeaderRules.match(/\.app-shell__main\s*\{([^}]+)\}/)?.[1] ?? "";

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

  it("keeps tablet navigation in the Header and fixes the three phone tabs to the viewport bottom", () => {
    expect(tabletHeaderRules).toMatch(/\.app-shell__mobile-nav\s*\{[^}]*position: sticky;[^}]*top: var\(--authenticated-header-height\);/);
    expect(authenticatedHeader).toMatch(/\.app-shell__nav\s*\{[^}]*display: flex;/);
    expect(authenticatedHeader).toMatch(/\.app-shell__mobile-nav\s*\{[^}]*display: none;/);
    expect(tabletHeaderRules).toMatch(/\.app-shell__nav\s*\{[^}]*display: none;/);
    expect(phoneMobileNav).toMatch(/display: grid;[\s\S]*position: fixed;[\s\S]*top: auto;[\s\S]*bottom: 0;[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    expect(phoneMobileNav).toContain("env(safe-area-inset-bottom, 0px)");
    expect(phoneMobileNav).not.toContain("position: sticky");
    expect(phoneMobileNav).not.toMatch(/(?:min-)?height:\s*100%/);
    expect(phoneMobileNav).not.toMatch(/inset-block:\s*0/);
    expect(phoneMobileNav).not.toContain("overflow-x");
    expect(phoneMain).toContain("padding-bottom: calc(4rem + env(safe-area-inset-bottom, 0px))");
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
