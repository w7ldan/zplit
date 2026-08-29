import Link from "next/link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";
import type { GroupOffsetPresentation } from "@/server/group-offsets";
import { GroupParticipantLabel } from "./group-expense-row";

const stateLabels = {
  pending: "Pending · awaiting counterparty confirmation",
  confirmed: "Confirmed · reciprocal obligations cancelled",
} as const;

export function GroupOffsetRow({
  offset,
  viewerUserId,
  basePath,
}: {
  offset: GroupOffsetPresentation;
  viewerUserId: string;
  basePath: string;
}) {
  const needsConfirmation =
    offset.state === "pending" &&
    offset.counterparty.status === "active" &&
    offset.counterparty.userId === viewerUserId;
  return (
    <article className="group-settlement-row group-offset-row" data-record-id={offset.id}>
      <div className="group-settlement-row__primary">
        <span className="technical-label">GROUP OFFSET</span>
        <h2>
          <Link href={`${basePath}/offsets/${offset.id}`}>
            <GroupParticipantLabel participant={offset.initiator} />
            <span aria-hidden="true"> ⇄ </span>
            <GroupParticipantLabel participant={offset.counterparty} />
          </Link>
        </h2>
        {needsConfirmation ? <strong className="group-settlement-row__attention">Needs your confirmation</strong> : null}
      </div>
      <div className="group-settlement-row__meta">
        <span>
          <span className="technical-label">Cancelled</span>
          <strong aria-label={`Offset amount ${formatRupiah(offset.amount)}`}>{formatRupiah(offset.amount)}</strong>
        </span>
        <span>
          <span className="technical-label">Meaning</span>
          No money moved
        </span>
        <span>
          <span className="technical-label">Created</span>
          <LocalDateTime iso={offset.createdAt.toISOString()} />
        </span>
        <span>
          <span className="technical-label">Status</span>
          <span className={`group-settlement-row__state group-settlement-row__state--${offset.state}`}>
            {stateLabels[offset.state]}
          </span>
        </span>
        <span>
          <span className="technical-label">Confirmed</span>
          {offset.confirmedAt ? <LocalDateTime iso={offset.confirmedAt.toISOString()} /> : "—"}
        </span>
      </div>
    </article>
  );
}
