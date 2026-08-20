# Architecture

Zplit is a modular monolith. One Next.js application owns the web routes, server actions, session boundary, domain rules, repository facade, and PostgreSQL access. Authentication and receipt/share-link services remain explicit server-side modules, but they run in the same deployable web service.

## Request and data flow

The normal private flow is:

```text
browser
  → Next.js route or server action
  → Better Auth session / owner ID
  → createLedgerRepository(database, owner ID)
  → domain repository module
  → Drizzle ORM / PostgreSQL
```

Pages read through the owner-scoped repository. Mutations validate input at the server boundary, perform domain and integrity checks, and return a result or a typed domain error for the UI. Public debtor links use a separate bearer-token resolution path before calling the repository’s public statement read.

## Ledger modules

`src/domain/ledger-repository.ts` is the public facade. It validates the owner, composes the current read and mutation modules, and exposes the stable application-facing surface. The implementation is split by concern:

- `friends.ts`, `trips.ts`, and `outings.ts` own their reads and mutations.
- `expenses.ts` owns expense reads, shares, percentage charges, receipt-dependent deletion data, and expense mutations.
- `repayments.ts` owns repayment reads, allocation plans, strategies, and mutations.
- `search.ts`, `history.ts`, and `statements.ts` own global/search, history, exports/statement, and summary reads.
- `types.ts`, `validation.ts`, `query-utils.ts`, and `errors.ts` hold shared contracts and invariant handling.

This keeps the application on one owner-scoped ledger facade while making query and mutation boundaries reviewable without creating separate services.

## Primary domain relationships

```text
Friends → Trips / Outings → Expenses → Shares / Charges
                                      ↓
                              Repayments → Allocations
```

Friends are the people who may owe the owner. Trips group outings; an Outing supplies the occurrence date/time and owns its Expenses. An Expense has an owner portion and friend Shares. A Share can receive one or more percentage Charges, either for all friends on the expense or for a selected set. A Repayment belongs to one Friend and its Allocations apply received money to that friend’s eligible Shares.

Only allocated repayment money reduces an outstanding balance. An allocation cannot cross friends, exceed the repayment amount, or exceed the share amount after other allocations.

## Financial semantics

Ledger amounts are non-negative, safe integers representing whole Rupiah; formatting adds the `Rp` presentation but the database stores the integer. Percentage charges are stored as integer basis points with `100` basis points equal to `1%` and a maximum of `1,000,000` basis points. Charge calculation uses integer arithmetic and rounds the resulting Rupiah amount before adding it to the base share.

The domain validates totals and allocation capacity at the application boundary, while PostgreSQL keys, checks, and the repository’s integrity statements detect invalid persisted relationships. CSV exports are built from a validated owner-scoped snapshot rather than from untrusted request fields.

## Owner isolation and integrity

Every ledger table carries `owner_user_id`. Repository queries include the authenticated owner in their predicates, and the database uses composite owner-plus-record foreign keys so a record from one owner cannot be attached to another owner’s Friend, Outing, Expense, Share, or Repayment. Unique indexes and checks cover IDs, token hashes, dates, and allocation relationships. Authentication is required before private pages and server actions construct the owner-scoped repository.

## Transaction-sensitive workflows

PostgreSQL transactions and row locks protect workflows whose read impact must match their write:

- creating or changing receipts locks the Expense, checks count, byte budget, duplicate hash, and inserts metadata plus bytes together;
- creating, revoking, or changing a debtor link locks the Friend and eligible receipts while replacing the active link and receipt mappings;
- invitation creation and acceptance use an advisory lock plus claim/accept checks so a token is one-time and race-safe;
- destructive ledger actions calculate current impact and require an explicit confirmation revision when dependents exist; Expense deletion then reconciles allocations in the same transaction before deletion, while Outing deletion does not invoke that reconciliation workflow;
- migrations take an advisory lock before Drizzle applies the migration journal.

## Receipts

Receipt metadata and binary content are stored in PostgreSQL. An Expense accepts at most five receipts and 15 MiB total; duplicate content is rejected by SHA-256. Authenticated receipt routes select by owner and Expense/receipt IDs and return private, no-store responses with restrictive content and referrer policies. A debtor link may expose only receipt mappings explicitly selected by the owner and eligible for that Friend.

## Invitations

The installation owner creates an invitation for a normalized email and optional suggested name. The system returns a random 32-byte token, stores only its SHA-256 hash, and gives it an expiry, claim, acceptance, and revocation state. Acceptance is invitation-only, creates a normal Better Auth credential account without creating a session, and records the accepted account atomically after the account is verified.

## Private debtor links

The balance link is a seven-day bearer token. A random UUID is returned to the owner once; only its SHA-256 hash is stored. Resolution hashes the presented token and requires a non-revoked, unexpired row, then reads only the linked owner’s Friend statement. A new active link revokes the prior active link for that owner/Friend. Receipt selection is stored as link-to-receipt mappings and is checked against the same owner, Friend, Expense, and receipt relationships.

## Delete-time allocation reconciliation

Expense deletion first locks the affected Shares and repayment Allocations. Allocations attached to deleted Shares are removed; for each affected Repayment, released money is reallocated oldest-first to remaining eligible open Shares for the same Friend. Any amount with no remaining capacity stays on the Repayment as unallocated. Repayment amounts remain historical payment records and are not rewritten. The operation returns affected Friends and Repayments so their views can be revalidated, and the UI explains the impact before confirmation. Outing deletion has a separate confirmed dependent-data cascade and does not invoke this reconciliation workflow.

## Date, time, and theme contracts

Stored timestamps use PostgreSQL `timestamptz` and cross the server/UI boundary as ISO timestamps. Direct UI timestamp formatting belongs in `LocalDateTime`: the server-rendered fallback is UTC, then the browser renders local time after hydration. Calendar-only Trip dates remain `YYYY-MM-DD` values formatted in UTC. Month filters use a validated client timezone offset so local calendar boundaries are selected consistently.

Theme preference is a client-side Light/Dark/System value persisted under `zplit-theme`. The provider resolves System through `prefers-color-scheme`, sets `data-theme` and `color-scheme` on the document root, and updates the theme-color metadata. CSS owns the semantic token mapping; no server-side financial or ledger behavior depends on the selected theme.
