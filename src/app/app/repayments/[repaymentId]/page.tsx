import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentAllocationEditor } from "@/components/repayments/repayment-allocation-editor";
import { formatRupiah } from "@/domain/rupiah";
import { createLedgerRepository, deletionImpactRevision, LedgerNotFoundError } from "@/domain/ledger-repository";
import { loadRepaymentFriendContext, removeRepaymentAllocationAction, replaceRepaymentAllocationsAction, searchFriendOptions, undoRepaymentAllocationAction, updateRepaymentAction } from "../actions";
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
  const currentImpactRevision = deletionImpactRevision(deletionImpact);
  const [friendOptionRows, friendContext, recentPaymentMethods] = await Promise.all([repository.searchFriends({ selectedId: plan.friendId }), repository.getRepaymentFriendContext(plan.friendId), repository.listRecentPaymentMethods()]);
  const friendOptions = friendOptionRows.map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived }));
  const formContext = { ...friendContext, option: { id: friendContext.option.id, label: friendContext.option.name, archived: friendContext.option.archived } };
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
        <div className="repayment-record__tasks">
          <div className="repayment-record__primary-task">
            <div className="repayment-record__allocations">
              <RepaymentAllocationEditor action={replaceRepaymentAllocationsAction.bind(null, repayment.id)} plan={plan} removeAction={removeRepaymentAllocationAction} undoAction={undoRepaymentAllocationAction} />
            </div>
          </div>
          <aside className="repayment-record__sidebar">
            <div className="repayment-record__meta" aria-label="Repayment metadata">
              <div><span className="technical-label">Received</span><strong>{formatRupiah(repayment.amount)}</strong></div>
              <div><span className="technical-label">Applied to shares</span><strong>{formatRupiah(repayment.allocatedAmount)}</strong></div>
              <div><span className="technical-label">Needs allocation</span><strong>{formatRupiah(repayment.unallocatedAmount)}</strong></div>
              <div><span className="technical-label">Payment date</span><LocalDateTime iso={repayment.paidAt.toISOString()} mode="date" /></div>
              <div><span className="technical-label">Payment method</span><span>{repayment.paymentMethod ?? "—"}</span></div>
              <div><span className="technical-label">Notes</span><span className="repayment-record__notes-value">{repayment.notes ?? "—"}</span></div>
            </div>
            <div className="repayment-record__form">
              <p className="technical-label">EDIT RECORD</p>
              <RepaymentForm
                action={updateRepaymentAction.bind(null, repayment.id)}
                friends={friendOptions}
                searchFriends={searchFriendOptions}
                recentPaymentMethods={recentPaymentMethods}
                mode="edit"
                friendLocked={repayment.allocatedAmount > 0}
                initialFriendContext={formContext}
                loadFriendContext={loadRepaymentFriendContext}
                initialPaidAtUtc={repayment.paidAt.toISOString()}
                initialValues={{ friendId: repayment.friendId, amountRupiah: repayment.amount.toString(), paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: repayment.paymentMethod ?? "", notes: repayment.notes ?? "" }}
              />
            </div>
          </aside>
        </div>
        <DeleteRecordForm action={deleteRepaymentAction.bind(null, repayment.id)} recordType="repayment" impact={deletionImpact} impactRevision={currentImpactRevision} />
      </div>
    </section>
  );
}
