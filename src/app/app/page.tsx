import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { zplitVNextFont } from "@/app/fonts";
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
import { AnimatedMoney } from "@/components/vnext/animated-money";
import { OpenTile } from "@/components/vnext/open-tile";
import { OverviewReveal } from "@/components/overview/overview-reveal";
import { OverviewRunway } from "@/components/overview/overview-runway";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

function OverviewMoney({ amount, label, className, signed = false, animate = true }: { amount: number; label: string; className?: string; signed?: boolean; animate?: boolean }) {
  const formatted = signed ? formatSignedRupiah(amount) : formatRupiah(amount);
  if (animate && (!signed || amount >= 0)) return <AnimatedMoney amount={amount} animate className={className} label={label} />;
  return (
    <span className={`overview-money overview-money--static${className ? ` ${className}` : ""}`} aria-label={`${label}: ${formatted}`}>
      {formatted}
    </span>
  );
}

function SignedMoney({ amount, label, className, animate = true }: { amount: number; label: string; className?: string; animate?: boolean }) {
  if (amount < 0 || !animate) return <OverviewMoney amount={amount} animate={false} className={className} label={label} signed />;
  return <AnimatedMoney amount={amount} animate className={className} label={label} />;
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
          <Link className="overview-text-link" href="/app/personal">
            Open Personal
          </Link>
        </div>
        <div className="overview-personal__body">
          <div className="overview-personal__primary">
            <span className="overview-eyebrow">Still owed to you</span>
            <h2 id="personal-overview-heading"><AnimatedMoney amount={summary.totalOutstandingAmount} animate label="Still owed to you" /></h2>
          </div>
          <div className="overview-personal__supporting">
            <div>
              <span className="overview-eyebrow">Needs matching</span>
              <OverviewMoney amount={summary.totalUnallocatedRepaymentAmount} label="Needs matching" />
              <small className="overview-personal__note">{summary.totalUnallocatedRepaymentAmount > 0 ? "Received money still needs an expense." : "All received money is applied to shares."}</small>
            </div>
            <div>
              <span className="overview-eyebrow">Total spending</span>
              <OverviewMoney amount={summary.totalExpenseAmount} label="Total spending" />
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
            <Link className="overview-text-link" href="/app/repayments?allocation=needs">
              View all
            </Link>
          ) : null}
        </div>
        <div className="overview-matching__list">
          {items.map((repayment) => (
            <Link className="overview-row overview-row--matching vnext-row" href={`/app/repayments/${repayment.id}#repayment-allocations`} key={repayment.id}>
              <span className="overview-row__main">
                <strong>{repayment.friendName}</strong>
                <small><OverviewMoney amount={repayment.unallocatedAmount} label={`${repayment.friendName} unallocated amount`} animate={false} /> needs allocation</small>
              </span>
              <span className="overview-row__meta"><SourceCalendarDate canonicalDate={repayment.paidOn} timestamp={repayment.paidAt.toISOString()} /></span>
              <span className="overview-row__action">Match <OpenTile /></span>
            </Link>
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
          <Link className="overview-text-link" href="/app/personal/budget">Open Budget</Link>
        </div>
        {snapshot.configured === false ? (
          <div className="overview-empty">
            <p>Set up a private budget period to see how your spending absorbs over time.</p>
            <Link className="overview-text-link" href="/app/personal/budget">Set up Budget</Link>
          </div>
        ) : snapshot.period === null ? (
          snapshot.paused ? (
            <div className="overview-empty overview-budget__paused">
              <p><strong>Paused</strong></p>
              <p>Last period: {snapshot.lastPeriod.name} · history preserved</p>
            </div>
          ) : (
            <div className="overview-empty">
              <p>Budgeting is configured, but no active period is available.</p>
              <Link className="overview-text-link" href="/app/personal/budget/periods">Review period history</Link>
            </div>
          )
        ) : (
          <>
            <div className="overview-budget__hero">
              <div className="overview-budget__remaining">
                <span className="overview-eyebrow">{snapshot.period.name}</span>
                <SignedMoney amount={snapshot.period.remaining} animate label="Budget remaining" />
                <span className="overview-budget__dates">{formatCalendarDate(snapshot.period.startsOn)} – {formatCalendarDate(snapshot.period.endsOn)}</span>
              </div>
              <OverviewRunway remaining={snapshot.period.remaining} totalBudget={snapshot.period.totalBudget} />
            </div>
            <div className="overview-budget__metrics">
              <div className="overview-budget__metric overview-budget__metric--net-spent">
                <span className="overview-eyebrow">Net spent</span>
                <SignedMoney amount={snapshot.period.netSpent} label="Net spent" />
              </div>
              <div className="overview-budget__metric overview-budget__metric--total-budget">
                <span className="overview-eyebrow">Budget</span>
                <OverviewMoney amount={snapshot.period.totalBudget} label="Total budget" />
              </div>
              <div className="overview-budget__metric overview-budget__metric--safe-day">
                <span className="overview-eyebrow">Safe / day</span>
                <strong className="overview-budget__value"><SafeDaily endsOn={snapshot.period.endsOn} remaining={snapshot.period.remaining} startsOn={snapshot.period.startsOn} /></strong>
              </div>
              <div className="overview-budget__metric overview-budget__metric--recurring">
                <span className="overview-eyebrow">{snapshot.recurring.dueCount} recurring</span>
                <OverviewMoney amount={snapshot.recurring.expectedAmount} label="Recurring expected amount" />
                <small>expected</small>
              </div>
            </div>
            {snapshot.recurring.dueCount > 0 ? (
              <Link className="overview-budget__history vnext-row" href="/app/personal/budget/subscriptions">
                Recurring planning <span>{snapshot.recurring.dueCount} due · {formatRupiah(snapshot.recurring.expectedAmount)} expected</span>
              </Link>
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
          <Link className="overview-text-link" href="/app/friends">Add a friend</Link>
        </div>
      ) : (
        <div className="overview-list__rows">
          {summary.friendBalances.map((friend) => (
            <Link className="overview-row overview-row--person vnext-row" href={`/app/friends/${friend.friendId}`} key={friend.friendId}>
              <span className="overview-row__main"><strong>{friend.name}</strong><small>Outstanding</small></span>
              <OverviewMoney amount={friend.outstandingAmount} label={`${friend.name} outstanding`} animate={false} />
              <OpenTile />
            </Link>
          ))}
          {summary.totalAssignedFriendCount > summary.friendBalances.length ? (
            <Link className="overview-text-link overview-list__footer-link" href="/app/friends">
              View all friends
            </Link>
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
        <Link className="overview-text-link" href="/app/personal">History</Link>
      </div>
      {activity.length === 0 ? <div className="overview-empty"><p>No expenses or repayments yet.</p></div> : (
        <div className="overview-list__rows">
          {activity.map((item) => (
            <Link className="overview-row overview-row--recent vnext-row" href={item.kind === "Expense" ? `/app/expenses/${item.id}` : `/app/repayments/${item.id}`} key={`${item.kind}-${item.id}`}>
              <span className="overview-row__type">{item.kind}</span>
              <span className="overview-row__main"><strong>{item.title}</strong><small>{item.detail}</small></span>
              <span className="overview-row__meta"><OverviewMoney amount={item.amount} label={`${item.title} amount`} animate={false} /><LocalDateTime iso={item.date.toISOString()} mode="date" /></span>
              <OpenTile />
            </Link>
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
            <Link className="overview-text-link" href="/app/personal/groups">View all</Link>
          </div>
          {groups.length === 0 ? (
            <div className="overview-empty">
              <h3>No groups yet.</h3>
              <p>Create a peer-to-peer space for shared expenses.</p>
              <Link className="overview-text-link" href="/app/personal?create=1">Create a group</Link>
            </div>
          ) : (
            <div className="overview-workspaces__rows">
              {groups.map((group) => (
                <Link className="overview-workspace-row vnext-row" href={`/app/personal/groups/${group.id}`} key={group.id}>
                  <span className="overview-workspace-row__avatar"><GroupAvatar groupId={group.id} customAvatar={group.avatar} size="md" decorative /></span>
                  <span className="overview-workspace-row__identity"><strong>{group.name}</strong><small>{roleLabel(group.role)} · {group.participantCount} {group.participantCount === 1 ? "participant" : "participants"}</small></span>
                  <span className="overview-workspace-row__finance">
                    {group.youOwe > 0 ? <span><small>You owe</small><OverviewMoney amount={group.youOwe} label={`${group.name} you owe`} animate={false} /></span> : null}
                    {group.owedToYou > 0 ? <span><small>Owed to you</small><OverviewMoney amount={group.owedToYou} label={`${group.name} owed to you`} animate={false} /></span> : null}
                    {group.youOwe === 0 && group.owedToYou === 0 ? <span>Settled</span> : null}
                  </span>
                  <OpenTile />
                </Link>
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
            <Link className="overview-text-link" href="/app/organizations">View all</Link>
          </div>
          {organizations.length === 0 ? (
            <div className="overview-empty">
              <h3>No organizations yet.</h3>
              <p>Create a managed space separate from Personal.</p>
              <Link className="overview-text-link" href="/app/organizations?create=1">New organization</Link>
            </div>
          ) : (
            <div className="overview-workspaces__rows">
              {organizations.map((organization) => (
                <Link className="overview-workspace-row vnext-row" href={`/app/organizations/${organization.id}`} key={organization.id}>
                  <span className="overview-workspace-row__avatar"><OrganizationAvatar organizationId={organization.id} customAvatar={organization.avatar} size="md" decorative /></span>
                  <span className="overview-workspace-row__identity"><strong>{organization.name}</strong><small>{roleLabel(organization.role)} · {organization.memberCount} {organization.memberCount === 1 ? "member" : "members"}</small></span>
                  {organization.ledgerSummary ? (
                    <span className="overview-workspace-row__finance">
                      {organization.ledgerSummary.totalOutstandingAmount > 0 ? (
                        <span>
                          <small>Outstanding</small>
                          <OverviewMoney amount={organization.ledgerSummary.totalOutstandingAmount} label={`${organization.name} outstanding`} animate={false} />
                        </span>
                      ) : <span>Settled</span>}
                    </span>
                  ) : null}
                  <OpenTile />
                </Link>
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
    <section className={`app-page zplit-vnext overview-page ${zplitVNextFont.variable}`} id="top">
      <div className="overview-page__layout">
        <header className="overview-header">
          <h1>Overview</h1>
          <div className="overview-header__actions">
            <Link className="overview-action overview-action--primary vnext-button vnext-button--primary" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</Link>
            <Link className="overview-action overview-action--secondary vnext-button vnext-button--secondary" href="/app/repayments?create=1" data-task-trigger="repayment-create">Record repayment</Link>
          </div>
        </header>
        <section className="overview-signal-zone" aria-label="Personal financial signals">
          <PersonalHero summary={summary} />
          <MatchingSection items={displayedNeedsAttention} totalItems={needsAttention.totalItems} />
        </section>
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
