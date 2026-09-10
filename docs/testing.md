# Testing

Zplit keeps fast domain and UI contracts close to the code, then adds explicit PostgreSQL, deployment, and scale checks for workflows that cannot be proven by a unit test alone.

## Unit, domain, and component tests

Run the default suite with `npm test`. It covers domain validation and arithmetic, date/time contracts, repayment strategies and allocation invariants, ledger summaries/history/exports, authentication helpers, receipt and share-link security, React components, server actions, route rendering, theme behavior, PWA behavior, and accessibility-facing UI states.

Focused examples include:

```sh
npx vitest run src/domain src/components src/auth src/server
npx vitest run tests/contracts/design.test.ts tests/contracts/css-architecture.test.ts tests/contracts/date-time.test.ts
```

The exact file list can grow with the product; use the full `npm test` suite before a release when the change is not documentation-only.

## Repository, database, and security contracts

Repository tests exercise owner-scoped reads and writes, composite relationships, summaries, search, pagination, exports, deletion impact, allocation reconciliation, and transaction-sensitive invariants. Database smoke scripts verify migrations, constraints, rollback behavior, and persisted ledger integrity:

```sh
npm run test:database
npm run test:record-retrieval
npm run test:auth
npm run test:invitations
npm run test:ownership
npm run test:receipts
npm run test:shared-receipts
npm run test:debtor-shares
npm run test:history-delete
```

Run these only against an explicitly disposable or designated test database. The authorization and security contracts cover invitation-only signup, owner isolation, same-origin handling, secret-file validation, receipt access, hash-only bearer links, expiry/revocation, no-store headers, and redaction of secrets from errors.

## Design and source contracts

`docs/design-system.md` is the design source. `tests/contracts/design.test.ts` reads it directly and checks the semantic palette, geometry, motion/accessibility language, responsive hierarchy, CSS ownership, and the scale-result budgets below. Do not weaken those assertions to make a stale document pass; update the document and source together when the contract genuinely changes.

Other source contracts check CSS fragment order and ownership, browser metadata, route titles, date/time formatting, PWA manifest/service worker behavior, receipt accessibility, and deployment assumptions.

## Deployment and release tests

```sh
npm run test:deployment
npm run test:release
npm run typecheck
npm run lint
git diff --check
```

The deployment test checks the Caddy and Compose contracts, security headers, network/secrets boundaries, pinned images, and restricted tool stages. The release smoke is an HTTPS, no-browser check of health, public and private routes, redirect behavior, robots, sitemap, manifest, service worker, and production headers.

## Scale tests and acceptance

Use only the disposable `zplit_scale_test` environment with the guarded fixture commands:

```sh
npm run seed:scale
npm run verify:scale
npm run test:overview-scale
npm run test:record-pages-scale
npm run test:selection-search-scale
npm run test:group-scale
npm run test:organization-scale
npm run test:budget-scale
npm run test:collaboration-scale
npm run test:production-scale
npm run clear:scale
```

The full-product scale fixture serves performance/scalability testing and
manual UI/UX stress testing at the same time. The Personal baseline is
preserved: 100 friends (80 active, 20 archived, 10 linked), 12 trips,
300 outings over 36 months, 2,000 expenses, 5,792 expense shares,
1,000 repayments, 429 repayment allocations, and eight small PNG receipts,
with timestamp boundaries, maximum-length valid names, and paid, partial,
unpaid, unallocated, and overpaid scenarios. Personal outings carry canonical
`occurred_on` dates and repayments carry `paid_on` dates so Budget ingestion
reads the same DATE authority production uses.

On top of that baseline the same scale owner holds:

- 24 Groups (~240 participants with registered, external, former, and
  owner identities; ~1,200 expenses across pending, confirmed, rejected,
  and voided states; ~2,150 obligations; ~315 settlements with full
  application coverage; bilateral offsets; receipts, proofs, lifecycle
  events, and join requests), with anchors such as Jakarta Weekend,
  Japan Trip 2026 (dense), Fasilkom Study Group (pending claims),
  Apartment Split (unsettled), Design Committee (fully settled),
  Engineering Committee (external participants), Archived Club, and
  Quiet Reading Club (owner invitation, barely populated);
- 10 Organizations (~180 participants across owner, admin, treasurer,
  member, and custom roles; memberships, invitations, per-organization
  ledger scopes with friends, outings, expenses, shares, repayments,
  allocations, and receipts), with anchors such as Atelier Nusantara,
  Engineering Guild (dense), Fasilkom Alumni, Treasury Collective,
  River Community, Archived Syndicate, and Quiet Collective;
- a complete Budget history: 20 periods with September Budget active,
  15 categories including the Uncategorized system category, ~3,270
  transactions across manual, linked Personal, linked Group, and recurring
  origins, ~3,120 impacts with applied/pending authority intact, spread
  plans, 60 active plus 15 archived recurring templates (Heavy Recurring),
  and ~390 due/recorded/skipped occurrences;
- ~260 notifications across the supported families (unread and read,
  recent and older) and ~2,000 chat messages across all Group and
  Organization threads, including a 1,300-message thread for scroll testing.

Group accounting identity stays `group_participants.id`; pending and
rejected claims never create obligations; pending settlements never carry
applications; confirmed settlements are always fully applied; confirmed
offsets allocate the full amount in both directions; offsets never become
BudgetTransactions. Budget authority stays posted transactions plus applied
impacts: pending impacts, voided transactions, and due/skipped expectations
never affect totals. Seed replays the production lifecycle (pending creation,
confirmation, voiding) so trigger-validated states are genuine; teardown in
the disposable database bypasses only the immutable-history row-delete
triggers for fixture-owned rows, in FK-safe order, then resumes enforcement.

The permanent warm-median budgets are:

- overview summary: at most 500 ms
- recent activity: at most 100 ms
- each record page query: at most 300 ms
- each selector search: at most 200 ms
- selected-friend context: at most 300 ms
- group list: at most 800 ms
- group detail/participants/settlements: at most 500 ms
- dense group expenses/balances: at most 800 ms
- organization list/ledger overview: at most 800 ms
- organization detail/members/ledger page: at most 500 ms
- budget dashboard: at most 1000 ms
- budget overview snapshot: at most 300 ms
- budget period history/transactions/recurring: at most 500 ms
- notification page/group chat/history/org chat: at most 500 ms
- notification unread count: at most 300 ms

### Manual UI inspection against the scale database

Run the app with `DB_NAME=zplit_scale_test` (plus the usual `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD_FILE`, `BETTER_AUTH_*` settings for that
environment) and sign in as the scale owner. The owner account already exists
in `zplit_scale_test`; to make it login-capable, place a disposable
16–128 character password in a secret file, export
`SCALE_OWNER_PASSWORD_FILE=/path/to/that/file`, and run `npm run seed:scale`.
Seeding hashes the password with the same Better Auth helper production uses,
stores only the hash in a fixture-owned credential row, and never logs or
documents the secret. Without that variable the seed still succeeds but
prints that manual login is unavailable. Start from `/app`, then visit the
Personal ledger, Groups (Japan Trip 2026, Fasilkom Study Group, Archived
Club), Organizations (Engineering Guild, Quiet Collective), the Budget
workspace (September Budget, period history, subscriptions), Inbox, and the
long Japan Trip 2026 thread.

Production-scale acceptance repeats the bounded database checks and performs a no-browser `next start` check for the authenticated pages `/app`, `/app/friends`, `/app/outings`, `/app/expenses`, and `/app/repayments`. It requires at least 700 MiB available memory, at least 4 GiB free disk, no competing Next process, and no recent OOM event. It measures warm responses, HTML size, process health, and peak RSS.

## Constrained VM validation

On the ~2 GB development VM, run only one heavy validation process at a time (typecheck, lint, tests, build, or scale acceptance).

When the default Node heap is known to OOM on typecheck, prefer:

```sh
npm run typecheck:vm
```

instead of the ordinary typecheck. CI and larger machines should keep using the ordinary `npm run typecheck` without the 1.5 GB ceiling.

PostgreSQL smoke scripts stub `server-only` themselves (see `scripts/*-smoke.ts`); they need no separate `NODE_OPTIONS=--conditions=react-server` invocation. Do not reintroduce that workaround unless a script actually fails on the `server-only` import.

During feature development, prefer the narrowest focused tests that exercise the changed ownership boundary. Repository-wide static checks belong after the intended source diff is complete and frozen. Do not repeatedly run full validation between mechanical edits.

## Resource safety

The production-scale run builds once and starts a real production server, so it is a heavy workload for the small VM. Run it deliberately, only in the disposable environment, and only when changing query bounds, pagination, selectors, production rendering, or release performance. Do not run it for prose/CSS-only changes, during unrelated builds, or while production services share the host’s constrained memory and disk. Never run scale seed/clear or acceptance against production.
