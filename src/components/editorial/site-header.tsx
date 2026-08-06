"use client";

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
      brand={(
        <a href="#top" aria-label="Zplit home">
          <span className="site-header__wordmark">Zplit</span>
          <span className="site-header__descriptor">SHARED EXPENSE LEDGER</span>
        </a>
      )}
      navigation={(
        <>
          <a href="#journey">How it works</a>
          <a href="#ledger">The ledger</a>
        </>
      )}
      actions={<a className="site-header__access" href="/app">Open Zplit</a>}
    />
  );
}
