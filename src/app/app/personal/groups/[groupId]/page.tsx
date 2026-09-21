import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { zplitVNextFont } from "@/app/fonts";
import { formatRupiah } from "@/domain/rupiah";
import { AnimatedMoney } from "@/components/vnext/animated-money";
import { GroupExpenseRow } from "@/components/groups/group-expense-row";
import { GroupSettlementRow } from "@/components/groups/group-settlement-row";
import { getGroupForMember, listGroupParticipants } from "@/server/groups";
import { createGroupAccountingRepository, getGroupBalances } from "@/server/group-accounting";
import { createGroupSettlementRepository } from "@/server/group-settlements";
import { listGroupJoinRequests } from "@/server/group-join-requests";

export const dynamic = "force-dynamic";

function roleLabel(role: string) {
  return role[0]?.toUpperCase() + role.slice(1);
}

function participantState(participant: { isExternal: boolean; isFormer: boolean; role: string | null }) {
  if (participant.isExternal) return "External participant";
  if (participant.isFormer) return "Former member";
  return `${roleLabel(participant.role ?? "member")} · Zplit member`;
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const session = await requireSession();
  const { groupId } = await params;
  const database = getDatabase();
  let group;
  try {
    group = await getGroupForMember(database, groupId, session.user.id);
  } catch {
    notFound();
  }

  const [participants, balances, expensePage, settlementPage] = await Promise.all([
    listGroupParticipants(database, groupId, session.user.id),
    getGroupBalances(database, groupId, session.user.id),
    createGroupAccountingRepository(database, groupId).listExpenses(session.user.id, 1),
    createGroupSettlementRepository(database, groupId).listSettlements(session.user.id, 1),
  ]);
  const requests = group.canManageParticipants && group.archivedAt === null
    ? await listGroupJoinRequests(database, groupId, session.user.id)
    : { invitations: [], links: [] };
  const viewerParticipant = participants.find((participant) => participant.userId === session.user.id);
  const youOwe = balances
    .filter((balance) => balance.debtorParticipantId === viewerParticipant?.id)
    .reduce((total, balance) => total + balance.amount, 0);
  const owedToYou = balances
    .filter((balance) => balance.creditorParticipantId === viewerParticipant?.id)
    .reduce((total, balance) => total + balance.amount, 0);
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const directBalances = balances.filter(
    (balance) => balance.debtorParticipantId === viewerParticipant?.id || balance.creditorParticipantId === viewerParticipant?.id,
  );

  return (
    <section className={`app-page page-content zplit-vnext groups-vnext group-detail-page ${zplitVNextFont.variable}`} id="top">
      <div className="editorial-shell app-page__layout groups-vnext__layout">
        <header className="group-workspace__header">
          <div className="group-workspace__identity">
            <p className="technical-label">GROUP WORKSPACE</p>
            <h1>{group.name}</h1>
            <p>{group.participantCount} participants · {roleLabel(group.role)}</p>
          </div>
          <div className="app-page__actions">
            {group.archivedAt === null ? (
              <>
                <Link className="action-link action-link--primary vnext-button vnext-button--primary" href={`/app/personal/groups/${groupId}/expenses?create=1`} data-task-trigger="group-expense-create">
                  Add expense
                </Link>
                <Link className="action-link action-link--quiet vnext-button vnext-button--secondary" href={`/app/personal/groups/${groupId}/settlements?create=1`} data-task-trigger="group-settlement-create">
                  Record payment
                </Link>
              </>
            ) : null}
            {group.canManageGroup ? (
              <Link className="action-link action-link--quiet vnext-button vnext-button--secondary" href={`/app/personal/groups/${groupId}/settings`}>
                Edit
              </Link>
            ) : null}
          </div>
        </header>

        {group.archivedAt !== null ? (
          <section className="group-detail__section groups-vnext__notice" aria-label="Archived status">
            <strong>Archived</strong>
            <p>This Group’s history is preserved, but new activity is limited.</p>
          </section>
        ) : null}

        <section className="group-financial-summary" aria-label="Your Group position">
          <div className="group-financial-summary__value group-financial-summary__value--debt">
            <span className="technical-label">YOU OWE</span>
            <strong><AnimatedMoney amount={youOwe} label="You owe" tone={youOwe > 0 ? "debt" : "settled"} /></strong>
            <span>Current bilateral balances</span>
          </div>
          <div className="group-financial-summary__value group-financial-summary__value--credit">
            <span className="technical-label">OWED TO YOU</span>
            <strong><AnimatedMoney amount={owedToYou} label="Owed to you" tone={owedToYou > 0 ? "primary" : "settled"} /></strong>
            <span>Current bilateral balances</span>
          </div>
          <div className="group-financial-summary__fact">
            <span className="technical-label">PEOPLE</span>
            <strong>{group.participantCount}</strong>
            <span>{group.memberCount} registered · {group.externalParticipantCount} external</span>
          </div>
        </section>

        <div className="group-workspace">
          <main className="group-workspace__main">
            <section className="group-workspace__section" aria-labelledby="group-recent-expenses-heading">
              <div className="group-workspace__section-heading">
                <div>
                  <p className="technical-label">LEDGER</p>
                  <h2 id="group-recent-expenses-heading">Recent expenses</h2>
                </div>
                <Link className="text-link vnext-link" href={`/app/personal/groups/${groupId}/expenses`}>View all</Link>
              </div>
              {expensePage.items.length ? (
                <div className="group-workspace__rows">
                  {expensePage.items.slice(0, 8).map((expense) => (
                    <GroupExpenseRow key={expense.id} expense={expense} viewerUserId={session.user.id} basePath={`/app/personal/groups/${groupId}/expenses`} />
                  ))}
                </div>
              ) : (
                <div className="groups-vnext__empty">
                  <strong>No expenses yet.</strong>
                  <p>Record the first shared expense inside this Group.</p>
                  {group.archivedAt === null ? <Link className="text-link vnext-link" href={`/app/personal/groups/${groupId}/expenses?create=1`}>Add expense</Link> : null}
                </div>
              )}
            </section>

            <section className="group-workspace__section" aria-labelledby="group-recent-payments-heading">
              <div className="group-workspace__section-heading">
                <div>
                  <p className="technical-label">SETTLEMENTS</p>
                  <h2 id="group-recent-payments-heading">Recent payments</h2>
                </div>
                <Link className="text-link vnext-link" href={`/app/personal/groups/${groupId}/settlements`}>View payments</Link>
              </div>
              {settlementPage.items.length ? (
                <div className="group-workspace__rows">
                  {settlementPage.items.slice(0, 6).map((settlement) => (
                    <GroupSettlementRow key={settlement.id} settlement={settlement} viewerUserId={session.user.id} basePath={`/app/personal/groups/${groupId}/settlements`} />
                  ))}
                </div>
              ) : (
                <div className="groups-vnext__empty">
                  <strong>No payments yet.</strong>
                  <p>Confirmed payments reduce the current bilateral balance.</p>
                  {group.archivedAt === null ? <Link className="text-link vnext-link" href={`/app/personal/groups/${groupId}/settlements?create=1`}>Record payment</Link> : null}
                </div>
              )}
            </section>
          </main>

          <aside className="group-workspace__rail">
            <section className="group-workspace__rail-section" aria-labelledby="group-balance-heading">
              <div className="group-workspace__section-heading">
                <div>
                  <p className="technical-label">CONTEXT</p>
                  <h2 id="group-balance-heading">Your balances</h2>
                </div>
                <Link className="text-link vnext-link" href={`/app/personal/groups/${groupId}/settlements`}>Payments</Link>
              </div>
              {directBalances.length ? (
                <ul className="group-balance-list">
                  {directBalances.map((balance) => {
                    const debtor = participantById.get(balance.debtorParticipantId);
                    const creditor = participantById.get(balance.creditorParticipantId);
                    const viewerIsDebtor = balance.debtorParticipantId === viewerParticipant?.id;
                    const other = viewerIsDebtor ? creditor : debtor;
                    return (
                      <li key={`${balance.debtorParticipantId}-${balance.creditorParticipantId}`}>
                        <span>{viewerIsDebtor ? "You owe" : "Owed to you"}</span>
                        <strong>{other?.displayName ?? "Participant"}</strong>
                        <b>{formatRupiah(balance.amount)}</b>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="groups-vnext__empty-copy">No current bilateral balances.</p>
              )}
            </section>

            <section className="group-workspace__rail-section" aria-labelledby="group-people-heading">
              <div className="group-workspace__section-heading">
                <div>
                  <p className="technical-label">PARTICIPANTS</p>
                  <h2 id="group-people-heading">People</h2>
                </div>
                <Link className="text-link vnext-link" href={`/app/personal/groups/${groupId}/people`}>Manage</Link>
              </div>
              <ul className="group-participant-list">
                {participants.slice(0, 8).map((participant) => (
                  <li key={participant.id}>
                    <strong>{participant.displayName}</strong>
                    <span>{participantState(participant)}</span>
                  </li>
                ))}
              </ul>
              {participants.length > 8 ? <Link className="text-link vnext-link" href={`/app/personal/groups/${groupId}/people`}>View all {participants.length} people</Link> : null}
              {requests.invitations.length || requests.links.length ? <p className="groups-vnext__empty-copy">{requests.invitations.length + requests.links.length} participant requests need attention.</p> : null}
            </section>

            <section className="group-workspace__rail-section group-workspace__rail-section--meaning" aria-labelledby="group-meaning-heading">
              <p className="technical-label">ACCOUNTING</p>
              <h2 id="group-meaning-heading">Peer-to-peer by design</h2>
              <p>Expenses preserve participant obligations. Payments move money only after recipient confirmation. Offsets cancel reciprocal obligations without creating cash movement.</p>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
