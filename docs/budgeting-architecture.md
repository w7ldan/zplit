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
Personal, Repayment, and Group integrations will use typed link tables with
real foreign keys; budgeting will not add generic `source_type` or `source_id`
columns. Group offsets will never become BudgetTransactions because no money
moved.

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

- **B2:** Personal Expense and Repayment integration. The prerequisite source
  date authority is explicit: a Personal Expense uses its parent
  `Outing.occurred_on`, and a Personal Repayment uses `Repayment.paid_on`.
  These are owner-confirmed PostgreSQL `DATE` values, exposed as nullable
  `YYYY-MM-DD` strings. `NULL` means the legacy source has no canonical
  financial date yet.
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
date. This section defines the B2 prerequisite; it does not implement B2,
source links, or BudgetTransaction ingestion.
