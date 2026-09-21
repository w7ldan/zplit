import { zplitVNextFont } from "@/app/fonts";

export default function GroupSettlementsLoading() {
  return (
    <section className={`app-page page-content zplit-vnext groups-vnext group-settlements-page ${zplitVNextFont.variable}`} aria-busy="true">
      <div className="editorial-shell app-page__layout groups-vnext__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">GROUP PAYMENTS</p>
            <h1>Payments</h1>
            <p className="app-page__lede">Loading Group payments…</p>
          </div>
        </header>
      </div>
    </section>
  );
}
