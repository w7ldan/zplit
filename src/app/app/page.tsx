import Link from "next/link";

export default function AppPage() {
  return (
    <section className="app-index" id="top">
      <div className="editorial-grid editorial-shell app-index__layout">
        <div className="app-index__marker technical-label">06 / LEDGER INDEX</div>
        <div className="app-index__content">
          <p className="technical-label app-index__metadata">PRIVATE APPLICATION / OWNER SESSION</p>
          <h1>Your private record.</h1>
          <p className="app-index__lede">
            Keep people, outings, and expenses clear first. Shares and settlement arrive in later stages.
          </p>
          <div className="app-index__actions">
            <Link className="action-link action-link--primary" href="/app/friends">Manage friends</Link>
            <Link className="action-link action-link--quiet" href="/app/outings">Manage outings</Link>
            <Link className="action-link action-link--quiet" href="/app/expenses">Manage expenses</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
