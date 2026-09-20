import { Sora } from "next/font/google";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import type { BudgetOverviewSnapshot } from "@/domain/budgeting/types";
import { formatRupiah } from "@/domain/rupiah";
import type { LedgerOverviewSummary } from "@/domain/ledger/types";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { readOverviewSpaces } from "@/server/app-overview";
import { getBudgetOverviewSnapshot } from "@/server/budgeting/reporting";
import { GroupAvatar } from "@/components/groups/group-avatar";
import { OrganizationAvatar } from "@/components/organizations/organization-avatar";
import { SafeDaily } from "@/components/budgeting/safe-daily";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { LocalDateTime, SourceCalendarDate } from "@/components/editorial/local-date-time";
import { AnimatedMoney } from "@/components/overview/animated-money";
import { OverviewLink } from "@/components/overview/overview-link";
import { OverviewReveal } from "@/components/overview/overview-reveal";
import { OverviewRunway } from "@/components/overview/overview-runway";

const sora = Sora({
  subsets: ["latin"],
  weight: ["500", "600", "800"],
  display: "swap",
});

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

function OpenTile() {
  return (
    <span className="overview-open-tile" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" focusable="false">
        <path d="M5 19 19 5m0 0H9m10 0v10" />
      </svg>
    </span>
  );
}

function SignedMoney({ amount, label, className }: { amount: number; label: string; className?: string }) {
  return amount < 0 ? (
    <span className={`overview-money overview-money--static${className ? ` ${className}` : ""}`} aria-label={`${label}: ${formatSignedRupiah(amount)}`}>
      {formatSignedRupiah(amount)}
    </span>
  ) : <AnimatedMoney amount={amount} className={className} label={label} />;
}

function roleLabel(role: string) {
  return role[0]?.toUpperCase() + role.slice(1);
}

function PersonalHero({ summary }: { summary: LedgerOverviewSummary }) {
  return (
    <OverviewReveal className="overview-stage overview-stage--personal" family="expand">
      <section className="overview-personal overview-module" aria-labelledby="personal-overview-heading">
        <div className="overview-module__heading">
          <p className="technical-label">Personal</p>
          <OverviewLink className="overview-text-link" href="/app/personal">
            Open Personal <OpenTile />
          </OverviewLink>
        </div>
        <div className="overview-personal__body">
          <div className="overview-personal__primary">
            <span className="overview-eyebrow">Still owed to you</span>
            <h2 id="personal-overview-heading"><AnimatedMoney amount={summary.totalOutstandingAmount} label="Still owed to you" /></h2>
          </div>
          <div className="overview-personal__supporting">
            <div>
              <span className="overview-eyebrow">Needs matching</span>
              <AnimatedMoney amount={summary.totalUnallocatedRepaymentAmount} label="Needs matching" />
              <small className="overview-personal__note">{summary.totalUnallocatedRepaymentAmount > 0 ? "Received money still needs an expense." : "All received money is applied to shares."}</small>
            </div>
            <div>
              <span className="overview-eyebrow">Total spending</span>
              <AnimatedMoney amount={summary.totalExpenseAmount} label="Total spending" />
            </div>
          </div>
        </div>
        <details className="overview-accounting">
          <summary>How are these totals calculated?</summary>
          <div className="overview-accounting__relations">
            <p><strong>Spending</strong><span>Total spending = Your portion + Assigned to friends</span></p>
            <p><strong>Friend debt</strong><span>Assigned to friends = Applied to shares + Still owed</span></p>
            <p><strong>Repayments</strong><span>Received = Applied to shares + Needs allocation</span></p>
          </div>
        </details>
      </section>
    </OverviewReveal>
  );
}

function MatchingSection({ items, totalItems }: { items: Array<{ id: string; friendName: string; unallocatedAmount: number; paidAt: Date; paidOn: string | null }>; totalItems: number }) {
  if (totalItems === 0) return null;
  return (
    <OverviewReveal className="overview-stage overview-stage--matching" delay={80} family="resolve">
      <section className="overview-matching overview-module" aria-labelledby="needs-matching-heading">
        <div className="overview-module__heading">
          <div>
            <p className="technical-label">Personal</p>
            <h2 id="needs-matching-heading">Needs matching <span>{totalItems}</span></h2>
          </div>
          {totalItems > items.length ? (
            <OverviewLink className="overview-text-link" href="/app/repayments?allocation=needs">
              View all <OpenTile />
            </OverviewLink>
          ) : null}
        </div>
        <div className="overview-matching__list">
          {items.map((repayment) => (
            <OverviewLink className="overview-row overview-row--matching" href={`/app/repayments/${repayment.id}#repayment-allocations`} key={repayment.id}>
              <span className="overview-row__main">
                <strong>{repayment.friendName}</strong>
                <small><AnimatedMoney amount={repayment.unallocatedAmount} label={`${repayment.friendName} unallocated amount`} /> needs allocation</small>
              </span>
              <span className="overview-row__meta"><SourceCalendarDate canonicalDate={repayment.paidOn} timestamp={repayment.paidAt.toISOString()} /></span>
              <span className="overview-row__action">Match <OpenTile /></span>
            </OverviewLink>
          ))}
        </div>
      </section>
    </OverviewReveal>
  );
}

function BudgetSection({ snapshot }: { snapshot: BudgetOverviewSnapshot }) {
  return (
    <OverviewReveal className="overview-stage overview-stage--budget" delay={120} family="slide-right">
      <section className="overview-budget overview-module" aria-labelledby="budget-overview-heading">
        <div className="overview-module__heading">
          <div>
            <p className="technical-label">Budget</p>
            <h2 id="budget-overview-heading">Budget</h2>
          </div>
          <OverviewLink className="overview-text-link" href="/app/personal/budget">Open Budget <OpenTile /></OverviewLink>
        </div>
        {snapshot.configured === false ? (
          <div className="overview-empty">
            <p>Set up a private budget period to see how your spending absorbs over time.</p>
            <OverviewLink className="overview-text-link" href="/app/personal/budget">Set up Budget <OpenTile /></OverviewLink>
          </div>
        ) : snapshot.period === null ? (
          <div className="overview-empty">
            <p>Budgeting is configured, but its active period needs attention.</p>
            <OverviewLink className="overview-text-link" href="/app/personal/budget/periods">Review period history <OpenTile /></OverviewLink>
          </div>
        ) : (
          <>
            <div className="overview-budget__hero">
              <div className="overview-budget__remaining">
                <span className="overview-eyebrow">{snapshot.period.name}</span>
                <SignedMoney amount={snapshot.period.remaining} label="Budget remaining" />
                <span className="overview-budget__dates">{formatCalendarDate(snapshot.period.startsOn)} – {formatCalendarDate(snapshot.period.endsOn)}</span>
              </div>
              <OverviewRunway remaining={snapshot.period.remaining} totalBudget={snapshot.period.totalBudget} />
            </div>
            <div className="overview-budget__metrics">
              <div>
                <span className="overview-eyebrow">Net spent</span>
                <SignedMoney amount={snapshot.period.netSpent} label="Net spent" />
              </div>
              <div>
                <span className="overview-eyebrow">Budget</span>
                <AnimatedMoney amount={snapshot.period.totalBudget} label="Total budget" />
              </div>
              <div>
                <span className="overview-eyebrow">Safe / day</span>
                <strong className="overview-budget__value"><SafeDaily endsOn={snapshot.period.endsOn} remaining={snapshot.period.remaining} startsOn={snapshot.period.startsOn} /></strong>
              </div>
              <div>
                <span className="overview-eyebrow">{snapshot.recurring.dueCount} recurring</span>
                <AnimatedMoney amount={snapshot.recurring.expectedAmount} label="Recurring expected amount" />
                <small>expected</small>
              </div>
            </div>
            {snapshot.recurring.dueCount > 0 ? (
              <OverviewLink className="overview-budget__history" href="/app/personal/budget/subscriptions">
                Recurring planning <span>{snapshot.recurring.dueCount} due · {formatRupiah(snapshot.recurring.expectedAmount)} expected</span> <OpenTile />
              </OverviewLink>
            ) : null}
          </>
        )}
      </section>
    </OverviewReveal>
  );
}

function PeopleSection({ summary }: { summary: LedgerOverviewSummary }) {
  return (
    <section className="overview-list overview-module" aria-labelledby="people-heading">
      <div className="overview-module__heading">
        <div>
          <p className="technical-label">Personal</p>
          <h2 id="people-heading">People</h2>
        </div>
        <span className="overview-count">{summary.totalAssignedFriendCount} with assigned shares</span>
      </div>
      {summary.friendBalances.length === 0 ? (
        <div className="overview-empty">
          <h3>No balances yet.</h3>
          <p>Balances appear after assigning friends to an expense.</p>
          <OverviewLink className="overview-text-link" href="/app/friends">Add a friend <OpenTile /></OverviewLink>
        </div>
      ) : (
        <div className="overview-list__rows">
          {summary.friendBalances.map((friend) => (
            <OverviewLink className="overview-row overview-row--person" href={`/app/friends/${friend.friendId}`} key={friend.friendId}>
              <span className="overview-row__main"><strong>{friend.name}</strong><small>Outstanding</small></span>
              <AnimatedMoney amount={friend.outstandingAmount} label={`${friend.name} outstanding`} />
              <OpenTile />
            </OverviewLink>
          ))}
          {summary.totalAssignedFriendCount > summary.friendBalances.length ? (
            <OverviewLink className="overview-text-link overview-list__footer-link" href="/app/friends">
              View all friends <OpenTile />
            </OverviewLink>
          ) : null}
        </div>
      )}
    </section>
  );
}

function RecentSection({ activity }: { activity: Array<{ kind: "Expense" | "Repayment"; id: string; title: string; detail: string; amount: number; date: Date }> }) {
  return (
    <section className="overview-list overview-list--recent overview-module" aria-labelledby="recent-heading">
      <div className="overview-module__heading">
        <div>
          <p className="technical-label">Personal</p>
          <h2 id="recent-heading">Recent</h2>
        </div>
        <OverviewLink className="overview-text-link" href="/app/personal">History <OpenTile /></OverviewLink>
      </div>
      {activity.length === 0 ? <div className="overview-empty"><p>No expenses or repayments yet.</p></div> : (
        <div className="overview-list__rows">
          {activity.map((item) => (
            <OverviewLink className="overview-row overview-row--recent" href={item.kind === "Expense" ? `/app/expenses/${item.id}` : `/app/repayments/${item.id}`} key={`${item.kind}-${item.id}`}>
              <span className="overview-row__type">{item.kind}</span>
              <span className="overview-row__main"><strong>{item.title}</strong><small>{item.detail}</small></span>
              <span className="overview-row__meta"><AnimatedMoney amount={item.amount} label={`${item.title} amount`} /><LocalDateTime iso={item.date.toISOString()} mode="date" /></span>
              <OpenTile />
            </OverviewLink>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkspaceRows({ groups, organizations }: { groups: Awaited<ReturnType<typeof readOverviewSpaces>>["groups"]; organizations: Awaited<ReturnType<typeof readOverviewSpaces>>["organizations"] }) {
  return (
    <OverviewReveal className="overview-stage overview-stage--workspaces" delay={260} family="resolve">
      <div className="overview-workspace-pair">
        <section className="overview-workspaces overview-module" aria-labelledby="groups-heading">
          <div className="overview-module__heading">
            <div>
              <p className="technical-label">Shared spaces</p>
              <h2 id="groups-heading">Groups</h2>
            </div>
            <OverviewLink className="overview-text-link" href="/app/personal/groups">View all <OpenTile /></OverviewLink>
          </div>
          {groups.length === 0 ? (
            <div className="overview-empty">
              <h3>No groups yet.</h3>
              <p>Create a peer-to-peer space for shared expenses.</p>
              <OverviewLink className="overview-text-link" href="/app/personal?create=1">Create a group <OpenTile /></OverviewLink>
            </div>
          ) : (
            <div className="overview-workspaces__rows">
              {groups.map((group) => (
                <OverviewLink className="overview-workspace-row" href={`/app/personal/groups/${group.id}`} key={group.id}>
                  <GroupAvatar groupId={group.id} customAvatar={group.avatar} size="md" decorative />
                  <span className="overview-workspace-row__identity"><strong>{group.name}</strong><small>{roleLabel(group.role)} · {group.participantCount} {group.participantCount === 1 ? "participant" : "participants"}</small></span>
                  <span className="overview-workspace-row__finance">
                    {group.youOwe > 0 ? <span><small>You owe</small><AnimatedMoney amount={group.youOwe} label={`${group.name} you owe`} /></span> : null}
                    {group.owedToYou > 0 ? <span><small>Owed to you</small><AnimatedMoney amount={group.owedToYou} label={`${group.name} owed to you`} /></span> : null}
                    {group.youOwe === 0 && group.owedToYou === 0 ? <span>Settled</span> : null}
                  </span>
                  <OpenTile />
                </OverviewLink>
              ))}
            </div>
          )}
        </section>
        <section className="overview-workspaces overview-module" aria-labelledby="organizations-heading">
          <div className="overview-module__heading">
            <div>
              <p className="technical-label">Managed spaces</p>
              <h2 id="organizations-heading">Organizations</h2>
            </div>
            <OverviewLink className="overview-text-link" href="/app/organizations">View all <OpenTile /></OverviewLink>
          </div>
          {organizations.length === 0 ? (
            <div className="overview-empty">
              <h3>No organizations yet.</h3>
              <p>Create a managed space separate from Personal.</p>
              <OverviewLink className="overview-text-link" href="/app/organizations?create=1">New organization <OpenTile /></OverviewLink>
            </div>
          ) : (
            <div className="overview-workspaces__rows">
              {organizations.map((organization) => (
                <OverviewLink className="overview-workspace-row" href={`/app/organizations/${organization.id}`} key={organization.id}>
                  <OrganizationAvatar organizationId={organization.id} customAvatar={organization.avatar} size="md" decorative />
                  <span className="overview-workspace-row__identity"><strong>{organization.name}</strong><small>{roleLabel(organization.role)} · {organization.memberCount} {organization.memberCount === 1 ? "member" : "members"}</small></span>
                  {organization.ledgerSummary ? (
                    <span className="overview-workspace-row__finance">
                      {organization.ledgerSummary.totalOutstandingAmount > 0 ? (
                        <span>
                          <small>Outstanding</small>
                          <AnimatedMoney amount={organization.ledgerSummary.totalOutstandingAmount} label={`${organization.name} outstanding`} />
                        </span>
                      ) : <span>Settled</span>}
                    </span>
                  ) : null}
                  <OpenTile />
                </OverviewLink>
              ))}
            </div>
          )}
        </section>
      </div>
    </OverviewReveal>
  );
}

export default async function AppPage() {
  const session = await requireSession();
  const database = getDatabase();
  const { ledger: repository } = await getAuthenticatedLedger(session);
  const [summary, activity, needsAttention, spaces, budget] = await Promise.all([
    repository.getLedgerOverviewSummary(),
    repository.listRecentActivity({ limit: 6 }),
    repository.listNeedsAttentionRepayments(),
    readOverviewSpaces(database, session.user.id),
    getBudgetOverviewSnapshot(database, session.user.id),
  ]);
  const displayedNeedsAttention = needsAttention.items.slice(0, 3);

  return (
    <section className={`app-page overview-page ${sora.className}`} id="top" style={sora.style}>
      <div className="overview-page__layout">
        <header className="overview-header">
          <h1>Overview</h1>
          <div className="overview-header__actions">
            <OverviewLink className="overview-action overview-action--primary" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</OverviewLink>
            <OverviewLink className="overview-action overview-action--secondary" href="/app/repayments?create=1" data-task-trigger="repayment-create">Record repayment</OverviewLink>
          </div>
        </header>
        <PersonalHero summary={summary} />
        <MatchingSection items={displayedNeedsAttention} totalItems={needsAttention.totalItems} />
        <BudgetSection snapshot={budget} />
        <OverviewReveal className="overview-stage overview-stage--lists" delay={200} family="slide-left">
          <div className="overview-list-pair">
            <PeopleSection summary={summary} />
            <RecentSection activity={activity} />
          </div>
        </OverviewReveal>
        <WorkspaceRows groups={spaces.groups} organizations={spaces.organizations} />
      </div>
    </section>
  );
}
