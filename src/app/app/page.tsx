import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { readOverviewSpaces } from "@/server/app-overview";
import { formatRupiah } from "@/domain/rupiah";
import { GroupCard } from "@/components/groups/group-card";
import { OrganizationAvatar } from "@/components/organizations/organization-avatar";

export const metadata = { title: "Overview" };
import { LocalDateTime } from "@/components/editorial/local-date-time";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await requireSession();
  const database = getDatabase();
  const { ledger: repository } = await getAuthenticatedLedger(session);
  const [summary, activity, needsAttention, spaces] = await Promise.all([
    repository.getLedgerOverviewSummary(),
    repository.listRecentActivity({ limit: 6 }),
    repository.listNeedsAttentionRepayments(),
    readOverviewSpaces(database, session.user.id),
  ]);
  const displayedNeedsAttention = needsAttention.items.slice(0, 3);

  return (
    <section className="app-page overview-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Overview · your Zplit</p>
            <h1>Overview</h1>
            <p className="app-page__lede">Your Zplit workspace across Personal, Groups, and Organizations.</p>
          </div>
          <div className="app-page__actions">
            <Link className="action-link action-link--primary" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</Link>
            <Link className="action-link action-link--quiet" href="/app/repayments?create=1" data-task-trigger="repayment-create">Record repayment</Link>
          </div>
        </div>
        <section aria-labelledby="personal-overview-heading">
          <div className="ledger-section__heading">
            <div>
              <p className="technical-label">PERSONAL · PRIVATE LEDGER</p>
              <h2 id="personal-overview-heading">Personal</h2>
            </div>
            <Link className="text-link overview-section__link" href="/app/personal">
              Open Personal <span aria-hidden="true">→</span>
            </Link>
          </div>
          <section className="overview-summary" aria-label="Personal ledger summary">
            <div className="overview-summary__primary">
              <span className="technical-label">Still owed to you</span>
              <strong>{formatRupiah(summary.totalOutstandingAmount)}</strong>
              <span>Open balances across your friends.</span>
            </div>
            <div className={summary.totalUnallocatedRepaymentAmount > 0 ? "overview-summary__attention" : undefined}>
              <span className="technical-label">Needs allocation</span>
              <strong>{formatRupiah(summary.totalUnallocatedRepaymentAmount)}</strong>
              <span>
                {summary.totalUnallocatedRepaymentAmount > 0
                  ? "Received money still needs an expense."
                  : "All received money is applied to shares."}
              </span>
            </div>
            <div>
              <span className="technical-label">Total spending</span>
              <strong>{formatRupiah(summary.totalExpenseAmount)}</strong>
              <span>All expenses recorded in this ledger.</span>
            </div>
          </section>

          <details className="overview-ledger-clarity">
            <summary>How are these totals calculated?</summary>
            <div className="overview-ledger-clarity__relations">
              <section aria-labelledby="spending-equation-heading">
                <h3 id="spending-equation-heading">Spending</h3>
                <p className="overview-ledger-clarity__equation">
                  Total spending = Your portion + Assigned to friends
                </p>
              </section>
              <section aria-labelledby="friend-debt-equation-heading">
                <h3 id="friend-debt-equation-heading">Friend debt</h3>
                <p className="overview-ledger-clarity__equation">
                  Assigned to friends = Applied to shares + Still owed
                </p>
              </section>
              <section aria-labelledby="repayments-equation-heading">
                <h3 id="repayments-equation-heading">Repayments</h3>
                <p className="overview-ledger-clarity__equation">
                  Received = Applied to shares + Needs allocation
                </p>
              </section>
            </div>
          </details>
        </section>

        <div className="app-page__columns">
          <section className="ledger-section" aria-labelledby="balances-heading">
            <div className="ledger-section__heading"><h2 id="balances-heading">Friend balances</h2><span className="technical-label">{summary.totalAssignedFriendCount} with assigned shares</span></div>
            {summary.friendBalances.length === 0 ? (
              <div className="ledger-empty"><h3>No balances yet.</h3><p>Balances appear after assigning friends to an expense.</p><Link className="text-link" href="/app/friends">Add a friend <span aria-hidden="true">→</span></Link></div>
            ) : <>{summary.friendBalances.map((friend) => (
              <div className="balance-row" key={friend.friendId}>
                <Link href={`/app/friends/${friend.friendId}`}><strong>{friend.name}</strong><span aria-hidden="true">→</span></Link>
                <span><span className="technical-label">Outstanding</span><strong>{formatRupiah(friend.outstandingAmount)}</strong></span>
              </div>
            ))}{summary.totalAssignedFriendCount > summary.friendBalances.length ? <Link className="text-link" href="/app/friends">View all friends <span aria-hidden="true">→</span></Link> : null}</>}
          </section>
          <section className="ledger-section" aria-labelledby="activity-heading">
            <div className="ledger-section__heading"><h2 id="activity-heading">Recent activity</h2><span className="technical-label">Latest records</span></div>
            {activity.length === 0 ? <div className="ledger-empty"><p>No expenses or repayments yet.</p></div> : activity.map((item) => (
              <Link className="activity-row" href={item.kind === "Expense" ? `/app/expenses/${item.id}` : `/app/repayments/${item.id}`} key={`${item.kind}-${item.id}`}>
                <span className="technical-label">{item.kind}</span>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <span><strong>{formatRupiah(item.amount)}</strong><LocalDateTime iso={item.date.toISOString()} mode="date" /></span>
              </Link>
            ))}
          </section>
        </div>
        {needsAttention.totalItems > 0 ? (
          <section className="ledger-section overview-attention" aria-labelledby="needs-attention-heading">
            <div className="ledger-section__heading"><h2 id="needs-attention-heading">Needs attention</h2><span className="technical-label">{needsAttention.totalItems}</span></div>
            <div className="overview-attention__list">
              {displayedNeedsAttention.map((repayment) => (
                <div className="overview-attention__row" key={repayment.id}>
                  <span className="overview-attention__friend"><strong>{repayment.friendName}</strong><small>{formatRupiah(repayment.unallocatedAmount)} needs allocation</small></span>
                  <span className="overview-attention__date"><LocalDateTime iso={repayment.paidAt.toISOString()} mode="date" /></span>
                  <Link className="text-link overview-attention__review" href={`/app/repayments/${repayment.id}#repayment-allocations`}>Review <span aria-hidden="true">→</span></Link>
                </div>
              ))}
            </div>
            {needsAttention.totalItems > displayedNeedsAttention.length ? <Link className="text-link" href="/app/repayments?allocation=needs">View all unresolved repayments <span aria-hidden="true">→</span></Link> : null}
          </section>
        ) : null}
        <section className="ledger-section overview-space-section" aria-labelledby="groups-preview-heading">
          <div className="ledger-section__heading">
            <h2 id="groups-preview-heading">Groups</h2>
            <Link className="text-link overview-section__link" href="/app/personal/groups">
              View all Groups <span aria-hidden="true">→</span>
            </Link>
          </div>
          {spaces.groups.length ? (
            <div className="group-grid">
              {spaces.groups.map((group) => (
                <GroupCard
                  balance={group}
                  group={group}
                  key={group.id}
                />
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
        <section className="ledger-section overview-space-section" aria-labelledby="organizations-preview-heading">
          <div className="ledger-section__heading">
            <h2 id="organizations-preview-heading">Organizations</h2>
            <Link className="text-link overview-section__link" href="/app/organizations">
              View all Organizations <span aria-hidden="true">→</span>
            </Link>
          </div>
          {spaces.organizations.length ? (
            <div className="organization-grid">
              {spaces.organizations.map((organization) => (
                <Link
                  className="organization-card"
                  href={`/app/organizations/${organization.id}`}
                  key={organization.id}
                >
                  <OrganizationAvatar
                    organizationId={organization.id}
                    customAvatar={organization.avatar}
                    size="md"
                    decorative
                  />
                  <span className="organization-card__details">
                    <strong>{organization.name}</strong>
                    <span>
                      {organization.role[0]?.toUpperCase()}
                      {organization.role.slice(1)} · {organization.memberCount}{" "}
                      {organization.memberCount === 1 ? "member" : "members"}
                    </span>
                    {organization.ledgerSummary ? (
                      <span className="organization-card__ledger">
                        <span>
                          <span className="technical-label">OUTSTANDING</span>
                          <strong>{formatRupiah(organization.ledgerSummary.totalOutstandingAmount)}</strong>
                        </span>
                        <span>
                          <span className="technical-label">EXPENSES</span>
                          <strong>{formatRupiah(organization.ledgerSummary.totalExpenseAmount)}</strong>
                        </span>
                        <span>
                          <span className="technical-label">REPAID</span>
                          <strong>{formatRupiah(organization.ledgerSummary.totalRepaidAmount)}</strong>
                        </span>
                      </span>
                    ) : null}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="ledger-empty">
              <h3>No organizations yet.</h3>
              <p>Create a managed space separate from Personal.</p>
              <Link
                className="text-link"
                href="/app/organizations?create=1"
                data-task-trigger="organization-create"
              >
                New organization <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
