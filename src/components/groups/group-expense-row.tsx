import Link from "next/link";
import { formatRupiah } from "@/domain/rupiah";
import { LocalDateTime } from "@/components/editorial/local-date-time";
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
    <article className="group-expense-row" data-record-id={expense.id}>
      <div className="group-expense-row__primary">
        <span className="technical-label">GROUP EXPENSE</span>
        <h2>
          <Link href={`${basePath}/${expense.id}`}>
            {expense.description}
          </Link>
        </h2>
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
          <span className="technical-label">Occurred</span><LocalDateTime iso={expense.occurredAt.toISOString()} />
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
    </article>
  );
}
