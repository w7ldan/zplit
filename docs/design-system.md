# Zplit design system

This document is the normative visual contract for every future Zplit interface.

## Thesis

Zplit is a personal ledger, presented with the discipline of an exhibition catalogue or architectural publication. The interface should feel cinematic and high-contrast, with oversized grotesk typography, strict alignment, generous negative space, thin rules, square geometry, and useful metadata.

The balance is 70/20/10:

- 70% functional clarity: readable records, direct actions, visible amounts, dates, and state.
- 20% editorial expression: chapter numbering, technical labels, asymmetry, typography, and deliberate pacing.
- 10% controlled spectacle: a small number of meaningful reveals or structural fields.

Spectacle never delays recording an expense or repayment.

## Palette

The primary palette is fixed:

| Token | Value | Semantic use |
| --- | --- | --- |
| Ink | `#111315` | Primary text, rules, and dark action states |
| Paper | `#F4F1EA` | Page background and reverse text on ink |
| Pastel blue | `#C7E4F6` | Hero side field, chapter markers, focus and primary-action states, selected ledger information |
| Muted ink | `#5F6468` | Supporting text and technical metadata |
| Rule | `#B9BAB6` | Thin dividers and field boundaries |
| White | `#FFFFFF` | Reverse or elevated semantic surfaces when needed |

Pastel blue is the only expressive accent. It is structural and occasional, never a glow or a decorative wash across every section. Destructive semantics retain their existing error token and are not decorative page color.

## Typography

Typography uses a dependency-free system grotesk stack: Arial, Helvetica Neue, Helvetica, sans-serif. No external font files are fetched.

- Display: oversized, heavy grotesk headlines with tight tracking and compressed line height.
- Section heading: large, short editorial statements that create hierarchy through scale.
- Body: readable text with a restrained line length and accessible default line height.
- Technical label: uppercase, small, bold text with wider tracking.
- Numerals: tabular numerals for rupiah values, dates, chapter numbers, and transaction metadata.

There is one page-level `h1`. Headings must describe the current chapter, not decorate it.

## Grid and spacing

Desktop uses a 12-column grid. Navigation, chapter labels, headings, metadata, rules, and content align to those columns, with asymmetric spans used intentionally. The readable content width is wide enough to feel like a publication spread without becoming a centered SaaS card.

Mobile uses a 4-column grid. Mobile layouts are designed independently: they do not compress a desktop table or preserve desktop spans at the cost of readability. No page may introduce horizontal scrolling.

Spacing is generous and structural. Thin one-pixel rules establish rhythm; borders, alignment, and field contrast do the work that shadows and containers would otherwise do.

## Geometry and components

All radius tokens are zero. Use square fields, square actions, and direct edges. Do not use generic rounded cards, floating card grids, or excessive containers.

Navigation remains obvious at every width and uses direct anchor links when a destination exists. Calls to action are semantic anchors with primary and quiet variants, visible keyboard focus, square geometry, and clear hover states. Do not use icon dependencies to communicate a basic action.

Ledger views lead with rows before card collections. A ledger row exposes a clear amount, person, status, visible date when available, and transaction metadata. Rupiah totals remain explicit. Status is plain text, never a pill or colored status dot.

Future forms align their labels, fields, validation, and actions to the editorial grid. Future modals keep a clear title, task action, escape path, and focus order. Empty states explain what is absent and expose the direct next task. Total summaries use clear rupiah values and supporting date or scope metadata without fake analytics.

Future authenticated pages should contain direct task actions, visible dates and transaction metadata, and ledger rows before card collections. Mobile recording flows must be designed for the small screen first. Spectacle must never delay recording an expense or repayment.

## Motion

Motion is CSS-only and limited to one masked hero-text reveal, one restrained pastel-blue hero-field reveal, and subtle link or rule movement on hover. A restrained section entry is allowed only when it does not delay use. No client-side animation libraries, infinite animation, automatic marquee, parallax, scroll hijacking, pinned storytelling, or animation on every element.

Every nonessential animation and transition must be removed under `prefers-reduced-motion: reduce`. The page must remain fully understandable and usable with motion disabled.

## Accessibility and responsive behavior

Use semantic landmarks, one clear page-level `h1`, ordered content, descriptive link names, readable body contrast, visible `:focus-visible` indicators, and native keyboard behavior. Color cannot be the only signal for status or selection. Never rely on hover to expose essential content.

At narrow widths, navigation remains readable, actions remain obvious, long headlines wrap without clipping, and ledger rows reflow into stacked records with field labels. Body text maintains a readable line length. At desktop widths, the grid preserves deliberate asymmetry without creating a wall of text.

## Imagery and prohibited patterns

The system prefers typographic composition, rules, metadata, and field contrast. Use imagery only when it has a real editorial or product purpose; never add stock photography to fill space.

Explicitly prohibited:

- generic SaaS dashboards;
- generic rounded cards;
- excessive pills;
- colored status dots;
- glassmorphism;
- gradient blobs;
- glowing effects;
- heavy shadows;
- decorative 3D;
- fake analytics;
- animation on every element.

Also avoid fake application screenshots, decorative blobs, random 3D objects, gradient backgrounds, glass effects, automatic marquees, and compressed desktop tables on mobile.

## Authenticated interfaces

Access pages use the editorial grid rather than centered rounded auth cards. Private forms use persistent visible labels, square fields, and direct actions. Authentication errors are direct but generic, and pending states reserve their layout so they do not shift surrounding content.

Session and account metadata use technical labels. The protected shell prioritizes task navigation over fake analytics and does not invent dashboard totals, cards, charts, or unfinished destinations.

Mobile authentication is independently composed on the 4-column grid. Pastel blue remains structural rather than decorative, and all nonessential motion follows the complete reduced-motion rule above.
