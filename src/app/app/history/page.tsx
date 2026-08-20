import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { LedgerHistory } from "@/components/history/ledger-history";
import type { LedgerHistoryType } from "@/domain/ledger-history";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ledger history" };

type HistoryPageProps = {
  searchParams?: Promise<{ type?: string | string[]; cursor?: string | string[] }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function historyType(value: string | undefined): LedgerHistoryType {
  return value === "expense" || value === "repayment" ? value : "all";
}

export default async function HistoryPage({ searchParams = Promise.resolve({}) }: HistoryPageProps = {}) {
  const session = await requireSession();
  const params = await searchParams;
  const type = historyType(first(params.type));
  const cursor = first(params.cursor);
  const history = await createLedgerRepository(getDatabase(), session.user.id).listLedgerHistory({ cursor, type });

  return (
    <section className="app-page history-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">History · current ledger records</p>
            <h1>Ledger history</h1>
            <p className="app-page__lede">Expenses and repayments, ordered by when they happened. This is the current ledger, not an audit archive.</p>
          </div>
        </div>
        <LedgerHistory items={history.items} type={type} nextCursor={history.nextCursor} />
      </div>
    </section>
  );
}
