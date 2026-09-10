# Personal budgeting architecture

## Authority split

Zplit financial domains answer: **what happened, and between whom?** The
budgeting domain answers: **how should this user's budget absorb that event?**
Neither domain derives the other's canonical financial truth.

```text
real source event
      ↓
BudgetTransaction (actual money event)
      ↓
0..N BudgetImpacts (period/category absorption)
```

In B1, manual BudgetTransactions are their own real source events. Future
Personal and Group integrations use typed link tables with real foreign keys;
budgeting does not add generic `source_type` or `source_id` columns. Group
offsets will never become BudgetTransactions because no money moved.

## Ownership and model

Budgeting is private and owned directly by canonical `owner_user_id`. It is a
Personal destination, not a ledger scope, Organization, Group, or Friend
resource. Every read and mutation is scoped to the authenticated user. A
BudgetProfile is an explicit opt-in boundary; existing users are not backfilled
and users without one are unaffected.

The B1 tables are:

- `BudgetProfile`: one user-owned lifecycle and preference boundary.
- `BudgetPeriod`: an ordinal date-only period; B1 creates one active ordinal-1
  period.
- `BudgetCategory`: stable owner-scoped identity, including the permanent
  `Uncategorized` system category.
- `BudgetPeriodCategory`: the period plan and its non-negative allocation.
- `BudgetTransaction`: a positive amount plus `outflow` or `inflow` direction.
- `BudgetImpact`: the amount absorbed by a category and period.

Amounts are positive integer Rupiah values. Direction carries meaning; no signed
money is stored. B1 is IDR-only and uses no currency or floating-point fields.

An `applied` impact has a period ID. A `pending` impact has no period ID and
retains its target period ordinal for future transitions. B1 creates exactly
one applied impact for each manual transaction and never creates pending
impacts. Multiple impacts per transaction remain valid for future spread.

Dashboard and category reporting are authoritative from applied impacts whose
parent transaction is posted:

```text
outflowApplied = sum(outflow impacts)
inflowApplied  = sum(inflow impacts)
netSpent       = outflowApplied - inflowApplied
remaining      = period.totalBudget - netSpent
```

The plan summary is separate:

```text
totalAllocated   = sum(period category allocations)
unallocatedBudget = period.totalBudget - totalAllocated
```

Neither remaining amount is clamped. Negative category and period values are
valid and are displayed as signed Rupiah.

## Dates and categories

Budget periods and manual transaction dates are PostgreSQL `DATE` values and
canonical `YYYY-MM-DD` strings. They are validated as real Gregorian dates and
are never converted through timestamps or browser timezone offsets. The
`Uncategorized` category is created during setup, has normalized name
`uncategorized` and system key `uncategorized`, and cannot be renamed,
archived, or deleted. Custom names collapse internal whitespace for display and
lowercase the normalized comparison value.

Safe-daily is a pure calculation. It uses the browser-local calendar date,
counts the effective start through the period end inclusively, floors integer
division, returns `null` after the period ends, and preserves negative values.

## Concurrency and privacy

After a profile exists, all Budget mutations follow one lock order:

```text
1. budget_profiles row FOR UPDATE
2. active budget_period when required
3. specific category or transaction rows when required
4. aggregate dependent rows
```

Setup has no profile row to lock. Its primary-key profile insert is the
concurrency boundary, followed in the same transaction by the system category,
custom categories, active period, and period-category rows. A losing setup
request receives an already-configured conflict and leaves no partial rows.

Allocation totals are protected transactionally while the profile and active
period are locked; PostgreSQL row checks cover only row-local invariants. The
owner-aware composite foreign keys prevent a user's period, category,
transaction, or impact from being joined to another user's record.

## B1 scope and deferred stages

B1 includes first-time setup, one active period, category planning, manual
expense/credit entry, applied impacts, current-period reporting, bounded
history, and voiding. Voiding changes a posted manual transaction to voided,
retains its impacts for history, and excludes it from reporting. There is no
edit or restore action.

The following are intentionally deferred:

- **B3:** Group integration.
- **B4:** spread/split-period impacts and period transitions.
- **B5:** recurrence and subscriptions.
- **B6:** Overview integration and advanced polish.

`SPREAD` and `REPEAT` are orthogonal. Spread describes how one real payment is
absorbed by multiple periods; repeat describes when additional real payments
occur. Recurring templates, subscriptions, income planning, wallets,
multi-currency, and source-link tables are not B1 behavior.

### Canonical Personal source dates

`TIMESTAMPTZ` answers when an event occurred as an exact instant. The separate
`DATE` answers which financial calendar date the owner meant. Future Budgeting
source ingestion MUST use the `DATE` and MUST NOT reconstruct it from the
timestamp, UTC, server-local time, a viewer timezone, or a stored offset.

Historical Outings and Repayments are intentionally not backfilled. Their
canonical date columns remain `NULL` until an explicit source edit confirms a
date.

When Group integration is implemented, its source-date authority will be
`Group Expense.occurred_on` for expenses and `Group Settlement.paid_on` for
payments. Group `occurred_at`, `created_at`, and `confirmed_at` remain exact or
audit instants and must never establish a Budget date. These nullable Group
dates will not be guessed or backfilled; a legacy `NULL` source date is not
automatically ingestible into Budgeting.

## B2 Personal ledger integration

B2 connects only the authenticated user's Personal ledger through the typed
`budget_personal_expense_sources` and `budget_personal_repayment_sources`
tables. Each source has one linked BudgetTransaction. The source foreign key
cascades only the link row; deleting a Personal source voids, rather than
deletes, its linked BudgetTransaction and keeps its impacts as history.

The Personal source remains authoritative. An Expense contributes its full
amount as a posted outflow, regardless of friend shares. A Repayment
contributes its full amount as a posted inflow. Source dates are read directly
from `Outing.occurred_on` and `Repayment.paid_on`; timestamp, UTC, server, and
viewer-timezone reconstruction is never used. A legacy `NULL` date is skipped
until an explicit source edit confirms the canonical date.

Eligible current-period sources receive an applied Uncategorized impact by
default. Outside-period linked transactions have zero impacts. Existing impact
periods are preserved when amount, description, allocation, or source date
changes; a source date edit does not silently move an impact to another period.
Repayment impacts are rebuilt from the canonical
`RepaymentAllocation → ExpenseShare → Expense` relationship. A usable,
non-archived private Expense category receives its allocated credit, repeated
categories are aggregated, and every unallocated or unclassified remainder is
credited to Uncategorized. Thus the impact total always equals the repayment
amount. Changing a linked Expense's private budget category reclassifies all
linked Repayment credits without changing canonical allocations.

Source mutation and reconciliation run in the same database transaction. The
lock order is: existing Personal source/dependent locks, then `BudgetProfile`,
then Budget period/transaction/impact rows. Budget-only category
classification locks `BudgetProfile`, then Budget rows, and reads Personal
source/allocation rows without `FOR UPDATE`; this avoids a ledger-to-budget
deadlock cycle.

`Import activity` is explicit and dashboard-only. It imports only unlinked
current-period Personal Expenses and Repayments with non-NULL canonical dates,
in Expense-then-Repayment order. No read performs an implicit import. The
source unique keys plus the profile lock make retries and concurrent import or
live reconciliation converge to one linked transaction per source.

Budget history distinguishes manual expense, manual credit/refund, Personal
expense, and Personal repayment. Linked source amount, date, and description
are read-only from Budget; only a linked Expense's private category can be
changed. Expected Back is a quiet derived Personal-ledger context from the
existing outstanding-share authority. It is not a BudgetTransaction or impact,
and does not affect Remaining or Safe Daily; actual Repayment inflows do.

B2 does not integrate Group or Organization activity and does not add spread,
recurrence, next-period transitions, or subscriptions.
