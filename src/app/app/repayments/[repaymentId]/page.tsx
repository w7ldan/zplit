import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentAllocationEditor } from "@/components/repayments/repayment-allocation-editor";
import { formatRupiah } from "@/domain/rupiah";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { replaceRepaymentAllocationsAction, updateRepaymentAction } from "../actions";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { deleteRepaymentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function RepaymentRecordPage({ params, searchParams }: { params: Promise<{ repaymentId: string }>; searchParams?: Promise<{ created?: string | string[]; saved?: string | string[] }> }) {
  const session = await requireSession();
  const { repaymentId } = await params;
  const query = await searchParams;
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  let plan;
  try {
    plan = await repository.getRepaymentAllocationPlan(repaymentId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const deletionImpact = await repository.getRepaymentDeletionImpact(repaymentId);
  const [activeFriends, archivedFriends, summary] = await Promise.all([repository.listFriends(), repository.listFriends({ archived: true }), repository.getLedgerSummary()]);
  const friends = [...activeFriends, ...archivedFriends];
  const repayment = plan;

  return (
    <section className="app-page repayment-record" id="top">
      <div className="editorial-grid editorial-shell repayment-record__layout">
        <div className="repayment-record__intro">
          <p className="technical-label">Repayment · allocate received money</p>
          <h1>{repayment.friendName}</h1>
          <Link className="repayment-record__back" href="/app/repayments">← Back to repayments</Link>
        </div>
        {query?.created === "1" ? <RecordConfirmation queryKey="created" message="Repayment recorded. Review eligible shares below." /> : query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Repayment changes saved." /> : null}
        <div className="repayment-record__meta" aria-label="Repayment metadata">
          <div><span className="technical-label">Amount</span><strong>{formatRupiah(repayment.amount)}</strong></div>
          <div><span className="technical-label">Allocated</span><strong>{formatRupiah(repayment.allocatedAmount)}</strong></div>
          <div><span className="technical-label">Unallocated</span><strong>{formatRupiah(repayment.unallocatedAmount)}</strong></div>
          <div><span className="technical-label">Payment date</span><LocalDateTime iso={repayment.paidAt.toISOString()} mode="date" /></div>
          <div><span className="technical-label">Payment method</span><span>{repayment.paymentMethod ?? "—"}</span></div>
          <div><span className="technical-label">Notes</span><span className="repayment-record__notes-value">{repayment.notes ?? "—"}</span></div>
        </div>
        <div className="repayment-record__form">
          <p className="technical-label">EDIT RECORD</p>
          <RepaymentForm
            action={updateRepaymentAction.bind(null, repayment.id)}
            friends={friends}
            mode="edit"
            friendLocked={repayment.allocatedAmount > 0}
            initialPaidAtUtc={repayment.paidAt.toISOString()}
            outstandingByFriend={Object.fromEntries(summary.friendBalances.map((balance) => [balance.friendId, balance.outstandingAmount]))}
            initialValues={{ friendId: repayment.friendId, amountRupiah: repayment.amount.toString(), paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: repayment.paymentMethod ?? "", notes: repayment.notes ?? "" }}
          />
        </div>
        <div className="repayment-record__allocations">
          <RepaymentAllocationEditor action={replaceRepaymentAllocationsAction.bind(null, repayment.id)} plan={plan} />
        </div>
        <DeleteRecordForm action={deleteRepaymentAction.bind(null, repayment.id)} recordType="repayment" impact={deletionImpact} />
      </div>
    </section>
  );
}
