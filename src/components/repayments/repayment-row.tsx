import Link from "next/link";
import { SourceCalendarDate } from "@/components/editorial/local-date-time";
import { OpenTile } from "@/components/vnext/open-tile";
import { formatRupiah } from "@/domain/rupiah";

type RepaymentRecord = {
  id: string;
  friendName: string;
  friendArchivedAt: Date | null;
  amount: number;
  paidAt: Date;
  paidOn: string | null;
  paymentMethod: string | null;
  allocatedAmount: number;
  unallocatedAmount: number;
};

export function RepaymentRow({ repayment, basePath = "/app/repayments", vnext = false }: { repayment: RepaymentRecord; basePath?: string; vnext?: boolean }) {
  if (!vnext) {
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
          <div className="repayment-row__date"><span className="technical-label">Date</span><SourceCalendarDate canonicalDate={repayment.paidOn} timestamp={repayment.paidAt.toISOString()} /></div>
          <div className="repayment-row__allocation"><span className="technical-label">Allocation</span><strong>{repayment.unallocatedAmount === 0 ? "Fully applied" : `${formatRupiah(repayment.unallocatedAmount)} needs allocation`}</strong></div>
          <Link className="repayment-row__edit" href={`${basePath}/${repayment.id}`}>Edit <span aria-hidden="true">→</span></Link>
        </div>
      </article>
    );
  }
  return (
    <Link className="repayment-row vnext-row personal-vnext__record-row" href={`${basePath}/${repayment.id}`} aria-label={repayment.friendName} aria-describedby={`repayment-row-${repayment.id}-summary`}>
      <span className="sr-only" id={`repayment-row-${repayment.id}-summary`}>Repayment received {formatRupiah(repayment.amount)}, {repayment.unallocatedAmount === 0 ? "fully applied" : `${formatRupiah(repayment.unallocatedAmount)} needs allocation`}</span>
      <div className="repayment-row__primary">
        <span className="technical-label">REPAYMENT</span>
        <div>
          <h2>{repayment.friendName}</h2>
          {repayment.friendArchivedAt ? <p className="technical-label">ARCHIVED</p> : null}
          {repayment.paymentMethod ? <p className="repayment-row__payment-method">{repayment.paymentMethod}</p> : null}
        </div>
      </div>
      <div className="repayment-row__received">
        <span className="technical-label">Received</span>
        <strong className="vnext-money" aria-label={`Received repayment amount ${formatRupiah(repayment.amount)}`}>{formatRupiah(repayment.amount)}</strong>
      </div>
      <div className="repayment-row__date">
        <span className="technical-label">Date</span>
        <SourceCalendarDate canonicalDate={repayment.paidOn} timestamp={repayment.paidAt.toISOString()} />
      </div>
      <div className="repayment-row__allocation">
        <div className="repayment-row__allocation-item">
          <span className="technical-label">Applied to shares</span>
          <strong className="vnext-money" aria-label={`Applied to shares ${formatRupiah(repayment.allocatedAmount)}`}>{formatRupiah(repayment.allocatedAmount)}</strong>
        </div>
        <div className="repayment-row__allocation-item">
          <span className="technical-label">Needs allocation</span>
          <strong className="vnext-money" aria-label={`Needs allocation ${formatRupiah(repayment.unallocatedAmount)}`}>{formatRupiah(repayment.unallocatedAmount)}{repayment.unallocatedAmount === 0 ? null : " needs allocation"}</strong>
          {repayment.unallocatedAmount === 0 ? <span className="repayment-row__allocation-status">Fully applied</span> : null}
        </div>
      </div>
      <OpenTile className="repayment-row__open-tile" />
    </Link>
  );
}
