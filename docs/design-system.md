# Zplit design system

This is the authoritative visual and interaction reference for Zplit. `CURRENT`
describes behavior and styling implemented in the repository. `APPROVED FUTURE
EXTENSION` describes a reusable grammar for collaboration work; it does not
claim that the feature already exists.

## 1. Visual identity

Zplit is clean, sleek, modern, editorial, practical, understated, and
information-clear. Public surfaces can be more expressive; authenticated
ledger UI is denser, calmer, and task-focused. Both modes share the same visual
DNA without sharing the same density or level of expression.

The visual language is built from:

- warm paper and surface roles, with light/dark parity;
- a restrained pastel-blue accent for primary action, selected records, and
  active navigation;
- thin rules and borders;
- strong typography and a clear financial hierarchy;
- restrained square/soft geometry rather than oversized rounding; and
- negative space used deliberately to separate meaning, not to inflate rows.

The current semantic roles are `--paper`, `--surface`, `--ink`,
`--muted-ink`, `--rule`, `--pastel-blue`, `--mint`, `--peach`, `--amber`, and
`--error`. Dark mode remaps these roles in `00-foundation.css`; it is a parity
mode, not a separate visual system. Financial meaning never depends on color
alone.

| Token | Current light value | Use |
| --- | --- | --- |
| Ink | `#111315` | primary text and strong rules |
| Paper | `#F4F1EA` | warm page background |
| Surface | `#FFFEFA` | focused working surfaces |
| Pastel blue | `#C7E4F6` | primary action, active navigation, selected records |
| Muted ink | `#62676B` | supporting text and metadata |
| Rule | `#C8C7C1` | thin dividers and field boundaries |
| Mint / peach / amber | restrained pale tones | settled, secondary, and open context |
| Error | `#B42318` | validation/invariant errors, paired with wording |

The user preference is Light, Dark, or System. It is stored in local storage;
System follows `prefers-color-scheme`; the resolved theme is applied to the
document root and `color-scheme`; and theme-color metadata is updated. Storage
failure falls back to the live selection and does not block product use.

Use the dependency-free system grotesk stack already in source: Arial,
Helvetica Neue, Helvetica, sans-serif. Use tabular numerals for rupiah values
and dates. Authenticated headings, labels, and actions use sentence case;
technical labels may remain compact uppercase labels where the current UI uses
them.

Do not introduce a generic SaaS-dashboard aesthetic, glassmorphism, gradient
blobs, glows, heavy shadows, decorative 3D, fake analytics, excessive pills,
colored “Live” status-dot styling, or unimplemented capability presented as
real.

## 2. Public landing and Journey — CURRENT

The public homepage tells a practical product story. Its product UI is the
illustration: outing labels, expense rows, friend shares, allocation bars,
repayment rows, and settled balances. Public examples are clearly labelled
illustrative scenarios and use whole rupiah values.

The Journey is a keyboard-operable five-step scenario:

1. create an outing;
2. add expenses;
3. assign friend shares manually;
4. record and allocate a repayment; and
5. show a settled friend balance while another outstanding balance remains
   visible.

On wide, sufficiently tall screens, ordinary vertical scrolling drives the
same panels horizontally and direct step controls remain available. On narrow
screens or with reduced motion, the Journey stays readable in a native stacked
layout. Keep this accepted landing/Journey behavior truthful: do not imply
automatic splitting, automatic allocation, notifications, receipt scanning,
debtor actions, or another capability that is not implemented.

## 3. Layout and canvas

The authenticated working canvas is currently:

```css
width: min(calc(100% - 2rem), 76rem);
```

On small screens it uses `calc(100% - 1.5rem)` with the same `76rem` ceiling.
Treat approximately `76rem` as the current maximum, not as permission to add a
new container system.

Use strict shared grid lines. Public/editorial desktop layouts use the
existing 12-column grid; the mobile grid reduces to four columns. Authenticated
page headers, tools, summaries, record rows, metadata, and actions should line
up with one another rather than each inventing an inset.

Page-level surfaces may breathe. Record-management UI stays compact and
rule-led. Avoid unnecessary Y-axis growth: prefer a horizontal composition
when it materially reduces height without harming reading order. Recompose
responsive layouts intentionally before squeezing desktop geometry or allowing
horizontal overflow.

The authenticated shell currently has a compact header. Full ledger navigation
appears from `1200px` upward; below that, the mobile ledger navigation is
available, and the header protects Search, Add expense, and account controls.
The header can become a centered detached panel after the existing scroll
threshold; its full-width wrapper remains transparent and does not paint a
second bar.

Shared/public desktop headers use their three-column grid from `1024px` upward.
On mobile, quick search uses the bordered control with its magnifier icon; the
`/` shortcut remains a desktop affordance. Public and authenticated headers
may share the detached-panel transition while keeping their own density.

Record retrieval is URL-backed. Free-text search is debounced and live,
discrete filters apply immediately, and filter bars remain compact ledger
controls. On mobile, search stays visible while secondary filters may use a
native disclosure; its active-filter count excludes free-text search. Clear
filters remains available whenever filtering is active. Result updates announce
concise matching totals, not entire lists, and record lists use bounded
pagination rather than unbounded loading.

## 4. Spacing and vertical rhythm

There is no new universal token scale to invent. Reuse the tokens and nearby
patterns already in the owning stylesheet. Current relationships include:

- app page layout: `1.5rem` gap and `1.5rem 4rem` block padding, reducing to
  about `1.1rem` gap and `1rem 2rem` padding on mobile;
- page heading to supporting copy: commonly `0.75rem`; page headers close with
  a `1px` rule and about `1rem` bottom padding;
- section to section: commonly `1.5rem` for compact app pages, `2rem` for
  columns, and larger `3–5rem` separation where a detail page deliberately
  changes context;
- form field label to control: about `0.35rem`; ordinary form fields: about
  `0.9rem` apart; repayment-destination fields use the tighter established
  `0.3rem` and `0.85rem` pattern;
- ledger section headings: about `0.75rem` block padding and a `3rem` minimum
  heading row;
- record rows: about `4.75rem` minimum with `0.85rem` block padding, then
  `1rem` block padding on mobile; metadata follows the primary value with about
  `0.9rem` separation on mobile;
- inline actions: use the established `0.5–0.75rem` gaps and keep actions
  visually attached to the row or field they modify; and
- focused surfaces and disclosures: use the existing `1rem` rule/padding
  relationship rather than a new card spacing scale.

These values describe current relationships, not a license for arbitrary
one-off margins. Related elements stay grouped; unrelated sections receive a
stronger rule, border, or larger established separation. Dense ledger rows and
forms must not become oversized.

## 5. Positioning and alignment

Labels, values, metadata, and actions use predictable columns and baselines.
Actions belonging to a record stay in that record’s row on desktop and move
with its metadata when the row reflows. Preserve baseline alignment where it
helps compare financial values and dates.

Use `min-width: 0`, `overflow-wrap: anywhere`, and the existing responsive
recomposition for long names, labels, identifiers, and filenames. List titles
may use the current two-line clamp; detail titles remain readable and
unclamped. Controls must not clip at narrow widths.

Opening and closing a disclosure, task panel, preview, or menu should not
create avoidable layout shift. Preserve the current focus/return path when a
surface closes, and keep a control’s action attached to the surface it opens.

## 6. Controls and geometry

The current foundation defines `6px`, `10px`, `16px`, and `20px` radii. Ordinary
authenticated controls use the `10px` `--radius-control`; focused panels use
the `16px` `--radius-panel`. Authenticated inputs, selects, textareas, and
common action controls currently use a practical `2.75rem` minimum height
(44px). Public primary action links retain the larger `3.25rem` treatment.

Distinguish the treatments:

- ordinary controls are bordered, readable, and surface-backed where the
  authenticated form pattern calls for it;
- compact row actions are smaller text/arrow links, with the established
  `2.75rem` row-edit target where that pattern is used;
- focused forms and task panels use the surface role, clear borders, and
  enough padding to review values; and
- destructive actions stay explicit and actionable, use error wording paired
  with structure, and disclose dependent impact before confirmation.

Use practical targets already established by source. Do not prescribe giant
rounded controls, pill-shaped rows, or a new control library.

## 7. Forms and progressive disclosure — CURRENT

Large optional creation/edit forms may default collapsed when the surrounding
workflow benefits from a compact page. The current repayment-destination UI is
the reference pattern:

- an explicit `New destination` or `Edit` action opens one inline disclosure;
- create and edit disclosures are mutually exclusive;
- `Cancel` returns focus to the opening action, and `Save` uses a clear
  mode-specific label;
- validation failure keeps the relevant form open and preserves returned
  values; and
- a successful save returns the page to its appropriate compact state.

Use this pattern for comparable optional editors. Avoid multiple competing
editors or disclosures when one-at-a-time behavior is clearer. Use the native
`dialog` task-panel pattern only when the interaction genuinely needs a modal
task surface, such as a focused new-record flow; do not turn ordinary inline
editing into a modal by default.

Existing progressive disclosure also applies to optional create-time fields,
expense charges, repayment allocation detail, and mobile secondary filters.
Returned values and validation errors reveal the containing disclosure.

Prerequisite creation preserves the owner’s original task and returns
automatically. Creating the prerequisite Friend from Add repayment returns to
Repayment entry with that Friend selected. Saved expense charges open by
default, empty charge tools stay collapsed, and collapsing preserves drafts.
Repayment allocation keeps Available visible while per-row arithmetic details
stay collapsed until requested. Edit forms remain direct when hiding controls
would obstruct review.

Destructive ledger actions follow ownership boundaries: an Outing owns its
Expenses, an Expense owns its receipts and shares, and a Repayment owns its
allocation links. Cascades disclose their impact before controls, and
dependent data needs an extra explicit confirmation. Deleting an Expense or
allocation link never silently deletes the Repayment; released allocation is
reassigned where safe and any unreconciled remainder becomes unallocated for
review. The recorded Repayment amount stays unchanged, and server confirmation
uses current transactional impact rather than client counts.

## 8. Searchable selection — CURRENT

The searchable combobox contract is strict:

- the selected ID is the submitted value;
- the selected label is display-only;
- the search query is temporary popup-only state; and
- arbitrary search text must never become the selected or submitted value.

Keep the current progressive-enhancement native `<select>` fallback, the
non-editable selected-value trigger, keyboard navigation, pointer selection,
focus restoration, and mobile-safe popup containment. The popup may portal to
the document or an enclosing dialog, sizes to the trigger, and chooses an
available up/down placement inside clipping and visual-viewport boundaries.
Search remains debounced (`120ms` in the current hook), results are capped at
20, and stale requests cannot overwrite newer results. Preserve loading,
empty, error, archived-grouping, disabled, and required states.

## 9. Entity and record presentation

### Current records

Ledger/record rows are compact, rule-led, and information-dense. Friends,
Outings, Expenses, and Repayments use a primary value plus aligned metadata,
amount/date/state hierarchy, and a row-local action. Desktop rows use explicit
columns from the established breakpoint; below that they stack the primary
content, metadata, and actions intentionally. Ledger rows are not generic
rounded cards.

Entity browsing cards are allowed when discovery benefits from them, but cards
are not a default replacement for financial rows.

### Approved future entity-card grammar

Groups and Organizations are not implemented in the current UI. When future
collaboration features introduce entity browsing cards, use this approved
grammar, compatible with `docs/collaboration-architecture.md`:

```text
[avatar/media] [details]
```

Cards should be compact and horizontal, with avatar/media on the left and
details on the right; have a low Y-axis footprint; use restrained border and
surface treatment; and live in a responsive grid targeting four columns on
wide desktop and intentionally reducing columns at narrower widths. Details
may carry the entity name, role, member count, permitted attention/financial
summary, or useful unread state. Do not use tall image-above-content SaaS
cards.

This is an approved reusable design grammar, not a claim that Groups,
Organizations, avatars, or their cards already exist.

## 10. Reorder interactions — CURRENT

The repayment-destination list is the reference for simple list reordering:

- a drag handle may enhance pointer reordering;
- the entire row is not draggable unless a future interaction justifies it;
- explicit keyboard/accessibility controls such as Move up and Move down remain
  available;
- drag/drop feedback is restrained to opacity and a rule at the target;
- order updates may be optimistic, but a failed save restores the confirmed
  order and exposes an actionable error; and
- a simple list does not need a dependency-heavy drag system.

## 11. Feedback and toasts

Feedback confirms meaningful actions; it does not narrate obvious state. Current
success feedback is concise, transient, and either an in-page status or a
toast chosen for the workflow. Errors remain visible long enough to act on,
name the failed operation, and offer a recovery path where one exists.

The current toast system is a bounded, polite status surface: it shows no more
than two visible toasts, defaults to a transient lifetime, pauses while hovered
or focused or while an action is pending, and moves the stack without shifting
the page. Keep toast copy short and avoid spam. Do not duplicate the same
success message in multiple simultaneous surfaces without a reason.

Future realtime updates must use the same restraint: announce meaningful
changes or attention, not every transport event.

## 12. Modals, previews, and viewport safety

Receipt and payment-proof previews use a bounded overlay. The current preview:

- fits within `100dvh` with a responsive gutter;
- keeps its header, close control, body, and footer inside the surface;
- contains oversized content in a scrolling body with `overscroll-behavior:
  contain`;
- preserves image aspect ratio and uses viewport-safe maximum dimensions;
- keeps Open original and Download reachable; and
- traps focus, makes the background inert, restores scroll state, and returns
  focus to the trigger on close.

The current task panel similarly contains its body; on mobile it becomes a
bottom sheet capped at `90dvh` and includes safe-area padding. Narrow/mobile
viewports must remain usable. Avoid page-level overflow traps when a bounded
surface can contain the content.

## 13. Motion

Motion is purposeful and restrained. Use small hover, press, focus, insertion,
completion, and state transitions to explain hierarchy or change. Current
utility/state timings are roughly `100–220ms`, layout/state transitions
`220–360ms`, and public reveals `500–750ms`; the Journey remains below `900ms`.

Authenticated motion favors state feedback and continuity over spectacle. It
may cover active navigation, task panels, small row insertion, changed values,
allocation bars, affected records, and concise save confirmation. Frequent
financial input remains immediate. Public landing motion may be more
expressive than authenticated ledger UI, including the accepted Journey
behavior.

Reduced-motion alternatives are required. Under
`prefers-reduced-motion: reduce`, remove translation, scaling, clipping travel,
staged sequences, and movement of values while preserving immediate state,
visibility feedback, keyboard focus, and full Journey operation. Avoid
excessive displacement, springiness, ornamental movement, fake loaders,
perpetual animation, scroll hijacks, and routine text scrambling.

## 14. Iconography and identity visuals

### Current direction

Icons are subordinate to typography and financial hierarchy. Use restrained,
geometric, Zplit-compatible forms with consistent optical size and stroke.
Keep icon treatment quiet and do not mix arbitrary icon families.

### Approved future extensions

The future custom Inbox SVG and avatar system must follow the same restrained
geometric grammar, pastel-accent language, and light/dark compatibility. These
are approved future extensions, not current implemented UI.

Future deterministic default avatars should derive consistently from an entity
ID and look native to Zplit: geometric/editorial, restrained, and useful at
small sizes. They must not look like third-party avatar-service art,
cartoon/generated SaaS art, random emoji, a generic silhouette, or only a
colored initials circle. Uploaded identity media may replace a default when
that future feature exists.

## 15. Responsive rules

Desktop, tablet, and mobile are deliberate compositions:

- no horizontal overflow, clipped focus borders, or clipped controls;
- touch targets remain usable, and important actions do not depend only on
  hover;
- grids reduce columns intentionally rather than squeezing desktop columns;
- the current authenticated shell uses the full navigation at `1200px+`,
  mobile navigation below that, and mobile header reflow at `767px`;
- record rows and metadata move into a readable stacked order on narrow widths;
  and
- dense financial information retains labels, amounts, dates, and state
  hierarchy on mobile.

Long labels, names, identifiers, and filenames wrap or clamp only where the
current source establishes that tradeoff. Controls must remain fully
reachable.

## 16. Accessibility

Use semantic links, buttons, form controls, headings, lists, and native
disclosures where they express the interaction. Provide full keyboard access,
visible focus, useful accessible names, and correctly associated labels and
errors. Use ARIA only where the semantic/native element does not provide the
needed state or relationship.

Do not use color as the only meaning. Drag interactions require an explicit
non-drag fallback. Searchable selectors retain the native fallback. Dialogs and
previews manage focus and background inertness. Motion respects reduced-motion
preferences. Future realtime updates must avoid disruptive announcement spam.

## 17. CSS ownership

`src/app/globals.css` is the root manifest. Its six imports are ordered and
form part of the cascade contract:

- `00-foundation` owns tokens, browser baseline, document defaults, shared
  primitives, and shared controls;
- `10-public` owns the public shell, navigation, landing composition, access
  presentation, and informational surfaces;
- `20-authenticated-shell` owns the authenticated shell, navigation, app
  scaffolding, and early authenticated layout rules;
- `30-records-and-forms` owns record rows, detail views, forms, filters, and
  progressive disclosure in its source-order layer;
- `40-motion-and-feedback` owns task panels, result states, keyframes, and
  reduced-motion rules; and
- `90-late-overrides` owns genuine late overrides still required by source
  order, including documented legacy cascade boundaries.

First-class feature styles belong in their semantic layer. `90-late-overrides`
is not a dumping ground. Moving a rule between fragments needs proof of
cascade equivalence; visual cleanup and deduplication are separate reviewed
changes. Public and authenticated UI may share visual DNA while deliberately
using different expressiveness and density.

## 18. Document authority

`docs/design-system.md` governs visual and interaction design: identity,
layout, geometry, spacing, responsive behavior, accessibility, motion, and
the boundaries between current patterns and approved future visual extensions.

`docs/collaboration-architecture.md` governs collaboration/product/accounting
semantics, information architecture, permissions, identity, realtime meaning,
and future collaboration-specific behavior. It should reference and follow
this design system without turning future product semantics into current UI.

Future implementation prompts must follow both documents. If a product
requirement introduces a genuinely new UI family, extend this design system
intentionally and place the styles in their semantic CSS layer instead of
inventing an isolated visual language.
