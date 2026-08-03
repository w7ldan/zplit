import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { formatRupiah } from "@/domain/rupiah";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { updateRepaymentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function RepaymentRecordPage({ params }: { params: Promise<{ repaymentId: string }> }) {
  const session = await requireSession();
  const { repaymentId } = await params;
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  let repayment;
  try {
    repayment = await repository.getRepayment(repaymentId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const [activeFriends, archivedFriends] = await Promise.all([repository.listFriends(), repository.listFriends({ archived: true })]);
  const friends = [...activeFriends, ...archivedFriends];

  return (
    <section className="repayment-record" id="top">
      <div className="editorial-grid editorial-shell repayment-record__layout">
        <div className="repayment-record__marker technical-label">10 / REPAYMENT RECORD</div>
        <div className="repayment-record__intro">
          <p className="technical-label">PRIVATE PAYMENT / EDITABLE RECORD</p>
          <h1>{repayment.friendName}</h1>
          <Link className="repayment-record__back" href="/app/repayments">← Back to repayments</Link>
        </div>
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
            initialPaidAtUtc={repayment.paidAt.toISOString()}
            initialValues={{ friendId: repayment.friendId, amountRupiah: repayment.amount.toString(), paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: repayment.paymentMethod ?? "", notes: repayment.notes ?? "" }}
          />
          <p className="repayment-record__next">Allocation management arrives next. Until then, unallocated money stays visible and does not reduce outstanding debt.</p>
        </div>
      </div>
    </section>
  );
}
