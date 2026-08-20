# Testing

Zplit keeps fast domain and UI contracts close to the code, then adds explicit PostgreSQL, deployment, and scale checks for workflows that cannot be proven by a unit test alone.

## Unit, domain, and component tests

Run the default suite with `npm test`. It covers domain validation and arithmetic, date/time contracts, repayment strategies and allocation invariants, ledger summaries/history/exports, authentication helpers, receipt and share-link security, React components, server actions, route rendering, theme behavior, PWA behavior, and accessibility-facing UI states.

Focused examples include:

```sh
npx vitest run src/domain src/components src/auth src/server
npx vitest run src/app/design-contract.test.ts src/app/css-architecture.test.ts src/app/date-time-contract.test.ts
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

`docs/design-system.md` is the design source. `src/app/design-contract.test.ts` reads it directly and checks the semantic palette, geometry, motion/accessibility language, responsive hierarchy, CSS ownership, and the scale-result budgets below. Do not weaken those assertions to make a stale document pass; update the document and source together when the contract genuinely changes.

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
npm run test:production-scale
npm run clear:scale
```

The fixture contract is 100 friends (80 active, 20 archived), 300 outings over 36 months, 2,000 expenses, 5,792 expense shares, 1,000 repayments, 429 repayment allocations, and eight small PNG receipts. It includes timestamp boundaries, maximum-length valid names, and paid, partial, unpaid, unallocated, and overpaid scenarios.

The permanent warm-median budgets are:

- overview summary: at most 500 ms
- recent activity: at most 100 ms
- each record page query: at most 300 ms
- each selector search: at most 200 ms
- selected-friend context: at most 300 ms

Production-scale acceptance repeats the bounded database checks and performs a no-browser `next start` check for the authenticated pages `/app`, `/app/friends`, `/app/outings`, `/app/expenses`, and `/app/repayments`. It requires at least 700 MiB available memory, at least 4 GiB free disk, no competing Next process, and no recent OOM event. It measures warm responses, HTML size, process health, and peak RSS.

## Resource safety

The production-scale run builds once and starts a real production server, so it is a heavy workload for the small VM. Run it deliberately, only in the disposable environment, and only when changing query bounds, pagination, selectors, production rendering, or release performance. Do not run it for prose/CSS-only changes, during unrelated builds, or while production services share the host’s constrained memory and disk. Never run scale seed/clear or acceptance against production.
