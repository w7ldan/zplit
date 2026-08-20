# Changelog

This is a curated history of meaningful Zplit product, system, security, and operational changes. Git remains the source of truth for commit-level detail. The history below follows the repository from its root commit through the current application checkpoint.

## 2026-08-20 — Correctness, themes, and final UI alignment

### Added

- Persistent Light, Dark, and System theme preferences, dark semantic tokens, and route-specific page titles.
- Delete-time repayment-allocation reconciliation: removing expense shares releases money, reallocates it to eligible older shares for the same friend, and leaves any remainder explicitly unallocated.
- Allocation explanations, paginated repayment allocation choices, QR balance-link sharing, and clearer Copy/Preview/share state.

### Changed

- Completed the ledger repository modularization: read and mutation concerns were split into ledger modules behind the existing owner-scoped facade, then exports were tightened.
- Reduced authenticated CSS debt and clarified fragment ownership while preserving responsive detail/list hierarchy.
- Improved mobile numeric entry, long-record layouts, empty states, statement layout, trip and overview composition, friend detail, expense charges, repayment allocation spacing, and authenticated page toolbars.
- Reduced ledger editing density by progressively disclosing optional split charges and moving repayment allocation arithmetic into per-row details.
- Improved mobile Search discoverability with a magnifier icon and kept the authenticated header compact through intermediate widths so account controls remain usable.

### Fixed

- Stabilized global quick search and friend history actions.
- Completed receipt preview accessibility and kept deletion/share changes understandable in the affected records.

## 2026-08-18–19 — Searchable records and richer repayment workflows

### Added

- Searchable selectors with bounded results and selected-value retention, followed by URL-backed record pagination and shared balance-history pagination.
- Payment-method recording and display, repayment allocation strategies (`manual`, `oldest`, and `newest`), contextual repayment shortcuts, and reusable expense split helpers.
- Named percentage charges for all or selected friends, with charge-aware share calculations.
- Record-detail history, global quick search across ledger records, amount search, recent-choice prioritization, and trip financial rollups.
- Receipt viewing improvements and payment-method context on shared balances.

### Changed

- Friend split entry, repeated expense entry, repayment allocation selection, save follow-through, and unsaved-change protection were tightened around the actual ledger workflow.
- Allocation removal and reusable split edits gained guarded undo behavior; full repayment allocation edits were recalculated against current share capacity.

### Fixed

- Hardened searchable selectors, task-panel clipping, shared dates in global search, and the final receipt/task-panel presentation details.

## 2026-08-07–09 — Trips and the product journey

### Added

- Production-scale acceptance on top of the disposable scale fixture, with database budgets and a no-browser production runtime check.
- Undo for friend archiving and allocation removal, contextual ledger entry, financial-clarity explanations, and a more consolidated authenticated ledger layout.
- Trip grouping integrated into Outings and exposed trip relationships in the ledger.
- A separately routed showcase hostname and a scale-backed showcase runtime.

### Changed

- Authenticated motion was reworked around state feedback, continuity, and reduced-motion behavior. Public journey choreography became a continuous, pinned, scroll-linked ledger story with a clearer terminal payoff and stronger ledger physicality.
- Mobile landing access, ledger clarity, allocation selection, and showcase development-origin behavior were stabilized as the journey became more interactive.

## 2026-08-06 — Release hardening and scale foundations

### Added

- Confirmed destructive ledger cascades with impact revisions, transactional dependent-record handling, and affected-repayment revalidation.
- Neutral-edge deployment contracts, release proxy/rollback checks, migration-journal-aware backup verification, and the move from direct ingress ownership to the neutral edge.
- Local-time month handling, realistic disposable scale data, valid fixture receipts, bounded overview/recent-activity queries, bounded record pages, scalable selectors, and the showcase capture fixture.

### Changed

- Unified public and authenticated headers and aligned the mounted Caddy route, Cloudflare client-IP handling, mobile header, app icon, and detached navigation shell.
- Release checks grew to cover private-route caching/indexing behavior, public metadata, health, and the service-worker/PWA surface.

## 2026-08-05 — Private data, history, PWA, and bounded retrieval

### Added

- Ledger history, guarded deletion, CSV exports, share-ready reminders, private PostgreSQL receipt storage, and an installable PWA with an offline fallback that does not expose financial records.
- Privacy-safe social previews and a live record-retrieval system with URL-backed search, filters, pagination, and native mobile filter fallback.

### Changed

- Navigation, showcase interactions, record entry, reduced-motion behavior, task-panel closing, and authenticated shell geometry were refined through the first full product pass.
- CSS ownership was formalized into ordered fragments, unused styling scaffolding was removed, and the browser baseline was made explicit.
- Overview activity and retrieval candidates were bounded for predictable work at larger ledger sizes.

### Security / Operations

- Backups gained verified custom-format archives, metadata manifests, disposable restoration checks, and migration-integrity validation.
- Production security and release contracts covered edge headers, private route behavior, and rollback boundaries.

## 2026-08-04 — Core ledger and invite-only access

### Added

- Owner-scoped Friends, Outings, outing-bound Expenses, manual friend shares, the ledger overview, Repayments, and Repayment Allocations.
- A public root route, invite-only account registration, one-time invitation handling, and temporary read-only debtor balance links.

### Changed

- The authenticated and public experiences were overhauled around the editorial design system, then stabilized around practical record entry, navigation, and access behavior.

### Security / Operations

- Multi-account isolation was enforced throughout the ledger, and invitation acceptance was hardened around one-time claims and normal Better Auth credential accounts.

## 2026-08-03 — Project bootstrap

### Added

- The initial Next.js web application, Docker deployment shape, PostgreSQL/Drizzle data foundation, and environment-driven server configuration.
- The editorial design system, single-owner authentication, and the first owner-isolation model for ledger data.

### Security / Operations

- The private web upstream and database-backed application boundary were established, including the dependency override used during the initial Next.js security hardening.
