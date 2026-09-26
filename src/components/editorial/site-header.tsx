"use client";

import { ActionLink } from "@/components/editorial/action-link";
import { HeaderShell } from "@/components/navigation/header-shell";

export function SiteHeader() {
  return (
    <HeaderShell
      ariaLabel="Site header"
      navigationLabel="Primary navigation"
      className="site-header-wrapper"
      panelClassName="site-header"
      brandClassName="site-header__brand"
      navigationClassName="site-header__nav"
      actionsClassName="site-header__actions"
      brand={
        <a href="#top" aria-label="Zplit home">
          <span className="site-header__wordmark">Zplit</span>
          <span className="site-header__descriptor">THE MONEY TRAIL</span>
        </a>
      }
      navigation={
        <>
          <a href="#record">How it works</a>
          <a href="#personal">Personal</a>
          <a href="#groups">Groups</a>
          <a href="#budget">Budget</a>
        </>
      }
      actions={
        <>
          <ActionLink href="/login" className="site-header__access">
            Log in
          </ActionLink>
          <details className="site-header__menu">
            <summary aria-label="Open section menu">Menu</summary>
            <nav aria-label="Mobile section navigation">
              <a href="#record">How it works</a>
              <a href="#personal">Personal</a>
              <a href="#groups">Groups</a>
              <a href="#budget">Budget</a>
            </nav>
          </details>
        </>
      }
    />
  );
}
