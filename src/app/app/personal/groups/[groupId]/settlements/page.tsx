import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatRupiah } from "@/domain/rupiah";
import { recordHref, type RecordPage } from "@/domain/record-retrieval";
import type {
  GroupParticipantEligibility,
  GroupSettlementRecipientOption,
} from "@/domain/group-contracts";
import {
  createGroupAccountingRepository,
  GroupAccountingError,
} from "@/server/group-accounting";
import {
  createGroupSettlementRepository,
  GroupSettlementError,
  type GroupSettlementPresentation,
} from "@/server/group-settlements";
import { GroupSettlementForm } from "@/components/groups/group-settlement-form";
import { GroupSettlementRow } from "@/components/groups/group-settlement-row";
import { GroupSettlementLiveRefresh } from "@/components/realtime/group-settlement-live-refresh";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordPagination } from "@/components/records/record-pagination";
import { createGroupSettlementAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group payments" };

type GroupSettlementSearchParams = {
  [key: string]: string | string[] | undefined;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function settlementRecipients(
  participants: GroupParticipantEligibility[],
  senderParticipantId: string | undefined,
  balances: Array<{ debtorParticipantId: string; creditorParticipantId: string; amount: number }>,
): GroupSettlementRecipientOption[] {
  if (!senderParticipantId) return [];
  const debtByRecipient = new Map(
    balances
      .filter((balance) => balance.debtorParticipantId === senderParticipantId)
      .map((balance) => [balance.creditorParticipantId, balance.amount]),
  );
  return participants
    .filter(
      (participant) =>
        participant.id !== senderParticipantId &&
        participant.status === "active" &&
        participant.canBeCreditor &&
        (debtByRecipient.get(participant.id) ?? 0) > 0,
    )
    .map((participant) => ({
      id: participant.id,
      displayName: participant.displayName ?? "Group member",
      label: participant.label,
      currentDebt: debtByRecipient.get(participant.id) ?? 0,
    }));
}

function GroupSettlementList({
  page,
  path,
  viewerUserId,
}: {
  page: RecordPage<GroupSettlementPresentation>;
  path: string;
  viewerUserId: string;
}) {
  return (
    <div className="ledger-list" id="settlement-list">
      <div className="ledger-list__heading">
        <span className="technical-label">LATEST FIRST</span>
        <span className="technical-label">{page.totalItems} entries</span>
      </div>
      {page.items.length ? (
        page.items.map((settlement) => (
          <GroupSettlementRow
            key={settlement.id}
            settlement={settlement}
            viewerUserId={viewerUserId}
            basePath={path}
          />
        ))
      ) : (
        <div className="ledger-empty">
          <h2>No Group payments yet.</h2>
          <p>Recorded payments will keep their pending or confirmed status here.</p>
        </div>
      )}
      <RecordPagination
        page={page.page}
        pageSize={page.pageSize}
        totalItems={page.totalItems}
        totalPages={page.totalPages}
        href={path}
        anchor="settlement-list"
      />
    </div>
  );
}

export default async function GroupSettlementsPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<GroupSettlementSearchParams>;
}) {
  const session = await requireSession();
  const { groupId } = await params;
  const query = await searchParams;
  const path = `/app/personal/groups/${groupId}/settlements`;
  const settlementRepository = createGroupSettlementRepository(getDatabase(), groupId);
  const accountingRepository = createGroupAccountingRepository(getDatabase(), groupId);
  let page;
  let participants;
  let balances;
  try {
    [page, participants, balances] = await Promise.all([
      settlementRepository.listSettlements(session.user.id, first(query.page)),
      accountingRepository.getParticipantEligibility(session.user.id),
      settlementRepository.getBalances(session.user.id),
    ]);
  } catch (error) {
    if (
      (error instanceof GroupSettlementError || error instanceof GroupAccountingError) &&
      ["not_found", "forbidden", "not_member", "invalid_id"].includes(error.code)
    ) notFound();
    throw error;
  }
  const sender = participants.find(
    (participant) => participant.userId === session.user.id && participant.canPay,
  );
  const recipients = settlementRecipients(participants, sender?.id, balances);
  const openCreate = first(query.create) === "1" && recipients.length > 0;
  return (
    <section className="app-page group-settlements-page" id="top">
      <GroupSettlementLiveRefresh groupId={groupId} />
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">GROUP PAYMENTS</p>
            <h1>Payments</h1>
            <p className="app-page__lede">Record direct payments against current Group debt. The recipient confirms before the payment changes the canonical balance.</p>
          </div>
          {recipients.length ? (
            <Link
              className="action-link action-link--primary"
              href={recordHref(path, query, { create: "1" })}
              data-task-trigger="group-settlement-create"
            >
              Record payment
            </Link>
          ) : null}
        </header>
        <section className="group-settlement-page__balance" aria-labelledby="group-settlement-balance-heading">
          <div>
            <p className="technical-label">CANONICAL BALANCE</p>
            <h2 id="group-settlement-balance-heading">Current debt to settle</h2>
          </div>
          {recipients.length ? (
            <ul>
              {recipients.map((recipient) => (
                <li key={recipient.id}>
                  <span>{recipient.displayName}{recipient.label ? ` · ${recipient.label}` : ""}</span>
                  <strong>{formatRupiah(recipient.currentDebt)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>No current debt from you to another active registered Group member is available to settle.</p>
          )}
          <p>Pending payments stay in the outstanding debt until the recipient confirms. Confirmed payments are already included here.</p>
        </section>
        <GroupSettlementList
          page={page}
          path={path}
          viewerUserId={session.user.id}
        />
      </div>
      {openCreate && sender ? (
        <TaskPanel
          open
          title="Record a Group payment"
          description="You are the sender. The recipient must confirm before the canonical balance changes."
          triggerId="group-settlement-create"
        >
          <GroupSettlementForm
            action={createGroupSettlementAction.bind(null, groupId, sender.id)}
            senderName={sender.displayName ?? "You"}
            recipients={recipients}
          />
        </TaskPanel>
      ) : null}
    </section>
  );
}
