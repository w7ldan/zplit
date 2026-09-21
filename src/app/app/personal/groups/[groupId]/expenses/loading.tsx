import { zplitVNextFont } from "@/app/fonts";

export default function GroupExpensesLoading() {
  return (
    <section className={`app-page page-content zplit-vnext groups-vnext group-expenses-page ${zplitVNextFont.variable}`} aria-busy="true">
      <div className="editorial-shell app-page__layout groups-vnext__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">GROUP EXPENSES</p>
            <h1>Expenses</h1>
            <p className="app-page__lede">Loading Group expenses…</p>
          </div>
        </header>
      </div>
    </section>
  );
}
