import Link from "next/link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";

type RepaymentRecord = {
  id: string;
  friendName: string;
  friendArchivedAt: Date | null;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  allocatedAmount: number;
  unallocatedAmount: number;
};

export function RepaymentRow({ repayment }: { repayment: RepaymentRecord }) {
  return (
    <article className="repayment-row">
      <div className="repayment-row__primary">
        <span className="technical-label">REPAYMENT</span>
        <div>
          <h2><Link href={`/app/repayments/${repayment.id}`}>{repayment.friendName}</Link></h2>
          {repayment.friendArchivedAt ? <p className="technical-label">ARCHIVED</p> : null}
        </div>
      </div>
      <div className="repayment-row__meta">
        <strong>{formatRupiah(repayment.amount)}</strong>
        <LocalDateTime iso={repayment.paidAt.toISOString()} />
        {repayment.paymentMethod ? <span>{repayment.paymentMethod}</span> : <span />}
        <div><span className="technical-label">Allocated</span><strong>{formatRupiah(repayment.allocatedAmount)}</strong></div>
        <div><span className="technical-label">Unallocated</span><strong>{formatRupiah(repayment.unallocatedAmount)}</strong></div>
        {repayment.unallocatedAmount === repayment.amount ? <span className="technical-label">UNALLOCATED</span> : <span />}
        <Link className="repayment-row__edit" href={`/app/repayments/${repayment.id}`}>Edit <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
