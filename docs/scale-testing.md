# Production-scale acceptance

This workflow is disposable only. Every command must use PostgreSQL database `zplit_scale_test`; never use production, `zplit_showcase`, or another shared database. The fixture does not change authentication rows.

## Setup

Configure the existing database and owner bootstrap secrets first:

```sh
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_NAME=zplit_scale_test
export DB_USER=postgres
export DB_PASSWORD_FILE=/absolute/path/scale-db-password
export BETTER_AUTH_SECRET_FILE=/absolute/path/auth-secret
export BETTER_AUTH_URL=http://127.0.0.1:3001
export OWNER_NAME_FILE=/absolute/path/scale-owner-name
export OWNER_EMAIL_FILE=/absolute/path/scale-owner-email
export OWNER_PASSWORD_FILE=/absolute/path/scale-owner-password
export SCALE_TEST_OWNER_EMAIL=owner@example.com
export ZPLIT_SCALE_TEST_CONFIRM=scale-test-only
```

Create the empty database, migrate it, and bootstrap the existing test owner:

```sh
npm run db:migrate
./node_modules/.bin/tsx scripts/bootstrap-owner.ts
```

Seed and verify the deterministic fixture:

```sh
npm run seed:scale
npm run verify:scale
```

`seed:scale` and `clear:scale` are the only fixture mutations and require both the database guard and `ZPLIT_SCALE_TEST_CONFIRM=scale-test-only`. `verify:scale` and every scale smoke are read-only.

## Focused scale smokes

Run the repository checks individually when diagnosing a failure:

```sh
npm run test:overview-scale
npm run test:record-pages-scale
npm run test:selection-search-scale
```

They cover overview totals/activity, bounded first and adjacent record pages, empty and searched selectors, selected-value retention, selected-friend repayment context, and owner scoping. Their permanent budgets are:

- overview summary: at most 500 ms
- recent activity: at most 100 ms
- each record page query: at most 300 ms
- each selector search: at most 200 ms
- selected-friend context: at most 300 ms

The production-scale acceptance repeats those checks in one guarded run and enforces those warm-median budgets directly:

```sh
npm run test:production-scale
```

It prints deterministic fixture totals, bounded result sizes, adjacent-page duplicate checks, selector/context checks, each warm median and budget, then performs the production runtime check. A successful database phase prints:

```text
database acceptance passed: bounded pages/selectors, deterministic totals, context, adjacent-page uniqueness, and read-only transaction verified
```

## Production runtime check

Before the one build, the acceptance script requires:

- at least 700 MiB available memory;
- at least 4 GiB free disk;
- no competing `next build` or `next dev` process; and
- no OOM event in the previous 10 minutes.

It builds once with the scale-test environment, starts `next start` on `127.0.0.1:3001`, signs in through the normal HTTP auth endpoint using the test owner password, and requests these authenticated HTML pages without Chromium or Playwright:

```text
/app
/app/friends
/app/outings
/app/expenses
/app/repayments
```

Each page is warmed once and then measured. The run fails on a non-success status, a page response over 1.5 seconds after warm-up, HTML over 500 KiB, an unhealthy/exited server, or a changed domain fingerprint. It records status, response time, HTML bytes, and peak RSS for the production Next.js process tree, for example:

```text
resource gate passed: memory=834 MiB disk=6 GiB
production build passed once against zplit_scale_test
production /app: status=200 response=... ms html=... bytes
production runtime passed: 5 authenticated pages, peak RSS=... MiB
```

The authenticated session is signed out during cleanup. The server is stopped even after a failed check.

## Fixture contract

The fixed seed contains 100 friends (80 active, 20 archived), 300 outings over 36 months, 2,000 expenses, 5,792 expense shares, 1,000 repayments, 429 repayment allocations, and eight small PNG receipts. It includes timestamp boundaries, maximum-length valid names, and paid, partial, unpaid, unallocated, and overpaid scenarios.

After acceptance, remove only the disposable fixture if desired:

```sh
npm run clear:scale
```

The owner login remains in `zplit_scale_test`. Do not run the clear command against any other database.
