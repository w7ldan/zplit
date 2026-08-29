import Link from "next/link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";
import type { GroupSettlementPresentation } from "@/server/group-settlements";
import { GroupParticipantLabel } from "./group-expense-row";

const stateLabels = {
  pending: "Pending · awaiting recipient confirmation",
  confirmed: "Confirmed · reflected in balance",
} as const;

export function GroupSettlementRow({
  settlement,
  viewerUserId,
  basePath,
}: {
  settlement: GroupSettlementPresentation;
  viewerUserId: string;
  basePath: string;
}) {
  const needsConfirmation =
    settlement.state === "pending" &&
    settlement.recipient.status === "active" &&
    settlement.recipient.userId === viewerUserId;
  return (
    <article className="group-settlement-row" data-record-id={settlement.id}>
      <div className="group-settlement-row__primary">
        <span className="technical-label">GROUP PAYMENT</span>
        <h2>
          <Link href={`${basePath}/${settlement.id}`}>
            <GroupParticipantLabel participant={settlement.sender} />
            <span aria-hidden="true"> → </span>
            <GroupParticipantLabel participant={settlement.recipient} />
          </Link>
        </h2>
        {needsConfirmation ? (
          <strong className="group-settlement-row__attention">
            Needs your confirmation
          </strong>
        ) : null}
      </div>
      <div className="group-settlement-row__meta">
        <span>
          <span className="technical-label">Amount</span>
          <strong aria-label={`Payment amount ${formatRupiah(settlement.amount)}`}>
            {formatRupiah(settlement.amount)}
          </strong>
        </span>
        <span>
          <span className="technical-label">Method</span>
          {settlement.paymentMethod}
        </span>
        <span>
          <span className="technical-label">Created</span>
          <LocalDateTime iso={settlement.createdAt.toISOString()} />
        </span>
        <span>
          <span className="technical-label">Status</span>
          <span className={`group-settlement-row__state group-settlement-row__state--${settlement.state}`}>
            {stateLabels[settlement.state]}
          </span>
        </span>
        <span>
          <span className="technical-label">Confirmed</span>
          {settlement.confirmedAt ? (
            <LocalDateTime iso={settlement.confirmedAt.toISOString()} />
          ) : "—"}
        </span>
        {settlement.proof ? (
          <span className="group-settlement-row__proof">Proof attached</span>
        ) : null}
      </div>
    </article>
  );
}
