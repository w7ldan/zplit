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

export function RepaymentRow({ repayment, basePath = "/app/repayments" }: { repayment: RepaymentRecord; basePath?: string }) {
  return (
    <article className="repayment-row">
      <div className="repayment-row__primary">
        <span className="technical-label">REPAYMENT</span>
        <div>
          <h2><Link href={`${basePath}/${repayment.id}`}>{repayment.friendName}</Link></h2>
          {repayment.friendArchivedAt ? <p className="technical-label">ARCHIVED</p> : null}
          {repayment.paymentMethod ? <p className="repayment-row__payment-method">{repayment.paymentMethod}</p> : null}
        </div>
      </div>
      <div className="repayment-row__meta">
        <div className="repayment-row__received"><span className="technical-label">Received</span><strong aria-label={`Received repayment amount ${formatRupiah(repayment.amount)}`}>{formatRupiah(repayment.amount)}</strong></div>
        <div className="repayment-row__date"><span className="technical-label">Date</span><LocalDateTime iso={repayment.paidAt.toISOString()} /></div>
        <div className="repayment-row__allocation"><span className="technical-label">Allocation</span><strong>{repayment.unallocatedAmount === 0 ? "Fully applied" : `${formatRupiah(repayment.unallocatedAmount)} needs allocation`}</strong></div>
        <Link className="repayment-row__edit" href={`${basePath}/${repayment.id}`}>Edit <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
