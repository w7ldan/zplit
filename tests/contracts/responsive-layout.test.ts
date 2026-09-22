import { describe, expect, it } from "vitest";
import { readSource } from "./helpers";

const publicAuth = readSource("src/app/styles/70-public-auth-vnext.css");
const publicLanding = readSource("src/components/editorial/public-landing.tsx");
const sharedPublic = readSource("src/app/styles/65-shared-public-vnext.css");
const foundation = readSource("src/app/styles/00-foundation.css");

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
});
