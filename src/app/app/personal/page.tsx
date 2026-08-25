import Link from "next/link";

export const metadata = { title: "Personal" };

const destinations = [
  ["Friends", "/app/friends", "People you split with"],
  ["Outings", "/app/outings", "Trips and shared occasions"],
  ["Expenses", "/app/expenses", "Your recorded spending"],
  ["Repayments", "/app/repayments", "Money received and allocated"],
] as const;

export default function PersonalPage() {
  return (
    <section className="app-page personal-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Personal · private ledger</p>
            <h1>Personal</h1>
            <p className="app-page__lede">Your private financial world, kept separate from future shared spaces.</p>
          </div>
          <Link className="action-link action-link--primary" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</Link>
        </header>
        <section className="personal-destinations" aria-labelledby="personal-ledger-heading">
          <div className="ledger-section__heading"><h2 id="personal-ledger-heading">Private ledger</h2><span className="technical-label">Open a workspace</span></div>
          <div className="personal-destinations__grid">
            {destinations.map(([label, href, description]) => <Link className="personal-destination" href={href} key={href}><strong>{label}</strong><span>{description}</span></Link>)}
          </div>
        </section>
        <section className="future-section" aria-labelledby="personal-groups-heading">
          <div className="ledger-section__heading"><h2 id="personal-groups-heading">Groups</h2><span className="technical-label">Future space</span></div>
          <div className="future-section__empty"><p>Groups will live here when group accounting is available.</p></div>
        </section>
      </div>
    </section>
  );
}
