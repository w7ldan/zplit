# Repository showcase capture guide

This is the manual capture workflow for the privacy-safe repository showcase. It prepares one local Zplit instance with deterministic synthetic data for the five README/Hyperframe visuals. It does not add browser automation or screenshot dependencies.

## Safety and setup

Use a separate local PostgreSQL database named `zplit_repository_showcase`. Never point these commands at production, a restored dump, or a shared database. The repository profile refuses any other database name and requires `ZPLIT_SHOWCASE_CONFIRM=showcase-only` for setup and clear operations. The legacy six-state fixture remains on `zplit_showcase`.

The repository profile has its own disposable database because confirmed Group settlements and their applications are immutable financial history in PostgreSQL. Sharing the legacy database would make a safe, fixture-owned replacement/clear impossible without bypassing those invariants. The repository command therefore resets only this explicitly named repository database, then applies the checked-in migrations before setup.

Configure the normal local application environment plus the existing secret-file variables:

```sh
export DB_NAME=zplit_repository_showcase
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_USER=zplit
export DB_PASSWORD_FILE=/absolute/path/to/db-password
export BETTER_AUTH_URL=http://localhost:3100
export BETTER_AUTH_SECRET_FILE=/absolute/path/to/better-auth-secret
export OWNER_NAME_FILE=/absolute/path/to/showcase-owner-name
export OWNER_EMAIL_FILE=/absolute/path/to/showcase-owner-email
export OWNER_PASSWORD_FILE=/absolute/path/to/showcase-owner-password
export ZPLIT_SHOWCASE_CONFIRM=showcase-only
```

The existing owner files remain part of the guard: the name must be `Zplit Showcase` and the email must be `showcase@zplit.local`. Keep the password in the local secret file; do not commit it. The repository accounts use that same local password and are all synthetic `@zplit.local` identities:

| Account | Email | Intended use |
| --- | --- | --- |
| Ari Pratama | `ari.pratama@zplit.local` | primary capture login |
| Nadia Putri | `nadia.putri@zplit.local` | Group payment / collaborator perspective |
| Reno Mahendra | `reno.mahendra@zplit.local` | Organization collaborator perspective |
| Mika Santoso | `mika.santoso@zplit.local` | registered participant |

The legacy `showcase:setup`, `showcase:state`, `showcase:verify`, and `showcase:clear` commands remain available for the old six-state Personal fixture. The repository profile is a separate command using the same database guard and safety primitives.

## Activate and verify

Start the app against the isolated database, ensure the database has been created and migrated with the normal disposable migration workflow, then run:

```sh
npm run showcase:repository -- setup
npm run showcase:repository -- verify
```

Setup resets only the explicitly named repository-showcase database, applies migrations, recreates the four synthetic accounts, and runs the read-only semantic verification before returning. Re-running setup is deterministic except for generated account IDs and the production-style bearer token, neither of which is visible in the capture routes; the bearer token is never stored in plaintext. To print the disposable share URL for the manual share capture, explicitly request it:

```sh
npm run showcase:repository -- setup --print-share-link
```

The command output also prints the exact authenticated routes. If a full public-link verification is desired, pass the ephemeral token to verification locally (do not commit or paste it into documentation):

```sh
npm run showcase:repository -- verify --token=<ephemeral-token>
```

Without a token, `verify` still checks the stored hash, active-link metadata, selected receipt mapping, and absence of payment-proof exposure. With a token it additionally resolves the normal public statement and receipt contract.

For each authenticated capture, open `/login`, enter the selected synthetic `@zplit.local` email and the password stored in `OWNER_PASSWORD_FILE`, then navigate to the printed route. Use Ari for the Hero, Personal, Group, and Organization targets. Log out and use Nadia only when a collaborator identity is useful; the public share target is opened without signing in.

## Capture targets

Use Ari’s account for the authenticated captures unless noted. A primary viewport of **1440×900** is recommended; allow ordinary page scrolling where needed and do not change production CSS for screenshots.

1. **Hero / overall product** — `/app` while signed in as Ari. This communicates the breadth of Personal, Groups, and Organizations in one real overview surface.
2. **Personal** — `/app/personal` while signed in as Ari. This shows `Bandung Weekend`, four expenses, Nadia/Reno/Mika balances, repayments, and recent activity.
3. **Group** — `/app/personal/groups/5ca5e201-0000-4000-8000-000000000001/settlements` while signed in as Ari. This shows the canonical participant obligations and a confirmed Nadia → Ari payment allocation. The optional supporting route `/app/personal/groups/5ca5e201-0000-4000-8000-000000000001/chat` shows the seeded read-receipt-aware conversation.
4. **Organization** — `/app/organizations/5ca5e301-0000-4000-8000-000000000001` while signed in as Ari. This shows `Northstar Studio` as a separate managed ledger with expenses, repayment, and scoped summary. Use `/app/organizations/5ca5e301-0000-4000-8000-000000000001/people` for the role/member detail if a second organization frame is useful; `/general` is the seeded Organization General Chat.
5. **Private share** — `/share/<ephemeral-token>` in a logged-out/private browser context. The recipient sees Nadia’s read-only statement, selected Lunch receipt, assigned/repaid/outstanding totals, and no payment proof. Never publish the token or a URL containing it.

The fixture uses fixed IDs for these routes, fixed dates, fixed names, and fixed rupiah values. Only the bearer token is intentionally random because it must retain production lifecycle semantics.

## Cleanup

After the manual capture pass:

```sh
npm run showcase:repository -- clear
```

Clear validates the repository database contains only known fixture-owned identities, then resets that explicitly named disposable database and reapplies its schema. It does not touch `zplit_showcase` or any production database. Drop the repository database separately when it is no longer needed.

## Privacy rules

This dataset contains no production reads, imported records, real contacts, real receipts, real amounts, committed passwords, or committed bearer tokens. Keep the local secret files and generated share URL out of git, browser history exports, screen recordings, and public issue comments. Do not capture the legacy owner account or any live deployment. Final sanitized README images remain intentionally deferred until a human visual pass reviews and exports them.
