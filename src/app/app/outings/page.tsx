import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { OutingForm } from "@/components/outings/outing-form";
import { OutingRow } from "@/components/outings/outing-row";
import { createOutingAction } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordConfirmation } from "@/components/app/record-confirmation";

export const dynamic = "force-dynamic";

type OutingsPageProps = { searchParams?: Promise<{ create?: string | string[]; created?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OutingsPage({ searchParams = Promise.resolve({}) }: OutingsPageProps = {}) {
  const session = await requireSession();
  const params = await searchParams;
  const created = first(params?.created);
  const openCreate = first(params?.create) === "1";
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const [outings, expenses] = await Promise.all([repository.listOutings(), repository.listExpenses()]);
  const expenseTotals = new Map<string, { count: number; total: number }>();
  for (const expense of expenses) {
    const current = expenseTotals.get(expense.outingId) ?? { count: 0, total: 0 };
    expenseTotals.set(expense.outingId, { count: current.count + 1, total: current.total + expense.amount });
  }

  return (
    <section className="app-page outings-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Outings · shared moments</p>
            <h1>Shared moments, clearly recorded.</h1>
            <p className="app-page__lede">Name and date the event first; its expenses stay together underneath.</p>
          </div>
          <Link className="action-link action-link--primary" href="/app/outings?create=1" data-task-trigger="outing-create">Add outing</Link>
        </div>
        {created ? <RecordConfirmation queryKey="created" message="Outing added." /> : null}
        <div className="ledger-list" aria-live="polite">
          <div className="ledger-list__heading"><span className="technical-label">LATEST FIRST</span><span className="technical-label">{outings.length} entries</span></div>
          {outings.length > 0 ? outings.map((outing) => {
            const totals = expenseTotals.get(outing.id) ?? { count: 0, total: 0 };
            return <OutingRow key={outing.id} outing={outing} expenseCount={totals.count} expenseTotal={totals.total} emphasized={created === outing.id} />;
          }) : (
            <div className="ledger-empty"><h2>No outings yet.</h2><p>Record the first shared moment before adding an expense.</p><Link className="text-link" href="/app/outings?create=1" data-task-trigger="outing-create">Add an outing <span aria-hidden="true">→</span></Link></div>
          )}
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add an outing" description="Give the shared moment a name and a local date before adding expenses." triggerId="outing-create"><OutingForm action={createOutingAction} /></TaskPanel> : null}
    </section>
  );
}
