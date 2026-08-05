# Zplit design system

Zplit uses expressive editorial utility in public surfaces: 65% clarity, 25% editorial expression, and 10% controlled spectacle. The authenticated product remains denser and more task-focused: 85% functional clarity, 12% editorial personality, and 3% controlled spectacle.

## Product direction

The public homepage tells a practical product story. Product UI is the illustration: outing labels, expense rows, friend shares, allocation bars, repayment rows, and settled balances. Public examples are clearly labelled illustrative scenarios and use whole rupiah values.

The public interactive journey is a keyboard-operable five-step scenario. On wide screens, ordinary vertical scrolling drives the same panels horizontally; direct step controls remain available. On narrow screens and under reduced motion, the panels stay readable in a native stacked layout:

1. An outing is created.
2. Expenses enter the outing.
3. Friend shares are assigned manually.
4. A repayment is recorded and allocated.
5. A friend balance becomes settled while any other outstanding balance remains visible.

The example must stay truthful to the application. Zplit does not imply automatic splitting, automatic allocation, notifications, receipt scanning, debtor actions, or other capabilities that are not implemented.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#111315` | Primary text and strong rules |
| Paper | `#F4F1EA` | Warm public background |
| Surface | `#FFFEFA` | Focused working surfaces |
| Pastel blue | `#C7E4F6` | Primary action, active navigation, selected records |
| Muted ink | `#62676B` | Supporting text and metadata |
| Rule | `#C8C7C1` | Thin ledger dividers and field boundaries |
| Mint | restrained pale mint | Settled or confirmed financial context |
| Peach | restrained pale peach | Secondary contextual emphasis |
| Amber | restrained pale amber | Unallocated or still-open financial context |
| Error | `#B42318` | Validation and invariant errors, always paired with wording |

Semantic color is never the only signal. Financial state also uses text, labels, rules, and structure. Do not use status dots, gradients, glow, glass, or decorative blobs.

## Typography and geometry

Use the dependency-free system grotesk stack: Arial, Helvetica Neue, Helvetica, sans-serif. Use tabular numerals for rupiah values and dates. Use sentence case for authenticated headings, labels, and actions.

Public composition uses a disciplined grid, thin rules, warm paper, surface white, pastel blue, and moderate tactile geometry. Controls use `10–12px` radii and practical 44px minimum targets. Focused product frames and task panels use `14–16px` radii. Ledger rows stay open and rule-based rather than becoming card mosaics.

The public mode is spacious enough to explain the product but keeps the hero action and product object visible in the first viewport. Public pages may use expressive editorial scale; authenticated list pages prioritize task density. The authenticated mode is compact, surface-white, and task-first. These are separate density modes, not competing page templates.

Record retrieval is URL-backed: free-text search is debounced and live, discrete filters apply immediately, and filter bars remain compact ledger controls. On mobile, search stays visible while secondary list filters may use a native disclosure; its active-filter count excludes free-text search. Clear filters remains available whenever filtering is active. Result updates announce concise matching totals, not entire ledger lists. Record lists use bounded pagination rather than unbounded loading.

## Entry-flow rules

- Prerequisite creation preserves the owner’s original task and returns automatically.
- Creating the prerequisite Friend from Add repayment returns automatically to Repayment entry with that Friend selected.
- Optional create-time fields use native progressive disclosure.
- Returned values and validation errors reveal their containing disclosure.
- Edit forms remain direct when hiding controls would obstruct review.

## Destructive ledger actions

Database cascades model true ownership: an Outing owns its Expenses, an Expense owns its receipts and shares, and a Repayment owns its allocation links. Destructive cascades always disclose their impact before the controls, and dependent data requires an extra explicit confirmation.

Deleting an Expense allocation link never silently deletes the Repayment. The repayment remains and its removed amount becomes unallocated. Server confirmation is based on current transactional impact, not client counts.

## Motion

Public motion uses one short non-blocking opening fade, restrained bottom-to-top text reveals, interaction feedback, and the wide-screen journey’s scroll-linked panel movement. Utility timing is `100–220ms`; layout and state timing is `220–360ms`; public reveal is `500–750ms`; journey transitions stay below `900ms`. Content is rendered immediately, there are no fake loaders, scroll hijacks, perpetual animations, or routine text scrambling. Navigation may become a detached surface after a small scroll threshold, using one restrained shadow for separation. Authenticated sticky navigation remains geometrically stable while scrolling; it may change surface emphasis but does not change width, position, alignment, or radius.

Authenticated motion is denser and spends approximately 80% on state feedback, 17% on orientation and continuity, and 3% on delight. It is limited to active navigation, task panels, small row insertion, changed values, allocation bars, affected records, and concise save confirmation. Authenticated pages do not use cinematic heading reveals or decorative background motion.

The authenticated sticky header reserves its document space transparently. Only the centered bordered navbar owns the opaque surface, rounded geometry, pointer interaction, and detached shadow; the wrapper never paints a full-width strip or intercepts content outside the panel.

Motion communicates insertion, completion, state change, or spatial entry/exit. Frequent financial inputs remain immediate. Reduced motion removes spatial effects while preserving useful state and visibility feedback.

Under `prefers-reduced-motion: reduce`, remove translation, scaling, clipping travel, staged sequences, and movement of values. Preserve immediate state changes, short opacity feedback where useful, keyboard focus, and full journey operation.

## CSS architecture

`globals.css` is the single root stylesheet manifest. Its six fragment imports are ordered and therefore part of the cascade contract:

- `00-foundation.css` owns tokens, the browser baseline, document defaults, and shared primitives and controls.
- `10-public.css` owns the public shell, navigation, landing composition, access presentation, and informational surfaces.
- `20-authenticated-shell.css` owns the authenticated shell, navigation, app scaffolding, and early authenticated layout rules.
- `30-records-and-forms.css` owns record rows, detail views, forms, filters, and progressive disclosure where those rules occur in source order.
- New record-filter and mobile-disclosure rules belong in `30-records-and-forms.css`, not the late-override quarantine.
- `40-motion-and-feedback.css` owns task panels, result states, keyframes, and reduced-motion rules.
- `90-late-overrides.css` preserves existing source-order-sensitive debt, including later public journey and late filter rules.

Add new rules to their owning fragment. Unrelated new rules must not be appended to `90-late-overrides.css`. Moving a rule between fragments requires proof of cascade equivalence; visual cleanup and deduplication belong in separate reviewed checkpoints.

## Prohibited patterns

Avoid generic SaaS dashboards, generic rounded cards, excessive pills, colored status dots, glassmorphism, gradient blobs, glowing effects, heavy shadows, decorative 3D, fake analytics, fake application screenshots, automatic marquees, animation on every element, compressed desktop tables on mobile, and any unimplemented capability presented as real.
