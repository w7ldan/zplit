import Link from "next/link";
import { formatRupiah } from "@/domain/rupiah";
import { SourceCalendarDate } from "@/components/editorial/local-date-time";
import { OpenTile } from "@/components/vnext/open-tile";
import type { GroupParticipantPresentation } from "@/server/group-participant-presentation";
import type { GroupExpenseListRecord } from "@/server/group-accounting";

export function GroupParticipantLabel({ participant }: { participant: GroupParticipantPresentation }) {
  const state = participant.status === "external" ? "External" : participant.status === "former" ? "Former member" : "";
  return <span>{participant.displayName}{participant.label ? ` · ${participant.label}` : ""}{state ? ` · ${state}` : ""}</span>;
}

export function GroupExpenseRow({ expense, viewerUserId, basePath }: { expense: GroupExpenseListRecord; viewerUserId: string; basePath: string }) {
  const needsConfirmation = expense.state === "pending" && expense.payer.status === "active" && expense.payer.userId === viewerUserId;
  const stateLabel = expense.state === "pending" ? "Pending confirmation" : expense.state[0]?.toUpperCase() + expense.state.slice(1);
  return (
    <Link
      className="group-expense-row vnext-row"
      data-record-id={expense.id}
      href={`${basePath}/${expense.id}`}
      aria-label={expense.description}
    >
      <div className="group-expense-row__primary">
        <span className="technical-label">GROUP EXPENSE</span>
        <h2>{expense.description}</h2>
        {needsConfirmation ? (
          <strong className="group-expense-row__attention">
            Needs your confirmation
          </strong>
        ) : null}
      </div>
      <div className="group-expense-row__meta">
        <span>
          <span className="technical-label">Amount</span><strong
            aria-label={`Expense amount ${formatRupiah(expense.totalAmount)}`}
          >{formatRupiah(expense.totalAmount)}</strong>
        </span>
        <span>
          <span className="technical-label">Occurred</span><SourceCalendarDate canonicalDate={expense.occurredOn} timestamp={expense.occurredAt.toISOString()} />
        </span>
        <span>
          <span className="technical-label">Paid by</span><GroupParticipantLabel participant={expense.payer} />
        </span>
        <span>
          <span className="technical-label">Shares</span>{expense.shareCount}
        </span>
        <span
          className={`group-expense-row__state group-expense-row__state--${expense.state}`}
        >
          {stateLabel}
        </span>
      </div>
      <OpenTile />
    </Link>
  );
}
