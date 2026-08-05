"use client";

import { useDetachedHeader } from "@/components/navigation/use-detached-header";

export function SiteHeader() {
  const detached = useDetachedHeader();

  return (
    <header className={`site-header-wrapper${detached ? " site-header-wrapper--detached site-header--detached" : ""}`} data-detached={detached} aria-label="Site header">
      <div className={`site-header editorial-grid editorial-shell${detached ? " site-header--detached" : ""}`} data-detached={detached}>
        <a className="site-header__brand" href="#top" aria-label="Zplit home">
          <span className="site-header__wordmark">Zplit</span>
          <span className="site-header__descriptor">SHARED EXPENSE LEDGER</span>
        </a>
        <nav className="site-header__nav" aria-label="Primary navigation">
          <a href="#journey">How it works</a>
          <a href="#ledger">The ledger</a>
        </nav>
        <div className="site-header__actions"><a className="site-header__access" href="/app">Open Zplit</a></div>
      </div>
    </header>
  );
}
