# Zplit design system vNext

Zplit vNext is the page-agnostic UI foundation for future route migrations. It is precise, architectural, tactile, compact, information-clear, and financially legible. It should feel unmistakably Zplit without turning every route into a generic dashboard.

This document is canonical for new UI and migrated UI. It defines semantic roles and interaction contracts; page-specific composition remains owned by the route.

## Product character

The personality comes from Sora typography, strong financial hierarchy, asymmetric composition, semantic split layouts, compact alignment, surface contrast, tactile rules, and responsive motion. Technical Brutalism and Tonal Minimalism are the governing visual directions: structure, typography, borders, and tonal layers do the work.

It does not come from gradients, shadows, glass, blobs, purple, random accents, excessive icons, excessive pills, fake insights, fake system status, generic dashboard card grids, or a generic SaaS-dashboard aesthetic.

Current Zplit colors are authoritative. The supplied design specification is authoritative for typography, layout, density, geometry, borders, interaction, and responsive composition, but its literal color values are not copied into the product. Migrated routes consume the existing semantic palette from `src/app/styles/00-foundation.css`.

The authenticated header is a completed vNext surface. Route migrations must treat it as the shared product control bar and must not introduce page-specific header variants.

## Compatibility boundary

The existing global stylesheet and legacy tokens remain active for unmigrated UI. vNext is opt-in at a page-content root:

```tsx
<section className={`zplit-vnext ${zplitVNextFont.variable}`}>
</section>
```

Use `zplitVNextFont` from `src/app/fonts.ts`. Page content uses the `.zplit-vnext` scope for typography and semantic aliases. The authenticated header has its own canonical owner, `src/app/styles/60-authenticated-header-vnext.css`, and consumes the same semantic palette without applying the page scope to `html` or `body`.

The authenticated header owns its typography, geometry, navigation, responsive behavior, sticky/detached behavior, animation, and utility interactions. Public headers remain separately owned. Do not change the legacy root font or color variables to style either surface.

The Overview is the current proving ground. Its layout, `--overview-*` aliases, runway presentation, choreography, and exact module ratios are not global requirements.

## Authenticated header

The authenticated shell currently has a compact header. The authenticated header is a compact, tactile Zplit control bar with three deliberate zones: global product identity, primary navigation, and utilities. Its inner composition aligns to the authenticated canvas; its detached treatment may span the viewport background but must not create a second page hero or shift page content.

Use solid semantic surfaces, tactile borders, controlled radii, and the existing blue accent family. The header has no glass, gradient, or shadow dependency. The active route remains obvious across nested routes, while inactive navigation stays quiet rather than turning every destination into a pill.

The header owns the entry points for GlobalSearch, Inbox, and the account menu. Inbox exposes its canonical unread count and destination. The account menu preserves current identity, Settings, appearance, conditional Invitations, History, Exports, and sign-out actions.

GlobalSearch is the one authoritative Search experience. It is a compact navigational dialog owned by the authenticated header, with dense semantic result rows, one destination focus target per row, meaningful no-query/loading/no-results states, and preserved query authorization and keyboard behavior.

Responsive navigation keeps the core domains discoverable. On mobile, search stays visible in the top utility row. At medium and narrow widths, a visible secondary row may scroll horizontally when needed; it must remain keyboardable, touch-usable, free of page overflow, and clear about the active destination. Search, Inbox, and account remain reachable in the top row.

## Typography

Sora is canonical for migrated UI. Use these approximate roles:

- `500`: metadata and secondary information.
- `600`: rows, controls, and actions.
- `800`: headings, financial values, major emphasis, and future wordmarks where appropriate.

New UI must not default to Inter, Geist, Manrope, or serif. The authenticated header uses the same Sora family and weight hierarchy through its dedicated owner.

### Financial values

Financial values use Sora ExtraBold or the equivalent `800` weight, tabular numerals, normal or carefully measured tracking, and responsive sizing. Never use aggressive negative tracking.

Static formatted money is the layout authority. It must render with stable `Rp` alignment and separator widths before any enhancement runs. It must never overlap, clip, or depend on `overflow: hidden` to fit.

`AnimatedMoney` is an optional enhancement for prominent values. Its static value reserves the layout and its rolling digits settle exactly to that value. Do not globally animate tiny ledger amounts.

## Semantic palette

Tokens are owned by `src/app/styles/00-foundation.css` and are scoped beneath `.zplit-vnext`. Their implementation names use the `--vnext-*` namespace so legacy descendants inside a partially migrated route do not accidentally consume vNext aliases. Shared interaction contracts are in `src/app/styles/05-vnext-foundation.css`. Use semantic roles rather than page-specific color names.

The core roles are `--vnext-canvas`, `--vnext-paper`, `--vnext-surface`, `--vnext-surface-strong`, `--vnext-surface-warm`, `--vnext-text`, `--vnext-text-soft`, `--vnext-text-quiet`, `--vnext-rule`, `--vnext-accent`, `--vnext-accent-strong`, `--vnext-accent-deep`, `--vnext-link`, `--vnext-debt`, and `--vnext-settled`, with corresponding pale and wash roles.

### Theme implementation

Light and dark values remain implementation details of the current Zplit semantic tokens. Do not add route-local color literals or replace those tokens with values copied from a design reference. Use the same roles in both themes: canvas, paper, surface, strong surface, warm surface, text, quiet text, rule, accent, debt, settled, and their washes. Color supports semantic meaning but never replaces words; debt and settled washes are backgrounds, not the only state signal.

## Geometry and surfaces

The canonical shape language is restrained rather than pill-shaped. Controls and buttons use small radii, principal modules use a restrained medium radius, and overlays may be slightly larger. The migrated Budget family uses a local `4px / 8px / 12px` scale for controls, modules, and overlays while continuing to consume the shared semantic color tokens.

Use rounded geometry without pillifying everything. Do not use slash-cut corners, diagonal notches, or arbitrary clipped shapes.

Surfaces communicate through fill, border, radius, spacing, layout, and typography. Shadows are not part of the vNext default language. Do not add `box-shadow`, `drop-shadow`, glow, offset backing plates, glass blur, or decorative gradients. A future exception requires an explicit design decision.

## Layout

Prefer asymmetric composition, meaningful wide/narrow splits, compact vertical rhythm, strong alignment, responsive recomposition, large values where they matter, and fewer stronger surfaces.

Do not default to three equal KPI cards, four equal cards, uniform dashboard tiles, card-inside-card-inside-card, or equal columns without semantic reason. Page layouts remain free to express the route’s domain.

Dense financial pages should use structured headings, grouped rows, dividers, compact financial alignment, full-row navigation, and responsive row transformations. Ledger rows are not generic dashboard cards; do not force dense ledgers into oversized cards.

Support surfaces have distinct information grammars: Settings is a management workbench, Inbox is a compact action queue, and Search is a dense grouped-results surface. Their shared vNext foundation should not flatten them into one generic card layout. Form width belongs to the form or task section, not the authenticated page shell.

Authenticated application pages should normally use the available authenticated canvas. Do not arbitrarily make an entire page narrow while substantial usable space remains on the left and right. The authenticated canvas owns the outer page width; constrain individual content based on task type. Narrow content is appropriate for tiny confirmation forms, very short account forms, and single-purpose inputs. Standard content is appropriate for ordinary edit forms and medium-complexity task sections. Wide content is expected for financial detail pages, allocation workspaces, history views, ledgers, long record lists, multi-section detail screens, and dense task workflows. Use the available horizontal space purposefully rather than applying an arbitrary Personal page cap. Personal vNext page composition is owned by `src/app/styles/35-personal-vnext.css`, loaded after the legacy record/form layer; it must use the authenticated canvas and local narrow or standard constraints only where the content requires them.

Capability-adaptive composition is structural: conditionally render controls, sections, and inspector rails only when the current capability grants access to their content. A read-only surface should expand into the space an unavailable mutation rail would have occupied; it should not display disabled-looking placeholders or preserve dead columns for visual symmetry.

## Shared interaction contracts

The shared contracts live in `src/app/styles/05-vnext-foundation.css`. They are opt-in and page-agnostic.

Shared primitives own their visual identity. Route styles may place a primitive in a layout, but must not redefine its dimensions, icon treatment, border, radius, hover state, or motion. Migrated routes use semantic structural classes instead of broad descendant selectors such as `> span`, `:last-child`, or `nth-child()` for component identity. Legacy selectors remain available only where unmigrated routes still depend on them.

### Navigable rows

The entire row is one hit target. Use one semantic link or button as the row root:

- desktop hover and pointer response apply across the row;
- mobile uses a full-row tap target with a practical touch height;
- keyboard users receive exactly one logical focus target;
- row feedback uses fill, border, and a small press compression without requiring precision clicking.

### Open Tile

`OpenTile` is the visual cue: an arrow-up-right inside a compact rounded square. The containing row or link is the actual control. The tile is `aria-hidden`, must not be separately tabbable, and must not have its own click handler.

Allowed feedback includes tile fill, arrow translation, and a tightly damped return.

Standalone destination and record actions should be concise and self-contained. Use the shortest unambiguous label, such as “Edit”, “Back”, “Save”, “Delete”, “Archive”, “Personal”, “Expenses”, or “Repayments”. One action is one control; if an icon adds genuine clarity, it belongs inside that same control. Do not place a second adjacent arrow control representing the same destination. A navigable list row may retain the `OpenTile` visual cue when the entire row is the actual link, `OpenTile` is not separately focusable, and it is not a second click target.

### Text links

Section navigation such as “View all”, “History”, “Open Personal”, and “Set up” uses text and `600` weight with a restrained animated underline or directional treatment. Do not require a chevron or arrow on every link.

### Buttons

Buttons use tactile feedback through fill interpolation, local pointer response where genuinely useful, label translation, press compression, tight spring-like return, and crisp focus. No shadow is required.

### Forms

Future migrated forms inherit strong labels, rounded controls, compact grouping, excellent focus, clear validation, tactile controls, animated state changes, and strong primary actions. Avoid floating-label gimmicks, excessive helper prose, and unnecessary nested cards.

### Status UI

Descriptive state is not decorative chrome. Prefer normal metadata or text for “Active”, “Current”, “Admin”, “Member”, “Settled”, “Synced”, “Live”, “Healthy”, permissions, and recency. Examples include `Admin · 18 members`, `Settled`, and `Pending confirmation`.

Pills remain valid for genuinely interactive filters, segmented choices, selections, and appropriate toggles. Do not add decorative status dots for online, active, synced, settled, permission, health, or recency states unless a future feature truly requires that signal.

## Financial semantics

UI styling must preserve domain distinctions. Never silently net separate concepts, invent global totals across unrelated domains, or use color as a replacement for words.

Use clear labels such as:

```text
You owe
Rp250,000

Owed to you
Rp480,000
```

No design-system change may alter financial logic, permissions, lifecycle semantics, or authoritative state transitions.

## Budget family

The Personal Budget routes share one financial workspace language across Overview, Transactions, Period history, and Recurring. Use the available authenticated canvas with an asymmetric workbench, dense ledger rows, tactile 1px rules, tabular amounts, compact actions, and clear separation for Shared Money. Remaining is the primary current-period value; Total budget, Net spent, Safe daily, date ranges, category allocation, transaction provenance, recurring planning, and period lifecycle remain subordinate but explicit.

Budget navigation is a reusable semantic rail with `aria-current="page"`. Category, transaction, recurring, and period rows use named identity, amount, and action regions so layout is resilient to content length and does not depend on child order. Planned recurring records remain visually distinct from posted transactions. Empty and invariant states stay concise and truthful.

## Motion

Motion is part of Zplit’s product identity. Authenticated UI is no longer defined by a restrained or low-motion philosophy, but motion must remain purposeful and settle when untouched.

Use three scales:

- macro: page headings, primary surfaces, major values, supporting sections, and lists;
- meso: section reveals, views, disclosure, progress/runway, insertion/removal, dialogs/sheets, and state transitions;
- micro: hover, focus, press, selection, pointer proximity, route intent, and value change.

Do not make every element use the same generic fade-up. Page-specific choreography owns sequence, stagger, and semantic emphasis. Shared CSS owns durations, easing, focus, press, hover, and reduced-motion contracts. Small React helpers own browser preference, lifecycle-sensitive motion, and stable money rendering. GSAP remains isolated to the public editorial experience.

Use the existing vNext timings as the baseline: `100ms` press, `160ms` fast interaction, `220ms` state, `300ms` layout, `360ms` dialog/sheet, and `640ms` reveal. Prefer transforms, opacity, color, border, and deliberate clip reveals over layout-property animation.

Avoid global pointer listeners, React state updates on every pointer frame, continuous idle loops, perpetual animation, random 3D, and rubbery cartoon motion. When untouched, the interface should mostly settle and idle CPU usage should remain low.

### Reduced motion

`prefers-reduced-motion: reduce` is mandatory. Remove or reduce rolling digits, major translations, parallax, magnetic effects, spring overshoot, and long choreography. Preserve all information and functionality. Browser-driven animations must cancel and settle when the preference changes at runtime.

### Lists and overlays

React owns list presence and stable keys. CSS owns ordinary opacity and transform transitions. Exiting content remains mounted until its exit completes, with a bounded fallback. FLIP is a local solution for a genuinely complex reorder, not a global manager.

Dialogs and sheets use opaque solid surfaces, clear hierarchy, compact spacing, strong action placement, appropriate focus management, and quick translate/clip/scale motion. Desktop panels may enter from the side; mobile sheets may enter from the bottom. No glass or shadow dependency.

### Empty states and progress

Keep empty states compact: a clear heading, one useful sentence when needed, a clear action, and appearance motion. Do not fill space with meaningless illustration.

Progress and runway components must expose the correct semantic meter or progress information. Visual treatments such as crosshairs, seams, and pointers remain page-specific.

## Migration order

Migrate incrementally:

1. Foundation and scoped tokens.
2. Shared primitives and interaction contracts.
3. Personal.
4. Budget.
5. Groups.
6. Organizations.
7. Settings, Inbox, and remaining authenticated pages.
8. Public and auth surfaces if desired.
9. Header last and separately, as the shared authenticated control bar.

Each route migration should opt into `.zplit-vnext`, preserve product and financial semantics, use the shared authenticated header contract, and avoid importing page-specific Overview layout assumptions.
