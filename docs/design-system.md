# Zplit design system

This is the visual contract for Zplit. The authenticated product is an expressive editorial utility: 85% functional clarity, 12% editorial personality, and 3% controlled spectacle.

## Authenticated product

The protected shell keeps navigation stable and the primary task visible. Pages are compact, useful in the first viewport, and organized around open ledger rows, contextual task panels, and clear record states. Outstanding money answers the first question on Overview; recent expenses and repayments provide context without charts, trends, percentages, or invented metrics.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#111315` | Primary text and strong rules |
| Paper | `#F4F1EA` | Warm public-product background |
| Surface | `#FFFEFA` | Authenticated product surface |
| Pastel blue | `#C7E4F6` | Primary action, active navigation, selected or newly created records |
| Muted ink | `#62676B` | Supporting text and metadata |
| Rule | `#C8C7C1` | Thin ledger dividers and field boundaries |
| Mint | restrained pale mint | Confirmed or settled context, always paired with text |
| Peach | restrained pale peach | Secondary contextual emphasis, always paired with text |
| Amber | restrained pale amber | Unallocated money or attention state, always paired with text |
| Error | `#B42318` | Validation and invariant errors, always paired with wording |

Semantic color is never the only signal. Statuses use text, labels, rules, or structure as well as color. No status dots, gradients, glow, glass, or decorative blobs.

## Typography and layout

Use the dependency-free system grotesk stack: Arial, Helvetica Neue, Helvetica, sans-serif. Use tabular numerals for rupiah values and dates. Authenticated pages use sentence case for headings, labels, and actions. Keep one clear page-level `h1`, short supporting copy, and essential actions beside the heading.

The warm paper, strong ink, pastel blue, tabular rupiah values, thin rules, and row-first ledger presentation remain core Zplit cues. Authenticated surfaces use `#FFFEFA` so working records remain calm and legible. Ledger rows stay primarily open and rule-based; use moderate rounding only for genuinely interactive grouped surfaces.

Native predictable scrolling is preferred. Desktop uses a readable wide layout; mobile uses a four-column composition with no horizontal scrolling. The mobile shell has five fixed destinations, safe-area spacing, and a visible Add expense action that never covers content.

## Geometry and interaction

- Controls use `10–12px` radius and practical 44px minimum targets.
- Task panels use `14–16px` radius: right-side dialog on desktop, bottom sheet on mobile.
- Ledger rows use thin rules and open surfaces rather than card mosaics.
- Forms keep persistent labels, grouped related fields, adjacent accessible errors, stable-width pending buttons, and submitted values after errors.
- Native dialog behavior blocks background interaction, focuses the first meaningful field, supports Escape and explicit close, and restores focus to the trigger.
- Confirmation flags are concise, remove themselves from browser history after consumption, and do not replay on refresh.

## Motion

Authenticated motion spends approximately 80% on state feedback and manipulation, 17% on orientation and continuity, and 3% on delight. It is limited to active navigation, task-panel entry and exit, small row insertion movement, changed-value feedback, allocation bars, affected-record emphasis, and concise save confirmation.

| Token | Value |
| --- | --- |
| Press | `100ms` |
| Fast | `160ms` |
| State | `220ms` |
| Layout | `300ms` |
| Panel | `360ms` |
| Reveal | `640ms` |
| Story | `900ms` |
| Product ease | `cubic-bezier(.2,.8,.2,1)` |
| Emphasized ease | `cubic-bezier(.22,1,.36,1)` |
| Standard ease | `cubic-bezier(.4,0,.2,1)` |

Authenticated routes do not use routine masked heading reveals, initial ledger-row staggers, counters on route entry, shaking errors, or background decoration. Under `prefers-reduced-motion: reduce`, remove translation, scale, panel travel, and number movement while preserving immediate state changes and focus behavior.

## Prohibited patterns

Avoid generic SaaS dashboards, generic rounded cards, excessive pills, colored status dots, glassmorphism, gradient blobs, glowing effects, heavy shadows, decorative 3D, fake analytics, animation on every element, fake application screenshots, automatic marquees, and compressed desktop tables on mobile.
