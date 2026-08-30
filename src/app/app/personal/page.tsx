import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { GroupCard } from "@/components/groups/group-card";
import { listGroups } from "@/server/groups";
import { formatRupiah } from "@/domain/rupiah";
import { PersonalLedgerSnapshot } from "@/components/ledger/personal-ledger-snapshot";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { createGroupAction } from "./groups/actions";
import { GroupForm } from "@/components/groups/group-form";
import { TaskPanel } from "@/components/app/task-panel";

export const metadata = { title: "Personal" };
export const dynamic = "force-dynamic";

const destinations = [
  ["Friends", "/app/friends", "People you split with"],
  ["Outings", "/app/outings", "Trips and shared occasions"],
  ["Expenses", "/app/expenses", "Your recorded spending"],
  ["Repayments", "/app/repayments", "Money received and allocated"],
] as const;

export default async function PersonalPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ create?: string | string[] }> } = {}) {
  const session = await requireSession();
  const database = getDatabase();
  const { ledger: repository } = await getAuthenticatedLedger(session);
  const [groups, summary, activity] = await Promise.all([
    listGroups(database, session.user.id),
    repository.getLedgerOverviewSummary(),
    repository.listRecentActivity({ limit: 5 }),
  ]);
  const friendBalances = summary.friendBalances
    .filter((friend) => friend.outstandingAmount > 0)
    .slice(0, 5);
  const create = await searchParams;
  const openCreate = (Array.isArray(create.create) ? create.create[0] : create.create) === "1";
  return (
    <section className="app-page personal-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Personal · private ledger</p>
            <h1>Personal</h1>
            <p className="app-page__lede">Your private financial world, kept separate from future shared spaces.</p>
          </div>
          <Link className="action-link action-link--primary" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</Link>
        </header>
        <section className="personal-snapshot-section" aria-labelledby="personal-snapshot-heading">
          <div className="ledger-section__heading">
            <div>
              <p className="technical-label">PERSONAL SNAPSHOT</p>
              <h2 id="personal-snapshot-heading">Personal snapshot</h2>
            </div>
          </div>
          <PersonalLedgerSnapshot summary={summary} />
        </section>
        <div className="app-page__columns personal-page__columns">
          <section className="ledger-section" aria-labelledby="personal-balances-heading">
            <div className="ledger-section__heading">
              <h2 id="personal-balances-heading">Friend balances</h2>
              <span className="technical-label">Top balances</span>
            </div>
            {friendBalances.length === 0 ? (
              <div className="ledger-empty">
                <p>All settled up.</p>
                <Link className="text-link" href="/app/friends">
                  View friends <span aria-hidden="true">→</span>
                </Link>
              </div>
            ) : (
              <>
                {friendBalances.map((friend) => (
                  <div className="balance-row" key={friend.friendId}>
                    <Link href={`/app/friends/${friend.friendId}`}>
                      <strong>{friend.name}</strong>
                      <span aria-hidden="true">→</span>
                    </Link>
                    <span>
                      <span className="technical-label">Outstanding</span>
                      <strong>{formatRupiah(friend.outstandingAmount)}</strong>
                    </span>
                  </div>
                ))}
                {summary.totalAssignedFriendCount > friendBalances.length ? (
                  <Link className="text-link" href="/app/friends">
                    View all friends <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
              </>
            )}
          </section>
          <section className="ledger-section" aria-labelledby="personal-activity-heading">
            <div className="ledger-section__heading">
              <h2 id="personal-activity-heading">Recent activity</h2>
              <span className="technical-label">Latest records</span>
            </div>
            {activity.length === 0 ? (
              <div className="ledger-empty">
                <p>No expenses or repayments yet.</p>
              </div>
            ) : (
              activity.map((item) => (
                <Link
                  className="activity-row"
                  href={item.kind === "Expense" ? `/app/expenses/${item.id}` : `/app/repayments/${item.id}`}
                  key={`${item.kind}-${item.id}`}
                >
                  <span className="technical-label">{item.kind}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <span>
                    <strong>{formatRupiah(item.amount)}</strong>
                    <LocalDateTime iso={item.date.toISOString()} mode="date" />
                  </span>
                </Link>
              ))
            )}
          </section>
        </div>
        <section className="ledger-section personal-destinations" aria-labelledby="personal-workspace-heading">
          <div className="ledger-section__heading">
            <h2 id="personal-workspace-heading">Your workspace</h2>
            <span className="technical-label">Personal tools</span>
          </div>
          <div className="personal-destinations__grid">
            {destinations.map(([label, href, description]) => (
              <Link className="personal-destination" href={href} key={href}>
                <strong>{label}</strong>
                <span>{description}</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="ledger-section group-section" aria-labelledby="personal-groups-heading">
          <div className="ledger-section__heading">
            <h2 id="personal-groups-heading">Groups</h2>
            <Link className="text-link overview-section__link" href="/app/personal/groups">
              View all Groups <span aria-hidden="true">→</span>
            </Link>
          </div>
          {groups.length ? (
            <div className="group-grid">
              {groups.map((group) => (
                <GroupCard group={group} key={group.id} />
              ))}
            </div>
          ) : (
            <div className="ledger-empty">
              <h3>No groups yet.</h3>
              <p>Create a peer-to-peer space for shared expenses.</p>
              <Link className="text-link" href="/app/personal?create=1">
                Create a group <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </section>
      </div>
      {openCreate ? (
        <TaskPanel
          open
          title="New group"
          description="Create a peer-to-peer shared-expense space. You become its Owner."
          triggerId="group-create"
        >
          <GroupForm action={createGroupAction} />
        </TaskPanel>
      ) : null}
    </section>
  );
}
