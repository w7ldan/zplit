"use client";

export default function GroupExpensesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="app-page group-expenses-page"><div className="editorial-shell app-page__layout"><div className="ledger-empty" role="alert"><h1>Group expenses are unavailable.</h1><p>We could not load this Group accounting surface.</p><button className="action-link action-link--primary" type="button" onClick={reset}>Try again</button></div></div></section>;
}
