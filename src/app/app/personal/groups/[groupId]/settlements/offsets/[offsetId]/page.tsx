import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { GroupParticipantLabel } from "@/components/groups/group-expense-row";
import { GroupOffsetConfirmation } from "@/components/groups/group-offset-confirmation";
import { GroupSettlementLiveRefresh } from "@/components/realtime/group-settlement-live-refresh";
import { formatRupiah } from "@/domain/rupiah";
import {
  createGroupOffsetRepository,
  GroupOffsetError,
  type GroupOffsetDetail,
  type GroupOffsetPresentation,
} from "@/server/group-offsets";
import { confirmGroupOffsetAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group offset details" };

const stateLabels = {
  pending: "Pending · awaiting counterparty confirmation",
  confirmed: "Confirmed · reciprocal obligations cancelled",
} as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusCopy(offset: GroupOffsetPresentation, canConfirm: boolean) {
  if (offset.state === "confirmed") {
    return "The counterparty confirmed this offset. Equal reciprocal obligations were cancelled; no money moved.";
  }
  if (canConfirm) {
    return "This offset is waiting for your confirmation. It has no applications and no effect until you confirm.";
  }
  return `Waiting for ${offset.counterparty.displayName} to confirm this offset. It has no applications and no effect until then.`;
}

function GroupOffsetSummary({ offset, canConfirm }: { offset: GroupOffsetPresentation; canConfirm: boolean }) {
  return (
    <section
      className={`group-settlement__status group-settlement__status--${offset.state}`}
      id="group-offset-status"
      tabIndex={-1}
      aria-labelledby="group-offset-status-heading"
    >
      <div>
        <p className="technical-label">STATUS</p>
        <h2 id="group-offset-status-heading">{stateLabels[offset.state]}</h2>
      </div>
      <p>{statusCopy(offset, canConfirm)}</p>
      <dl className="group-settlement__summary">
        <div>
          <dt>Initiator</dt>
          <dd><GroupParticipantLabel participant={offset.initiator} /></dd>
        </div>
        <div>
          <dt>Counterparty</dt>
          <dd><GroupParticipantLabel participant={offset.counterparty} /></dd>
        </div>
        <div>
          <dt>Equal cancellation</dt>
          <dd>{formatRupiah(offset.amount)} in each direction</dd>
        </div>
        <div>
          <dt>Money moved</dt>
          <dd>No</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd><LocalDateTime iso={offset.createdAt.toISOString()} /></dd>
        </div>
        {offset.confirmedAt ? (
          <div>
            <dt>Confirmed</dt>
            <dd><LocalDateTime iso={offset.confirmedAt.toISOString()} /></dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function GroupOffsetApplications({ groupId, offset }: { groupId: string; offset: GroupOffsetDetail }) {
  if (offset.state !== "confirmed") return null;
  const initiatorTotal = offset.applications
    .filter((application) => application.debtor.id === offset.initiatorParticipantId && application.creditor.id === offset.counterpartyParticipantId)
    .reduce((total, application) => total + application.appliedAmount, 0);
  const counterpartyTotal = offset.applications
    .filter((application) => application.debtor.id === offset.counterpartyParticipantId && application.creditor.id === offset.initiatorParticipantId)
    .reduce((total, application) => total + application.appliedAmount, 0);
  const complete = initiatorTotal === offset.amount && counterpartyTotal === offset.amount;
  return (
    <section className="group-settlement__applications" aria-labelledby="group-offset-applications-heading">
      <div className="group-section-heading">
        <div>
          <p className="technical-label">APPLIED TO BOTH DIRECTIONS</p>
          <h2 id="group-offset-applications-heading">Offset applications</h2>
        </div>
      </div>
      {complete ? (
        <div className="group-settlement__application-list">
          {offset.applications.map((application) => {
            const sourceWasVoided = application.sourceExpenseState === "voided" || application.obligationVoidedAt !== null;
            return (
              <Link
                className="group-settlement__application-row"
                href={`/app/personal/groups/${groupId}/expenses/${application.sourceExpenseId}`}
                key={application.id}
                aria-label={`View ${application.sourceExpenseDescription} expense and offset application`}
              >
                <span className="group-settlement__application-details">
                  <strong>{application.sourceExpenseDescription}</strong>
                  <small>
                    <LocalDateTime iso={application.sourceExpenseOccurredAt.toISOString()} /> · {" "}
                    <GroupParticipantLabel participant={application.debtor} /> owes {" "}
                    <GroupParticipantLabel participant={application.creditor} />
                  </small>
                  {sourceWasVoided ? <small>Voided later; offset history preserved</small> : null}
                </span>
                <strong>{formatRupiah(application.appliedAmount)}</strong>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="group-settlement__application-error" role="alert">
          Offset application history is unavailable or incomplete. The offset event remains authoritative.
        </p>
      )}
      {complete && offset.applications.some((application) => application.sourceExpenseState === "voided" || application.obligationVoidedAt !== null) ? (
        <p className="group-settlement__application-note">
          These obligations were active when the offset was confirmed. A later source-expense void does not reallocate this historical offset.
        </p>
      ) : null}
    </section>
  );
}

export default async function GroupOffsetDetailPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ groupId: string; offsetId: string }>;
  searchParams?: Promise<{ created?: string | string[] }>;
}) {
  const session = await requireSession();
  const { groupId, offsetId } = await params;
  let offset;
  try {
    offset = await createGroupOffsetRepository(getDatabase(), groupId).getOffset(offsetId, session.user.id);
  } catch (error) {
    if (error instanceof GroupOffsetError && ["not_found", "forbidden", "invalid_id"].includes(error.code)) notFound();
    throw error;
  }
  const canConfirm =
    offset.state === "pending" &&
    offset.counterparty.status === "active" &&
    offset.counterparty.userId === session.user.id;
  const query = await searchParams;
  const path = `/app/personal/groups/${groupId}/settlements`;
  return (
    <section className="app-page group-settlement-record group-offset-record" id="top">
      <GroupSettlementLiveRefresh groupId={groupId} offsetId={offset.id} />
      <div className="editorial-shell app-page__layout">
        <header className="group-settlement-record__header">
          <div>
            <p className="technical-label">GROUP OFFSET · RECORD</p>
            <h1>
              <GroupParticipantLabel participant={offset.initiator} />
              <span aria-hidden="true"> ⇄ </span>
              <GroupParticipantLabel participant={offset.counterparty} />
            </h1>
          </div>
          <Link className="group-settlement-record__back" href={path}>← Back to Group payments</Link>
        </header>
        {first(query.created) === "1" ? (
          <RecordConfirmation
            queryKey="created"
            message="Offset proposed. It has no effect until the counterparty confirms; no money moved."
            focusTargetId="group-offset-status"
          />
        ) : null}
        <div className="group-settlement-record__workspace">
          <main className="group-settlement-record__main">
            <GroupOffsetSummary offset={offset} canConfirm={canConfirm} />
            <GroupOffsetApplications groupId={groupId} offset={offset} />
            {canConfirm ? (
              <GroupOffsetConfirmation
                action={confirmGroupOffsetAction.bind(null, groupId, offset.id)}
              />
            ) : null}
          </main>
          <aside className="group-settlement-record__sidebar">
            <p className="technical-label">OFFSET MEANING</p>
            <p>
              {offset.state === "pending"
                ? "Pending offset · current canonical debt is unchanged until the counterparty confirms."
                : "Confirmed offset · equal reciprocal obligations were cancelled without changing the pair's canonical net."}
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
