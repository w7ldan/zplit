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
integrations use typed link tables with real foreign keys;
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

## B1 scope

B1 includes first-time setup, one active period, category planning, manual
expense/credit entry, applied impacts, current-period reporting, bounded
history, and voiding. Voiding changes a posted manual transaction to voided,
retains its impacts for history, and excludes it from reporting. There is no
edit or restore action.

B6 closes the roadmap with the Overview integration and final presentation
polish described in "B6 Overview integration and final polish"; no Budget stage
remains deferred.

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

B2 alone did not integrate Group or Organization activity and did not add
spread, recurrence, next-period transitions, or subscriptions; B3 adds only
the Group cash integration described below.

## Period transitions and spread

Period transitions and spread keep one real cash event as one `BudgetTransaction`. A spread outflow has
multiple `BudgetImpacts`, all in one private Budget category. The first impact
is `applied` to the active period; later impacts are `pending`, have no period
ID, and retain the exact target period ordinal. Pending impacts are future
absorption, not future cash, and are excluded from every current and closed
period report until applied. They are never a recurrence or a second real
transaction.

The requested count is 1–24 and cannot exceed the transaction amount. Integer
distribution is deterministic: `floor(amount / count)` is the base and the
remainder is added to the earliest slices. This keeps every impact positive,
preserves the exact transaction total, and uses no floating point. Spread can
be restructured only while exactly one current-period impact is applied and
all other slices are still pending. Once a transition applies a future slice,
the spread is historical and immutable.

Starting the next period is one transaction. It locks the owner's
`BudgetProfile`, then the active period, and verifies the submitted active
period ID is still current. A stale request conflicts before any write. The
active period is closed, ordinal +1 is inserted as the sole active period, and
the submitted stable category IDs and explicit allocations are copied into
the new plan. Dates do not assume a cadence: the new start must be after the
closed period's end, while gaps are allowed. The transition then applies only
posted pending impacts targeted at the new ordinal; voided parents remain
pending and are ignored.

After the new period exists, the same source-aware Personal and Group
reconciliation primitives absorb linked posted BudgetTransactions with zero
impacts whose canonical Budget date falls inside the new period. This avoids
permanently unabsorbed future Expenses, Repayments, or settlement cash and
does not lock source rows from the Budget-only path. Reconciliation of a
linked Personal or Group Expense with multiple spread impacts preserves every
target ordinal, status, period ID, and category while deterministically
rebalancing amounts. Private category changes update every applied and
pending impact. Repayment and settlement category derivation treats repeated
same-category spread rows as one category and raises an invariant conflict if
spread rows disagree.

Closed periods have a bounded, read-only history using the same applied-impact
reporting authority as the active dashboard. The transition form previews
pending totals targeted at the next ordinal without changing allocations.

## B5 recurring expenses

Recurrence and spread are orthogonal. Spread describes how one real payment is
absorbed by several periods; recurrence describes when additional real payments
are expected. A recurring template is a future rule, an occurrence is one
expected payment, and a `BudgetTransaction` is still the only actual money
event. Scheduling an occurrence creates no transaction and no impact, so due
and skipped occurrences never change Net spent, Remaining, Safe daily, or
category reporting. Only an applied impact of a posted transaction does.

`BudgetRecurringTemplate` is private, owner-scoped, outflow-only, and
archive-instead-of-delete. It stores a name, positive integer Rupiah amount, a
currently usable owner category, a frequency, a canonical `starts_on` DATE, and
a `spread_count` of 1–24 that cannot exceed the amount. Frequencies are
`every_budget_period` and `monthly`. A template is a preferred default, not a
ledger source: B5 performs no automatic Personal or Group matching and does not
create recurring templates from imported activity.

`BudgetRecurringOccurrence` snapshots the amount, category, and spread count for
one scheduled payment, plus the scheduled period and scheduled date. Its
lifecycle is exactly `due → recorded | skipped`. A due or skipped occurrence
has no transaction; a recorded occurrence has exactly one owner-safe
`BudgetTransaction` link. `UNIQUE(owner, template, scheduled_on)` makes
materialization retry-safe while still allowing several monthly occurrences in
a long BudgetPeriod. Later template edits affect only future materialization;
they never rewrite an occurrence snapshot, a recorded transaction, or impacts.

Scheduling is pure date-only math; it never uses timestamps or timezones.
`every_budget_period` produces at most one occurrence per eligible period, at
`max(starts_on, period.starts_on)` when the period contains `starts_on`, and at
the later period start afterwards. `monthly` uses the original anchor day for
each calendar month inside the period, clamping to the month's final valid day
without carrying the clamp forward: a 31st anchor becomes February 28 (or 29
in a leap year) and returns to the 31st in March. A long period may contain
several monthly occurrences; a short period may contain none, and calendar gaps
between periods are not manufactured.

Creating a template locks the BudgetProfile and active period, validates the
usable owner category, inserts the template, and materializes eligible
occurrences for the current active period as `due`. Creating a template
therefore changes no financial total. Editing a template changes future
defaults only. Archiving stops future generation while retaining existing
occurrences and history.

Starting the next period remains one transaction. It recomputes canonical
candidates from active templates and the proposed dates; the client preview
cannot supply amounts, dates, or frequencies. Each candidate is selected by
default and materialized `due`, or materialized `skipped` when the user
deselects it. A deselect is deliberately persisted as a skipped row so a
reopened or retried transition cannot resurrect it. Candidate category mapping
defaults to the template's category when that category is in the submitted
next-period plan and falls back to Uncategorized otherwise; the mapped category
must come from that plan. The mapping changes only the occurrence snapshot, not
the template. Materialization follows the existing profile/active-period
locks and the occurrence identity constraint protects retries.

`Record payment` is explicit. The user submits a canonical `YYYY-MM-DD` payment
date, which becomes `BudgetTransaction.occurred_on`; `scheduled_on` is only when
the payment was expected. Recording creates exactly one posted outflow with
`origin = recurring` and the occurrence's amount, then reuses the B4
`splitBudgetAmount` authority. When the payment date is inside the active
period, the first slice is applied there and later slices become pending
impacts targeting the following ordinals. When it is outside the active period,
the transaction is recorded with zero impacts rather than guessing an
absorption period; a later transition absorbs it once when its date reaches
that period. Double or concurrent recording serializes on the profile and
occurrence lock, so at most one transaction is created. A recorded transaction
can be voided: the transaction becomes voided, its impacts stay as history, and
the occurrence remains recorded and linked. A due occurrence can instead be
skipped, which creates no cash and cannot be undone by automatic reactivation.

The private `/app/personal/budget/subscriptions` surface lists active templates
and unresolved due occurrences with dense rows, including edit, archive,
record, and skip actions. The dashboard and Overview may show a quiet
upcoming-recurring count and expected amount, but that planning context is
excluded from every financial total.

## B3 Group cash integration

B3 keeps the authority split explicit. Group accounting remains canonical for
participants, payer, Expense amount/description/state, `occurred_on`,
obligations, settlement sender/recipient/state, amount, `paid_on`, settlement
applications, and offset applications. Budgeting only decides how one
registered owner's private Budget absorbs an authoritative cash event. No
Budget category, impact, or classification crosses a Group participant
boundary.

The typed provenance tables are `budget_group_expense_sources` and
`budget_group_settlement_sources`. Each has an owner-scoped BudgetTransaction
foreign key, a real Group source foreign key, and a unique owner/source
identity. A confirmed settlement may therefore have one sender link and one
recipient link. Group source rows are lifecycle-stable and deletion-protected;
no generic polymorphic source ID or source-type column is used. Debtor-only
private classification is stored in
`budget_group_obligation_classifications`, keyed by owner and Group
obligation with an owner-safe category foreign key.

An Expense becomes authoritative when it is immediately confirmed for its
creator/payer or when the registered third-party payer confirms the pending
claim. Only then does the registered payer receive a linked posted outflow
for the full canonical Expense amount. The payer's economic share never
reduces that outflow. Pending claims, rejected claims, non-payers, missing
BudgetProfiles, and `occurred_on IS NULL` sources create no Budget state.
The Budget date is exactly the Group Expense `occurred_on` date; it is never
derived from `occurred_at`, `created_at`, `confirmed_at`, UTC, a server
timezone, or a viewer timezone. A confirmed Expense in the active period
gets one applied Uncategorized impact; an outside-period source remains
linked with zero impacts. Existing impact periods and private categories are
preserved when source-owned fields are reconciled. A confirmed Expense void
voids its linked BudgetTransaction while retaining impacts/history.

Only recipient confirmation makes a Group settlement cash-authoritative.
Pending settlements have zero Budget cash. For each registered party with a
BudgetProfile and non-NULL `paid_on`, the sender receives a full-amount
outflow and the recipient receives a full-amount inflow. The Budget date is
exactly `paid_on`; no timestamp or timezone conversion is involved. An
outside-period settlement is linked with zero impacts. Sender impacts map
each canonical SettlementApplication through the sender's own private debtor
obligation classification. Recipient impacts map the same applications
through the recipient's own private Group Expense category. Missing,
archived, foreign, or otherwise unusable classifications and any unmapped
remainder go to Uncategorized. Same-category allocations aggregate and
absorbed impact totals equal the settlement amount for both owners. A sender
never inherits the recipient's Expense category and a recipient never reads
the sender's obligation category.

The payer may change the private category of their linked Group Expense. The
debtor may classify an obligation privately from the Budget Shared Money
context. Each change rebuilds only that owner's affected confirmed settlement
impacts: payer Expense recategorization propagates to related received
inflows, and debtor obligation recategorization propagates to related sent
outflows. Canonical obligations and SettlementApplications are never edited
by Budget code. Group offsets remain zero-cash: they can change outstanding
Group context and offset applications, but create no BudgetTransaction,
BudgetImpact, or Budget source link.

Shared Money combines the existing Personal expected reimbursements with
outstanding Group creditor capacity under **Expected back**, and shows
outstanding Group debtor capacity under **You still owe**. It reuses the
canonical Group balance and obligation/application/offset state, so pending
settlements do not count as completed cash and confirmed payments or offsets
reduce the appropriate outstanding amount. These context values do not affect
Net spent, Remaining, Safe daily, or category Remaining. The bounded private
obligation disclosure is the Budget-only place to classify a debtor
obligation; Group pages and Group DTOs never expose Budget categories.

`Import activity` remains the single explicit import flow. It processes
Personal Expense, Personal Repayment, eligible current-period Group Expense,
then eligible current-period Group settlements. Group import requires an
authoritative state, a registered payer or sender/recipient, the canonical
non-NULL date inside the active period, and no existing owner link. It skips
pending, rejected, non-authoritative, NULL-date, and offset activity. Typed
unique keys make repeated and concurrent imports idempotent, and the same
keys make import concurrent with live confirmation converge to one source per
owner. There is no write-on-read import.

Group mutation locking remains Group-first. After the canonical Group locks
are acquired and the final source/application state is known, relevant
BudgetProfile rows are locked in ascending `owner_user_id` order, followed
by each owner's active period, Budget transaction, and impact rows in the
existing Budget order. Budget-only classification follows
`BudgetProfile → Budget rows → read Group source/application data` and takes
no Group source `FOR UPDATE` locks. This prevents an Alice/Bob versus
Bob/Alice cross-owner cycle without changing Group accounting locks.

The earlier Group cash integration deliberately kept period spreading/transitions,
pending BudgetImpacts, recurrence/subscriptions, Organization budgeting, and
shared Group Budget plans outside its scope. Period spreading, transitions, and
private recurring expenses are now handled by the Budget-only flows described
above; Organization budgeting and shared Group Budget plans remain deferred.

## B6 Overview integration and final polish

B6 adds no accounting semantics. Budgeting remains private Personal budgeting,
and its authoritative totals still come only from applied BudgetImpacts whose
parent BudgetTransaction is posted.

The authenticated Overview exposes one compact private Budget section. For a
configured owner it shows the active period identity, Remaining, Net spent, and
Safe daily, all read through the same applied-impact authority as the dashboard;
neither the Overview read model nor its component recomputes those totals. It
links into the full Budget workspace instead of duplicating the dashboard. An
owner without a BudgetProfile sees a quiet setup affordance, opening Overview
never creates a profile, and no zero-valued placeholder metrics are shown.

Recurring expectations remain planning context. Overview may show the existing
due count and expected amount as a separate, clearly planning-only line linking
to Subscriptions; due or skipped occurrences never enter Remaining, Net spent,
Safe daily, or category reporting. Safe daily stays browser-local through the
existing client helper, so Overview and the dashboard agree at timezone
boundaries. Shared Money stays separate: Expected back, obligations, and Group
balances are never netted against Remaining or added to Budget spending.

The Overview Budget read is a bounded composition: a profile lookup, the active
period, one direction aggregate over applied impacts of posted transactions,
and one due-occurrence aggregate. It performs no per-category or
per-recurring-item query, and a profile without an active period reports only
that recovery state.

B6's presentation work adds one shared contextual navigation across the Budget
dashboard, transaction history, period history, and subscriptions surfaces, and
polishes their empty states and density without changing any accounting,
transition, recurrence, or authorization behavior. Closed-period history
remains read-only with the applied-impact category union described above. B6
adds no schema change, no Organization budgeting, and no automatic source or
recurrence inference.
