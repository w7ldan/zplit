# Scale fixture testing

The scale fixture is disposable development data for UX and performance work. It must only run against a disposable PostgreSQL database named `zplit_scale_test`; never point it at production or a shared environment.

## Workflow

1. Create the empty `zplit_scale_test` database and apply the current migrations with `DB_NAME=zplit_scale_test npm run db:migrate`.
2. Configure the existing owner bootstrap secrets for that database and run the owner bootstrap first. This creates the login in `zplit_scale_test`; the scale fixture never creates or changes authentication records.
3. Set `DB_NAME=zplit_scale_test` and `SCALE_TEST_OWNER_EMAIL` to exactly that existing test owner's email.
4. For a mutation, also set `ZPLIT_SCALE_TEST_CONFIRM=scale-test-only`.

```sh
DB_NAME=zplit_scale_test npm run seed:scale
DB_NAME=zplit_scale_test npm run verify:scale
DB_NAME=zplit_scale_test npm run clear:scale
```

`seed:scale` replaces only the deterministic fixture rows owned by `SCALE_TEST_OWNER_EMAIL`. `clear:scale` removes those fixture rows and leaves the owner login intact. `verify:scale` is read-only. All commands require the database name and owner email guard; seed and clear also require the confirmation value.

After the fixture is seeded, retest the production-mode overview repository queries with:

```sh
DB_NAME=zplit_scale_test SCALE_TEST_OWNER_EMAIL=owner@example.com ZPLIT_SCALE_TEST_CONFIRM=scale-test-only npm run test:overview-scale
```

This smoke is read-only, checks the deterministic totals and eight-balance bound, and fails when either warm median exceeds 500 ms.

Record-page pagination and warm-query performance can be checked with:

```sh
DB_NAME=zplit_scale_test SCALE_TEST_OWNER_EMAIL=owner@example.com ZPLIT_SCALE_TEST_CONFIRM=scale-test-only npm run test:record-pages-scale
```

This smoke is read-only, checks active and archived Friends plus Outings, Expenses, and Repayments for 20-row pages, distinct adjacent pages, fixture totals, and warm medians under 500 ms.

Selector search can be checked against the same disposable database with:

```sh
DB_NAME=zplit_scale_test SCALE_TEST_OWNER_EMAIL=owner@example.com npm run test:selection-search-scale
```

This smoke is read-only, checks bounded owner-scoped outing and friend searches, selected-value retention, active-before-archived ordering, and warm medians under 300 ms.

The generated set contains 100 friends (80 active, 20 archived), 300 outings over 36 months, 2,000 expenses, 1,000 repayments, varied shares, and eight small receipts. The data includes boundary timestamps, maximum-length valid names, and paid, partial, unpaid, unallocated, and overpaid scenarios.
