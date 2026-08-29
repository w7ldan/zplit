import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { RepaymentPaymentProof } from "@/components/repayments/repayment-payment-proof";
import { GroupParticipantLabel } from "@/components/groups/group-expense-row";
import { GroupSettlementConfirmation } from "@/components/groups/group-settlement-confirmation";
import { GroupSettlementLiveRefresh } from "@/components/realtime/group-settlement-live-refresh";
import { formatRupiah } from "@/domain/rupiah";
import {
  createGroupSettlementRepository,
  GroupSettlementError,
  type GroupSettlementDetail,
  type GroupSettlementPresentation,
} from "@/server/group-settlements";
import { confirmGroupSettlementAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group payment details" };

const stateLabels = {
  pending: "Pending · awaiting recipient confirmation",
  confirmed: "Confirmed · reflected in canonical balance",
} as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusCopy(
  settlement: GroupSettlementPresentation,
  canConfirm: boolean,
) {
  if (settlement.state === "confirmed") {
    return "The recipient confirmed this payment. It is already included in the canonical Group balance.";
  }
  if (canConfirm) {
    return "This payment is waiting for your confirmation. It has not reduced the canonical Group balance yet.";
  }
  return `Waiting for ${settlement.recipient.displayName} to confirm this payment. It has not reduced the canonical Group balance yet.`;
}

function GroupSettlementSummary({
  settlement,
  canConfirm,
}: {
  settlement: GroupSettlementPresentation;
  canConfirm: boolean;
}) {
  return (
    <section
      className={`group-settlement__status group-settlement__status--${settlement.state}`}
      id="group-settlement-status"
      tabIndex={-1}
      aria-labelledby="group-settlement-status-heading"
    >
      <div>
        <p className="technical-label">STATUS</p>
        <h2 id="group-settlement-status-heading">
          {stateLabels[settlement.state]}
        </h2>
      </div>
      <p>{statusCopy(settlement, canConfirm)}</p>
      <dl className="group-settlement__summary">
        <div>
          <dt>Sender</dt>
          <dd><GroupParticipantLabel participant={settlement.sender} /></dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd><GroupParticipantLabel participant={settlement.recipient} /></dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{formatRupiah(settlement.amount)}</dd>
        </div>
        <div>
          <dt>Payment method</dt>
          <dd>{settlement.paymentMethod}</dd>
        </div>
        <div>
          <dt>Group context</dt>
          <dd>Direct Group payment</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd><LocalDateTime iso={settlement.createdAt.toISOString()} /></dd>
        </div>
        {settlement.confirmedAt ? (
          <div>
            <dt>Confirmed</dt>
            <dd><LocalDateTime iso={settlement.confirmedAt.toISOString()} /></dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function GroupSettlementApplications({
  groupId,
  settlement,
}: {
  groupId: string;
  settlement: GroupSettlementDetail;
}) {
  if (settlement.state !== "confirmed") return null;
  const applicationTotal = settlement.applications.reduce(
    (total, application) => total + application.appliedAmount,
    0,
  );
  const complete = settlement.applications.length > 0 && applicationTotal === settlement.amount;
  const hasVoidedApplication = settlement.applications.some(
    (application) => application.sourceExpenseState === "voided" || application.obligationVoidedAt !== null,
  );
  return (
    <section
      className="group-settlement__applications"
      aria-labelledby="group-settlement-applications-heading"
    >
      <div className="group-section-heading">
        <div>
          <p className="technical-label">APPLIED TO</p>
          <h2 id="group-settlement-applications-heading">Payment applications</h2>
        </div>
      </div>
      {complete ? (
        <div className="group-settlement__application-list">
          {settlement.applications.map((application) => {
            const sourceWasVoided = application.sourceExpenseState === "voided" || application.obligationVoidedAt !== null;
            return (
              <Link
                className="group-settlement__application-row"
                href={`/app/personal/groups/${groupId}/expenses/${application.sourceExpenseId}`}
                key={application.id}
                aria-label={`View ${application.sourceExpenseDescription} expense and payment application`}
              >
                <span className="group-settlement__application-details">
                  <strong>{application.sourceExpenseDescription}</strong>
                  <small>
                    <LocalDateTime iso={application.sourceExpenseOccurredAt.toISOString()} /> · {" "}
                    <GroupParticipantLabel participant={application.debtor} /> owes {" "}
                    <GroupParticipantLabel participant={application.creditor} />
                  </small>
                  {sourceWasVoided ? <small>Voided later</small> : null}
                </span>
                <strong>{formatRupiah(application.appliedAmount)}</strong>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="group-settlement__application-error" role="alert">
          Application history is unavailable or incomplete. No allocation is shown here; the payment remains authoritative.
        </p>
      )}
      {hasVoidedApplication && complete ? (
        <p className="group-settlement__application-note">
          This payment was applied while the obligation was active. The source expense was later voided.
        </p>
      ) : null}
    </section>
  );
}

export default async function GroupSettlementDetailPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ groupId: string; settlementId: string }>;
  searchParams?: Promise<{ created?: string | string[]; proof?: string | string[] }>;
}) {
  const session = await requireSession();
  const { groupId, settlementId } = await params;
  let settlement;
  try {
    settlement = await createGroupSettlementRepository(
      getDatabase(),
      groupId,
    ).getSettlement(settlementId, session.user.id);
  } catch (error) {
    if (error instanceof GroupSettlementError && ["not_found", "forbidden", "invalid_id"].includes(error.code)) notFound();
    throw error;
  }
  const canConfirm =
    settlement.state === "pending" &&
    settlement.recipient.status === "active" &&
    settlement.recipient.userId === session.user.id;
  const canEditProof =
    settlement.state === "pending" &&
    settlement.sender.status === "active" &&
    settlement.sender.userId === session.user.id;
  const query = await searchParams;
  const proofFailed = first(query.proof) === "failed";
  const proofReadOnlyMessage = settlement.state === "confirmed"
    ? "Payment proof is read-only after confirmation. Proof is evidence only."
    : "Only the sender can change payment proof while this payment is pending. Proof is evidence only.";
  const path = `/app/personal/groups/${groupId}/settlements`;

  return (
    <section className="app-page group-settlement-record" id="top">
      <GroupSettlementLiveRefresh
        groupId={groupId}
        settlementId={settlement.id}
      />
      <div className="editorial-shell app-page__layout">
        <header className="group-settlement-record__header">
          <div>
            <p className="technical-label">GROUP PAYMENT · RECORD</p>
            <h1>
              <GroupParticipantLabel participant={settlement.sender} />
              <span aria-hidden="true"> → </span>
              <GroupParticipantLabel participant={settlement.recipient} />
            </h1>
          </div>
          <Link className="group-settlement-record__back" href={path}>
            ← Back to Group payments
          </Link>
        </header>
        {first(query.created) === "1" ? (
          <RecordConfirmation
            queryKey="created"
            message={
              proofFailed
                ? "Payment recorded. Add the proof below; the first attachment did not save."
                : "Payment recorded. Pending recipient confirmation; the balance is unchanged."
            }
            focusTargetId="group-settlement-status"
          />
        ) : null}
        <div className="group-settlement-record__workspace">
          <main className="group-settlement-record__main">
            <GroupSettlementSummary
              settlement={settlement}
              canConfirm={canConfirm}
            />
            <GroupSettlementApplications
              groupId={groupId}
              settlement={settlement}
            />
            <RepaymentPaymentProof
              repaymentId={settlement.id}
              initialPaymentProof={settlement.proof ? {
                ...settlement.proof,
                createdAt: settlement.proof.createdAt.toISOString(),
              } : null}
              basePath={path}
              canEdit={canEditProof}
              description="Visible to authorized Group members. JPEG, PNG, or WebP, up to 5 MiB. Proof is evidence only and does not confirm payment."
              readOnlyMessage={proofReadOnlyMessage}
            />
            {canConfirm ? (
              <GroupSettlementConfirmation
                action={confirmGroupSettlementAction.bind(
                  null,
                  groupId,
                  settlement.id,
                )}
              />
            ) : null}
          </main>
          <aside className="group-settlement-record__sidebar">
            <p className="technical-label">BALANCE MEANING</p>
            <p>
              {settlement.state === "pending"
                ? "Pending payment · current debt is unchanged until the recipient confirms."
                : "Confirmed payment · the canonical Group balance already includes this payment."}
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
