import Link from "next/link";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="access-page" id="top">
      <div className="access-page__field" aria-hidden="true" />
      <div className="editorial-grid editorial-shell access-page__layout">
        <div className="access-page__marker technical-label"><Link href="/">Zplit</Link><span>OFFLINE</span></div>
        <div className="access-page__content">
          <p className="technical-label access-page__metadata">THE SERVER IS OUT OF REACH</p>
          <h1>Zplit is offline.</h1>
          <p className="access-page__lede">
            Zplit cannot reach the server right now. Financial records cannot be viewed or changed offline.
          </p>
          <div className="hero__actions">
            <Link className="action-link action-link--primary" href="/app">Try again</Link>
            <Link className="action-link action-link--quiet" href="/">Return home</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
