export function SiteHeader() {
  return (
    <header className="site-header editorial-grid editorial-shell" aria-label="Site header">
      <a className="site-header__brand" href="#top" aria-label="Zplit home">
        <span className="site-header__wordmark">Zplit</span>
        <span className="site-header__descriptor">PERSONAL LEDGER</span>
      </a>
      <nav className="site-header__nav" aria-label="Primary navigation">
        <a href="#method">Method</a>
        <a href="#ledger">Ledger</a>
        <a href="#system">System</a>
        <a className="site-header__access" href="/app">Open ledger</a>
      </nav>
    </header>
  );
}
