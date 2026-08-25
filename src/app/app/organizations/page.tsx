export const metadata = { title: "Organizations" };

export default function OrganizationsPage() {
  return (
    <section className="app-page organization-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Organizations · managed spaces</p>
            <h1>Organizations</h1>
            <p className="organization-page__lede">Managed financial spaces will appear here when organizations are available.</p>
          </div>
        </header>
        <section className="future-section" aria-labelledby="organization-grid-heading">
          <div className="ledger-section__heading"><h2 id="organization-grid-heading">Your organizations</h2><span className="technical-label">0 organizations</span></div>
          <div className="organization-grid"><div className="organization-card">No organizations yet.</div></div>
        </section>
      </div>
    </section>
  );
}
