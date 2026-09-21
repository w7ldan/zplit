"use client";

import { zplitVNextFont } from "@/app/fonts";

export default function GroupSettlementsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className={`app-page page-content zplit-vnext groups-vnext group-settlements-page ${zplitVNextFont.variable}`}>
      <div className="editorial-shell app-page__layout groups-vnext__layout">
        <div className="ledger-empty" role="alert">
          <h1>Group payments are unavailable.</h1>
          <p>We could not load this Group financial surface.</p>
          <button className="action-link action-link--primary" type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </section>
  );
}
