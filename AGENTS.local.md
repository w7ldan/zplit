# Zplit project rules

## Workflow

- For normal implementation tasks, run `devflow scout --task "<task>" --json` before broad repository exploration. Inspect its bounded candidate files with targeted `rg -n` and narrow source ranges, then implement the change.
- After implementation, run `devflow check --changed` to plan validation. Run focused tests and the applicable checks from that plan, then run `devflow checkpoint --task "<task>"` before finishing. Resolve any targeted escalation it identifies.
- Stop if Git shows unexpected tracked changes. This VM has approximately 16 GB RAM; run one heavy build, browser, or database process at a time.

## Architecture

- Keep domain, server, transport/view-model, and client responsibilities explicit.
- Do not pass runtime or server capability objects into Client Components; map them to narrow serializable data.
- Treat Server/Client boundaries, Server Actions, route exports, and related execution boundaries as build-sensitive.
- Keep authorization, policy, validation, and state-transition logic authoritative rather than duplicated.
- For UI work, follow `docs/design-system.md`. Read `docs/collaboration-architecture.md` only when collaboration or realtime boundaries are relevant.

## Risk

- For financial, authorization, lifecycle, concurrency, realtime, or framework-boundary changes, use `zplit-change-risk-review`.
- This is a deterministic Zplit-specific checklist. It does not replace focused tests, real PostgreSQL validation, query review, or authorization review. Devflow coordinates advisory Jev routing; independently verify any actionable signal.
- Run real PostgreSQL tests when correctness depends on transactions, constraints, or lock ordering. Use only an explicitly disposable or designated test database.

## Validation

- Use the narrowest focused tests that exercise the changed ownership boundary and direct consumers. The concrete Zplit commands, database setup, scale environments, and resource-heavy checks live in `docs/testing.md`.
- `npm run check:readability` is authoritative for configured readability rules. Do not weaken or suppress lint, boundary, readability, complexity, or type rules to make validation pass.
- Do not run the full suite or scale fixtures for ordinary changes unless the task requires them; choose the validation tier that matches the changed behavior.

## Repository hygiene

- Keep workflow and documentation changes localized; do not change product behavior while editing the development harness.
