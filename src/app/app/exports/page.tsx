import Link from "next/link";
import { requireSession } from "@/auth/require-session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ledger exports" };

const exports = [
  ["Friend balances", "Assigned, repaid, and outstanding totals for active and archived friends.", "/app/exports/balances.csv"],
  ["Expense shares", "Each friend’s share, allocated repayments, and current state for every expense share.", "/app/exports/expense-shares.csv"],
  ["Repayments", "Received amounts, allocated amounts, remaining amounts, and payment methods.", "/app/exports/repayments.csv"],
] as const;

export default async function ExportsPage() {
  await requireSession();

  return (
    <section className="app-page exports-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Exports · current ledger records</p>
            <h1>Ledger exports</h1>
            <p className="app-page__lede">Exports contain the signed-in user’s current ledger. Deleted records are not included. Files use whole rupiah and UTC timestamps. Each download is private and generated on demand.</p>
          </div>
        </div>
        <div className="exports-list">
          {exports.map(([title, description, href]) => (
            <div className="exports-row" key={href}>
              <div>
                <h2>{title}</h2>
                <p>{description}</p>
              </div>
              <Link className="text-link" href={href}>Download CSV <span aria-hidden="true">→</span></Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
