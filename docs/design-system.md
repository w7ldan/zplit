# Zplit design system vNext

Zplit vNext is the page-agnostic UI foundation for future route migrations. It is chunky, clean, playful, tactile, compact, bold, highly interactive, and motion-rich. It should feel unmistakably Zplit without turning every route into the Overview.

This document is canonical for new UI and migrated UI. It defines semantic roles and interaction contracts; page-specific composition remains owned by the route.

## Product character

The personality comes from Sora typography, oversized financial values, strong blue, rounded geometry, asymmetric composition, semantic split layouts, compact alignment, surface contrast, and responsive motion.

It does not come from gradients, shadows, glass, blobs, purple, random accents, excessive icons, fake insights, fake system status, or generic dashboard card grids.

The current header is frozen. Do not redesign, partially migrate, or restyle it as part of a route migration.

## Compatibility boundary

The existing global stylesheet and legacy tokens remain active for unmigrated UI. vNext is opt-in at a page-content root:

```tsx
<section className={`zplit-vnext ${zplitVNextFont.variable}`}>
</section>
```

Use `zplitVNextFont` from `src/app/fonts.ts`. The vNext scope owns its typography and semantic aliases; it must not be applied to `html`, `body`, `.app-shell`, or a header node.

The existing header continues to own its current typography, geometry, navigation, responsive behavior, sticky/detached behavior, animation, and interactions. Do not change the legacy root font or color variables while the header remains frozen.

The Overview is the current proving ground. Its layout, `--overview-*` aliases, runway presentation, choreography, and exact module ratios are not global requirements.

## Typography

Sora is canonical for migrated UI. Use these approximate roles:

- `500`: metadata and secondary information.
- `600`: rows, controls, and actions.
- `800`: headings, financial values, major emphasis, and future wordmarks where appropriate.

New UI must not default to Inter, Geist, Manrope, or serif. The current header typography is intentionally excluded from this rule until its separate migration.

### Financial values

Financial values use Sora ExtraBold or the equivalent `800` weight, tabular numerals, normal or carefully measured tracking, and responsive sizing. Never use aggressive negative tracking.

Static formatted money is the layout authority. It must render with stable `Rp` alignment and separator widths before any enhancement runs. It must never overlap, clip, or depend on `overflow: hidden` to fit.

`AnimatedMoney` is an optional enhancement for prominent values. Its static value reserves the layout and its rolling digits settle exactly to that value. Do not globally animate tiny ledger amounts.

## Semantic palette

Tokens are owned by `src/app/styles/00-foundation.css` and are scoped beneath `.zplit-vnext`. Their implementation names use the `--vnext-*` namespace so legacy descendants inside a partially migrated route do not accidentally consume vNext aliases. Shared interaction contracts are in `src/app/styles/05-vnext-foundation.css`. Use semantic roles rather than page-specific color names.

The core roles are `--vnext-canvas`, `--vnext-paper`, `--vnext-surface`, `--vnext-surface-strong`, `--vnext-surface-warm`, `--vnext-text`, `--vnext-text-soft`, `--vnext-text-quiet`, `--vnext-rule`, `--vnext-accent`, `--vnext-accent-strong`, `--vnext-accent-deep`, `--vnext-link`, `--vnext-debt`, and `--vnext-settled`, with corresponding pale and wash roles.

### Light theme

| Role | Value |
| --- | --- |
| Canvas | `#F3F7F9` |
| Paper | `#FFFFFF` |
| Surface | `#FFFFFF` |
| Surface strong | `#F3F7F9` |
| Warm surface | `#FAF7F1` |
| Text | `#0F1216` |
| Text soft | `#53606B` |
| Text quiet | `#78828B` |
| Rule | `#D8E2E8` |
| Accent | `#72C5F5` |
| Accent strong | `#239FDF` |
| Accent deep | `#0879B8` |
| Link | `#006B9A` |
| Accent pale | `#DAF1FC` |
| Accent wash | `#EBF8FE` |
| Debt | `#D24B35` |
| Debt wash | `#FCEDE8` |
| Settled | `#4E7460` |
| Settled wash | `#EDF5F0` |

### Dark theme

The dark canvas is exactly `#171816`. This value must not change.

| Role | Value |
| --- | --- |
| Canvas | `#171816` |
| Paper | `#1D1E1C` |
| Surface | `#20211F` |
| Surface strong | `#252623` |
| Warm surface | `#211F1B` |
| Text | `#F3F4F1` |
| Text soft | `#B4B9B2` |
| Text quiet | `#878D86` |
| Rule | `#6A726A` |
| Accent | `#72C5F5` |
| Accent strong | `#239FDF` |
| Accent deep | `#0879B8` |
| Link | `#72C5F5` |
| Accent pale | `#1C3440` |
| Accent wash | `#192A32` |
| Debt | `#F0806C` |
| Debt wash | `#35231F` |
| Settled | `#8DB49B` |
| Settled wash | `#202D25` |

Dark mode is the same product, not an inverted aesthetic. The dark rule is slightly lighter than the initial target so it remains a usable boundary when it is the sole non-text control or surface signal. Use surface, surface-strong, warm surface, borders, and spacing to communicate hierarchy. Color supports semantic meaning but never replaces words. Debt and settled washes are backgrounds, not the only state signal.

## Geometry and surfaces

The canonical radius scale is:

- control: `8px`;
- button: `10px`;
- row: `12px`;
- module: `16px`;
- major surface: `20px`;
- overlay: `24px`.

Use rounded geometry without pillifying everything. Do not use slash-cut corners, diagonal notches, or arbitrary clipped shapes.

Surfaces communicate through fill, border, radius, spacing, layout, and typography. Shadows are not part of the vNext default language. Do not add `box-shadow`, `drop-shadow`, glow, offset backing plates, glass blur, or decorative gradients. A future exception requires an explicit design decision.

## Layout

Prefer asymmetric composition, meaningful wide/narrow splits, compact vertical rhythm, strong alignment, responsive recomposition, large values where they matter, and fewer stronger surfaces.

Do not default to three equal KPI cards, four equal cards, uniform dashboard tiles, card-inside-card-inside-card, or equal columns without semantic reason. Page layouts remain free to express the route’s domain.

Dense financial pages should use structured headings, grouped rows, dividers, compact financial alignment, full-row navigation, and responsive row transformations. Do not force dense ledgers into oversized cards.

Authenticated application pages should normally use the available authenticated canvas. Do not arbitrarily make an entire page narrow while substantial usable space remains on the left and right. The authenticated canvas owns the outer page width; constrain individual content based on task type. Narrow content is appropriate for tiny confirmation forms, very short account forms, and single-purpose inputs. Standard content is appropriate for ordinary edit forms and medium-complexity task sections. Wide content is expected for financial detail pages, allocation workspaces, history views, ledgers, long record lists, multi-section detail screens, and dense task workflows. Use the available horizontal space purposefully rather than applying an arbitrary Personal page cap.

## Shared interaction contracts

The shared contracts live in `src/app/styles/05-vnext-foundation.css`. They are opt-in and page-agnostic.

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

## Motion

Motion is part of Zplit’s product identity. Authenticated UI is no longer defined by a restrained or low-motion philosophy, but motion must remain purposeful and settle when untouched.

Use three scales:

- macro: page headings, primary surfaces, major values, supporting sections, and lists;
- meso: section reveals, views, disclosure, progress/runway, insertion/removal, dialogs/sheets, and state transitions;
- micro: hover, focus, press, selection, pointer proximity, route intent, and value change.

Do not make every element use the same generic fade-up. Page-specific choreography owns sequence, stagger, and semantic emphasis. Shared CSS owns durations, easing, focus, press, hover, and reduced-motion contracts. Small React helpers own browser preference, lifecycle-sensitive motion, and stable money rendering. GSAP remains isolated to the public editorial experience.

Use the existing vNext timings as the baseline: `100ms` press, `160ms` fast interaction, `220ms` state, `300ms` layout, `360ms` dialog/sheet, and `640ms` reveal. Prefer transforms, opacity, color, border, and deliberate clip reveals over layout-property animation.

Avoid global pointer listeners, React state updates on every pointer frame, continuous idle loops, random 3D, and rubbery cartoon motion. When untouched, the interface should mostly settle and idle CPU usage should remain low.

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
9. Header last and separately.

Each route migration should opt into `.zplit-vnext`, preserve product and financial semantics, preserve the frozen header, and avoid importing page-specific Overview layout assumptions.
