# Showcase capture fixture

This fixture is disposable data for the 60-second Zplit product video. It must
only target a dedicated PostgreSQL database named exactly `zplit_showcase`.
Never run it against production, `zplit_scale_test`, or any other database.

## Isolated setup

Create the database separately, then apply the existing migrations. The fixture
does not change the schema or migrations:

```sh
createdb zplit_showcase
DB_NAME=zplit_showcase npm run db:migrate
```

Create regular files containing the values below. Keep the password and Better
Auth secret private; the scripts never print them.

```text
OWNER_NAME_FILE=/absolute/path/showcase-owner-name
OWNER_EMAIL_FILE=/absolute/path/showcase-owner-email
OWNER_PASSWORD_FILE=/absolute/path/showcase-owner-password
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=zplit_showcase
DB_USER=zplit
DB_PASSWORD_FILE=/absolute/path/showcase-db-password
BETTER_AUTH_URL=http://localhost:3100
BETTER_AUTH_SECRET_FILE=/absolute/path/showcase-auth-secret
```

The owner files must contain `Zplit Showcase`, `showcase@zplit.local`, and a
Better Auth-compatible password respectively. The database password and auth
secret files must be regular, non-empty files.

Run the application on a separate local port so the recording session cannot
use the normal development server:

```sh
BETTER_AUTH_URL=http://localhost:3100 npm run dev -- -p 3100
```

In another shell, export the variables above. The mutation confirmation is
deliberately explicit:

```sh
export DB_NAME=zplit_showcase
export ZPLIT_SHOWCASE_CONFIRM=showcase-only
```

`showcase:setup` creates the exact dummy account through Better Auth and starts
at state 1. It is safe to repeat for that same valid account. It refuses a
different user, identity, or credential state.

## Capture states

Each state command replaces only the showcase owner’s ledger and share-link
records in one advisory-locked transaction. The authentication account stays
intact.

```sh
npm run showcase:setup
npm run showcase:state -- 1
npm run showcase:state -- 2
npm run showcase:state -- 3
npm run showcase:state -- 4
npm run showcase:state -- 5
npm run showcase:state -- 6
```

The shared scenario is Rani and Dimas on a Bandung day out: dinner is
`Rp 240.000`, taxi is `Rp 120.000`, assigned shares total `Rp 169.000`, and
the owner portion is `Rp 191.000`. State 5 fully allocates Rani’s
`Rp 126.500` repayment; Dimas remains open at `Rp 42.500`. State 6 creates a
fresh seven-day link for Dimas, stores only its SHA-256 token hash, and prints
the usable `/share/<token>` URL. The link exposes only the Dinner receipt.

Use the printed URLs and login email after every setup/state command. The
receipt is always available at:

```text
scripts/fixtures/showcase-dinner-receipt.png
```

The same tracked PNG is inserted for states 4–6 and should be used for the
recorded upload interaction: in state 3 open the Dinner expense, upload that
file through the normal receipt form, then continue with the state commands to
restore the exact capture states.

Read-only checks require the requested state and no mutation confirmation:

```sh
npm run showcase:verify -- 1
npm run showcase:verify -- 2
npm run showcase:verify -- 3
npm run showcase:verify -- 4
npm run showcase:verify -- 5
npm run showcase:verify -- 6
```

Verification checks the exact account and records, totals, owner isolation,
relationship and financial invariants, receipt metadata, state boundaries,
settlement status, and the active state-6 receipt-only link.

## Cleanup

After recording, remove only the showcase owner’s ledger, receipts, repayment
allocations, and share links while retaining the dummy login:

```sh
npm run showcase:clear
```

Drop the whole database separately when the isolated environment is no longer
needed:

```sh
dropdb zplit_showcase
```

Do not substitute another `DB_NAME`, remove the database guard, or point these
commands at production.
