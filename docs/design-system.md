# Zplit Design System

This is the authoritative visual and interaction reference for Zplit.

It governs:

- visual identity;
- information hierarchy;
- layout and density;
- component grammar;
- responsive behavior;
- interaction design;
- accessibility;
- motion;
- feedback;
- and CSS ownership.

Product, accounting, authorization, durable-identity, and workspace-lifecycle semantics remain governed by `docs/collaboration-architecture.md`.

The two documents are complementary:

- `docs/collaboration-architecture.md` defines what the product means.
- `docs/design-system.md` defines how that meaning is presented and interacted with.

Unless a section is explicitly marked as future direction, it describes either:

1. an enduring Zplit design principle; or
2. a current implementation contract.

A current implementation contract documents the present source but is not a permanent design constant. During an intentional redesign, exact dimensions, breakpoints, timings, or component arrangements may change when the new result better satisfies the principles in this document.

---

## 1. Design philosophy

Zplit is a financial coordination product, not a generic dashboard.

Its interface should feel:

- clean;
- modern;
- editorial;
- practical;
- understated;
- precise;
- information-dense where useful;
- calm rather than decorative;
- and trustworthy around financial state.

Public surfaces may be more expressive.

Authenticated product surfaces should be quieter, denser, more deliberate, and more task-focused.

Both share the same visual identity without requiring the same composition or amount of motion.

The interface should make financial relationships easy to understand without turning every fact into a card, badge, graph, or animated widget.

---

## 2. Authenticated UI decision rule

When multiple treatments solve the same problem, prefer the one with less visual machinery.

Do not introduce a card, badge, icon, disclosure, animation, color role, container, modal, status chip, or decorative surface merely to make an area feel more designed.

Add structure only when it clarifies:

- hierarchy;
- grouping;
- state;
- action;
- navigation;
- identity;
- or financial meaning.

Before inventing a new UI pattern, check whether an existing Zplit row, card, form, disclosure, dialog, task panel, list, or selection pattern already expresses the same relationship.

A UI rehaul should improve coherence, hierarchy, ergonomics, and visual quality, not increase the amount of interface chrome.

---

## 3. Visual identity

Zplit's visual language is built from:

- warm paper and surface roles;
- light/dark parity;
- restrained pastel-blue accent;
- strong neutral ink;
- thin borders and rules;
- confident typography;
- clear financial hierarchy;
- restrained soft geometry;
- deliberate negative space;
- and low visual noise.

The current semantic color roles are:

- `--paper`
- `--surface`
- `--ink`
- `--muted-ink`
- `--rule`
- `--pastel-blue`
- `--mint`
- `--peach`
- `--amber`
- `--error`

Dark mode remaps semantic roles rather than creating a separate visual language.

Financial meaning must never depend on color alone.

### Current light palette

| Role | Value | Typical use |
| --- | --- | --- |
| Ink | `#111315` | primary text, strong rules |
| Paper | `#F4F1EA` | page background |
| Surface | `#FFFEFA` | focused working surfaces |
| Pastel blue | `#C7E4F6` | primary action, selection, active navigation |
| Muted ink | `#62676B` | metadata, secondary copy |
| Rule | `#C8C7C1` | dividers and boundaries |
| Mint / peach / amber | restrained pale tones | contextual state |
| Error | `#B42318` | validation/invariant failure with explicit wording |

These exact values are current implementation contracts.

A redesign may refine them while preserving:

- warm-neutral foundation;
- restrained blue accent;
- adequate contrast;
- light/dark parity;
- and semantic color usage.

Do not introduce:

- generic SaaS blue everywhere;
- glassmorphism;
- gradient blobs;
- glowing surfaces;
- heavy shadows;
- decorative 3D;
- neon status colors;
- giant colored cards;
- fake analytics;
- or unnecessary visual effects.

---

## 4. Typography

Use strong typographic hierarchy before adding containers.

The current dependency-free stack is:

`Arial, "Helvetica Neue", Helvetica, sans-serif`

A UI rehaul may refine the typographic system, including choosing a different appropriate font stack if implementation constraints allow it.

The result should remain:

- highly readable;
- neutral rather than trendy;
- compact enough for financial data;
- visually strong at headings;
- and suitable for long-lived product UI.

Use tabular numerals for rupiah values, dates, and other comparable numeric information where alignment improves comprehension.

Authenticated headings, labels, controls, and actions normally use sentence case.

Compact uppercase may be used for technical or contextual labels where the established visual grammar benefits from it.

Avoid:

- excessive all-caps;
- giant marketing typography inside authenticated workflows;
- overusing font weights;
- or making every secondary label visually prominent.

---

## 5. Public vs authenticated expression

### Public

The public experience may use:

- larger typography;
- stronger editorial composition;
- more negative space;
- more expressive motion;
- scenario-driven product demonstration.

The product UI remains the illustration.

Public examples must remain clearly illustrative and truthful.

### Authenticated

Authenticated Zplit prioritizes:

- task completion;
- financial comprehension;
- information locality;
- compact navigation;
- predictable interaction.

It should not resemble a marketing page embedded inside the app.

Authenticated pages may still be visually sophisticated, but sophistication should come from:

- composition;
- hierarchy;
- typography;
- alignment;
- proportion;
- and interaction quality;

rather than decorative effects.

---

## 6. Public landing and Journey

The public homepage is an editorial financial record transformed into a
product website. It uses real or faithful Zplit-like record UI as illustration,
with bounded reading measures and wider compositions for product surfaces.

The current public narrative moves through:

1. a product-scale hero record;
2. expense → shares → repayment → balance relationships;
3. distinct Personal, Group, and Organization contexts;
4. a compact four-state Journey;
5. Group ledger beside Group Chat;
6. record detail with attached proof;
7. private, read-only balance sharing;
8. Search, Inbox, and history as one findability story; and
9. a settled/open balance payoff.

The Journey demonstrates:

1. adding an illustrative outing record;
2. assigning Friend shares explicitly;
3. recording and allocating a repayment; and
4. reading resulting balances.

The Journey uses one stable product composition with direct step controls. It
does not require a long scroll runway or scroll-linked geometry to explain one
scenario.

On narrow screens, reduced-motion environments, or constrained viewports, the same content must remain understandable in a native stacked composition.

Do not imply capabilities the demonstrated flow does not actually support.

Public motion may be more expressive than authenticated motion but must remain:

- keyboard-operable;
- reduced-motion-safe;
- understandable without animation.

---

## 7. Layout philosophy

Zplit uses deliberate alignment rather than arbitrary containers.

Primary principles:

- related content shares alignment lines;
- financial values remain easy to compare;
- actions stay visually attached to the records they affect;
- dense information is allowed when its hierarchy remains clear;
- responsive layouts recompose instead of merely shrinking;
- negative space separates meaning rather than inflating the interface.

Avoid card-inside-card-inside-dashboard-section structures when rules, spacing, and typography can express the hierarchy more clearly.

---

## 8. Current authenticated canvas

The authenticated application uses one fluid working canvas with responsive
horizontal space and an ultrawide ceiling:

```css
--authenticated-canvas-gutter: clamp(2rem, 5vw, 5rem);
--authenticated-canvas-max-width: 118rem;
width: min(
  calc(100% - var(--authenticated-canvas-gutter)),
  var(--authenticated-canvas-max-width)
);
```

The gutter is about `1rem` per side on mobile and scales to about `2.5rem`
per side on desktop. The normal authenticated header uses the same canvas so
its navigation and utility actions share the page alignment.

The detached header remains an intentional compact surface, capped at `72rem`;
it is not widened automatically when the attached application canvas widens.

This is a current implementation contract, not a permanent maximum. Do not
introduce multiple arbitrary page-width systems or compensate for the canvas
with page-specific width hacks.

The wide application canvas is not a requirement that every child stretch
indefinitely. Prose, forms, settings editors, repayment editors, receipt and
payment previews, dialogs, destructive explanations, and Chat conversation
content keep intentional local reading or interaction bounds.

### Chat workspace

Group Chat and Organization General use the shared `ChatPanel` surface. Its
conversation workspace is centered and bounded at `72rem` while individual
messages remain independently readable at `44rem` or less. The history owns
scrolling and uses the available viewport height; the composer remains a
full-workspace continuation of that surface with a thin rule between reading
and composing.

Messages keep other participants left-aligned and the current user
right-aligned without relying on color alone. Sender identity and timestamps
anchor each message group, grouped messages tighten their internal rhythm, and
edited, deleted, action, and Seen-by states remain available as quiet metadata
below the message content. Grouped messages do not repeat visible avatars, and
the current user does not need a redundant avatar when alignment already
establishes authorship.

---

## 9. Grid and alignment

Public/editorial desktop layouts use a 12-column grid, reducing to four
columns on mobile. The public canvas may extend to an ultrawide ceiling for
product compositions while readable copy keeps an intentional local measure.
The current Landing V2 canvas ceiling is `118rem`; this is a public
implementation contract and not a requirement that every child stretch to the
viewport edge.

Authenticated layouts do not need to visibly expose the same grid, but page headers, tools, summaries, records, metadata, financial values, and actions should feel aligned to shared structural lines.

Preserve baseline alignment where it helps users compare:

- amounts;
- dates;
- statuses;
- people;
- and related records.

Do not let every component invent its own horizontal padding.

---

## 10. Vertical rhythm

Spacing communicates hierarchy.

The current implementation commonly uses relationships such as:

- about `1.5rem` between compact app sections;
- about `2rem` where a stronger contextual break is needed;
- larger `3–5rem` gaps only for meaningful page-level transitions;
- roughly `0.35rem` label-to-control spacing;
- roughly `0.9rem` between ordinary form fields;
- compact row padding around `0.85–1rem`;
- deliberate card-grid gaps around `0.75rem`;
- about `2rem` breathing room after card groups before a new major context.

These values are references, not immutable tokens.

A redesign may establish a cleaner spacing scale.

The enduring rules are:

- related things stay visually close;
- unrelated things get meaningful separation;
- record density stays practical;
- financial pages do not become vertically bloated.

Avoid random one-off spacing values.

---

## 11. Responsive design

Desktop, tablet, and mobile are different compositions, not scaled copies.

Requirements:

- no horizontal overflow;
- no clipped controls;
- no clipped focus rings;
- important actions must not depend on hover;
- touch targets remain usable;
- financial labels, amounts, and dates retain hierarchy;
- cards and grids collapse intentionally;
- record rows stack in a meaningful reading order;
- long names, labels, and identifiers remain usable.

Current shell behavior includes:

- full authenticated navigation at approximately `1200px+`;
- mobile navigation below it;
- public/shared desktop header composition around `1024px+`.

These breakpoints are current implementation contracts.

A rehaul may replace them with better breakpoints based on actual component pressure rather than device categories.

---

## 12. Navigation and information architecture

The current authenticated top-level navigation is:

- Overview
- Personal
- Organizations

Groups live under Personal rather than becoming a fourth top-level product area.

Header utility actions prioritize:

- Inbox
- Search
- Account

The account menu contains secondary account destinations and theme controls.

Navigation styling should clearly distinguish:

- current location;
- utility actions;
- hierarchy;
- and secondary destinations;

without excessive pills or colored navigation blocks.

Semantic parent navigation should describe logical hierarchy rather than browser history.

Prefer:

- `← Friends`
- `← Groups`
- `← Organizations`

over an opaque Back action when a meaningful parent exists.

---

## 13. Geometry

Zplit uses restrained soft geometry.

Current foundation radii include approximately:

- `6px`
- `10px`
- `16px`
- `20px`

Current roles include:

- `--radius-control`
- `--radius-md`
- `--radius-panel`

Exact token naming should remain synchronized with source.

General principle:

- ordinary controls: restrained radius;
- entity cards: restrained structural radius;
- focused panels/dialogs: slightly larger radius;
- pills only where pill semantics are genuinely appropriate.

Rounded does not mean bubbly.

Avoid:

- giant corner radii;
- every element becoming a capsule;
- arbitrary mixtures of square and heavily rounded surfaces.

A rehaul may refine the radius scale while preserving structural restraint.

---

## 14. Controls

Controls should feel deliberate, stable, and compact.

Current authenticated inputs, selects, textareas, and common actions use approximately a `44px` minimum interaction height.

Public primary actions may be larger.

### Primary controls

Clear, bordered or surface-backed controls used for direct task completion.

### Row actions

Compact text or icon actions visually attached to their record.

### Destructive and lifecycle actions

Explicitly worded and visually distinguishable without turning the whole section into a red warning panel.

### Focused task surfaces

Use stronger containment only when a user must concentrate on one temporary task.

Do not introduce a new control family when an established one already expresses the action.

---

## 15. Financial record grammar

Financial records are:

- compact;
- rule-led;
- information-dense;
- hierarchical.

Typical hierarchy:

1. primary identity or title;
2. financial amount or state;
3. metadata;
4. date or context;
5. row-local actions.

Friends, Outings, Expenses, Repayments, Group financial history, and settlement history should prioritize comparability.

Ledger records are not generic rounded cards.

Use:

- alignment;
- typography;
- rules;
- spacing;

before card containment.

On mobile, recompose into a clear vertical hierarchy rather than shrinking desktop columns until they become unreadable.

---

## 16. Entity and workspace cards

Cards are appropriate for browsing durable entities such as:

- Groups;
- Organizations;
- major workspaces.

They should not replace dense financial rows.

Current card grammar is approximately:

`[avatar] [details]`

with:

- thin border;
- surface background;
- restrained radius;
- about `1rem` internal padding;
- compact minimum height;
- low visual elevation;
- strong hover/focus border rather than heavy shadow.

Wide screens currently target a multi-column grid, often four columns where space permits.

A rehaul may change the exact grid.

Card content should remain selective.

### Group cards

May include:

- role;
- participant count;
- concise personal balance state.

Examples:

- You owe
- Owed to you
- Settled up

### Organization cards

May include:

- role;
- member count;
- one concise ledger state where authorized.

Do not turn entity cards into mini dashboards.

---

## 17. Archived workspace presentation

The domain determines whether a workspace may be deleted, archived, restored, or otherwise mutated.

The design system governs presentation only.

Presentation rules:

- archived workspaces move out of normal active browsing;
- they remain visually recognizable as the same entity;
- show a compact Archived state;
- avoid red/error treatment because archive is a lifecycle state, not a failure;
- ordinary new-activity and management controls should not appear active when the canonical read model says they are unavailable;
- authorized Restore remains clear and discoverable.

Do not create a visually separate “dead workspace” design language.

Financial and historical content should remain easy to inspect.

---

## 18. Forms and progressive disclosure

Large optional forms may remain collapsed until needed.

Progressive disclosure is useful when it reduces visual density without hiding information the user must constantly compare.

Good candidates include:

- optional create-time fields;
- destination editing;
- charges;
- advanced details;
- secondary mobile filters.

Do not hide controls merely to make a page appear minimalist.

Financial review information should remain directly visible when hiding it would obstruct comprehension.

For mutually exclusive editors:

- opening one may close the competing editor;
- Cancel should restore focus to the action that opened the editor where appropriate;
- validation failures should preserve values, disclosure state, and actionable context.

Dense financial disclosures should normally open immediately rather than gain decorative animation.

---

## 19. Destructive and lifecycle presentation

Destructive and lifecycle controls must reflect canonical domain state provided by the server.

Presentation requirements:

- permanent deletion uses an explicit confirmation surface;
- the exact entity being affected is named;
- consequence wording is concise and accurate;
- Cancel and Confirm remain clearly distinct;
- pending state prevents duplicate submission;
- when the domain exposes Archive instead of Delete, Archive becomes the appropriate lifecycle action;
- archived state uses restrained status treatment;
- Restore appears only where the canonical authorization/read model permits it.

The rules determining deletion eligibility, financial-history preservation, archive legality, restore legality, and financial completion belong to `docs/collaboration-architecture.md`.

The design system must not redefine those semantics.

---

## 20. Searchable selection

The searchable combobox interaction contract is strict:

- selected ID = submitted value;
- selected label = display only;
- search text = temporary query state.

Arbitrary search text must never become the selected or submitted value.

Preserve:

- native `<select>` progressive fallback;
- keyboard operation;
- pointer selection;
- focus restoration;
- loading state;
- empty state;
- error state;
- grouping where needed;
- disabled and required semantics;
- viewport-safe popup placement.

Current implementation:

- debounce: approximately `120ms`;
- maximum results: approximately `20`;
- stale requests cannot overwrite newer results.

These are current component contracts rather than universal visual principles.

The popup should visually originate from its trigger.

Current motion is approximately:

- `3px` directional travel;
- `scale(.99)`;
- fast timing.

Use `top center` transform origin when opening below and `bottom center` when opening above.

A redesign may refine the exact values while preserving subtle trigger continuity and reduced-motion safety.

---

## 21. Dialogs and temporary surfaces

Temporary surfaces must clearly belong to the action that opened them.

Examples:

- confirmation dialogs;
- receipt previews;
- payment-proof previews;
- focused task panels;
- searchable popovers.

Requirements:

- viewport-safe;
- keyboard dismissible where appropriate;
- visible close or cancel path;
- focus managed correctly;
- focus restored on close;
- background interaction controlled where modal;
- no unnecessary layout shift;
- mobile-safe.

Receipt and payment-proof previews should:

- fit inside `100dvh`;
- preserve image aspect ratio;
- keep actions reachable;
- contain oversized content in their own scrolling region;
- avoid page-level overflow traps.

Task panels may become bottom sheets on narrow or mobile screens when that composition improves usability.

Do not turn ordinary inline editing into a modal without a meaningful reason.

---

## 22. Feedback

Feedback confirms meaningful action.

It should not narrate obvious state.

Success feedback should be:

- concise;
- transient when appropriate;
- presented once.

Errors should:

- remain visible long enough to act on;
- identify what failed;
- provide a useful recovery path where one exists.

Avoid showing a success toast, success banner, and success text for the same event unless there is a concrete reason.

---

## 23. Inbox and realtime presentation

Inbox is an authenticated attention surface.

It should remain:

- compact;
- subordinate to primary product navigation;
- clear about actionability;
- restrained in unread presentation.

Realtime transport itself is invisible.

Do not visually narrate:

- SSE reconnects;
- transport state;
- receipt churn;
- low-level database events.

Realtime changes should refresh canonical state and surface only meaningful user-facing consequences.

---

## 24. Toasts

Current toast behavior includes:

- bounded visible count;
- transient default lifetime;
- pause while hovered or focused;
- pause while associated action is pending;
- movement without page-layout shift.

The current implementation shows no more than roughly two visible toasts.

That is a current component contract and may be refined during a redesign.

Preserve the larger principle:

Toasts are brief, actionable when needed, non-spammy, and never the primary home of important information.

---

## 25. Reorder interactions

Simple reorder interactions should remain simple.

The repayment-destination list is the current reference:

- explicit drag handle;
- row itself not unnecessarily draggable;
- keyboard or non-drag fallback;
- restrained target feedback;
- optimistic update only when rollback is reliable.

Feedback may use:

- opacity;
- target rule;
- position indicator.

Avoid physics or spring animation unless the interaction genuinely benefits from it.

Do not add a dependency-heavy drag system for a basic ordered list.

---

## 26. Motion philosophy

Motion is purposeful and restrained.

It exists to explain:

- state;
- origin;
- continuity;
- relationship.

It is not a reward layer.

Authenticated Zplit should not animate simply because animation is available.

### Frequent interactions

Frequent financial and task interactions should feel effectively instant.

Avoid motion on:

- ledger values;
- routine record insertion;
- chat-message insertion;
- global-search results;
- mobile filters;
- repayment-allocation rows;
- frequent dense disclosures.

### Occasional contextual surfaces

Occasional menus, dialogs, previews, and popovers may use subtle spatial continuity.

Prefer opacity plus no more than about `4px` translation.

Scale is reserved for trigger-anchored surfaces where it improves physical origin.

Keep scale extremely subtle.

---

## 27. Current motion tokens

Current foundation timings:

| Token | Value | Typical role |
| --- | ---: | --- |
| `--motion-press` | `100ms` | press / very short feedback |
| `--motion-fast` | `160ms` | menus and popovers |
| `--motion-state` | `220ms` | dialogs, previews, state |
| `--motion-layout` | `300ms` | deliberate layout change |
| `--motion-panel` | `360ms` | larger task panel |
| `--motion-reveal` | `640ms` | public/editorial reveal |

Current easing roles:

- `--ease-product`
- `--ease-emphasized`
- `--ease-standard`

These are current implementation contracts.

A redesign may refine them as a coordinated motion scale, not as isolated component tweaks.

---

## 28. Motion behavior

Entry and exit should be interruptible where practical.

Avoid independent entry and exit keyframes when interruption can produce a visual jump.

Prefer retargetable CSS transitions where component lifecycle permits it.

Current examples include:

### Account menu

Fast anchored opacity and approximately `-3px` entry.

Native `<details>` close may remain immediate when implementing animated close would add disproportionate lifecycle complexity.

### Searchable combobox

Fast trigger-anchored transition with:

- approximately `3px` travel;
- `scale(.99)`;
- placement-aware transform origin.

### Receipt preview

Retargetable overlay and surface transition with transition-aware exit cleanup.

### Confirmation dialog

Opacity plus up to roughly `4px` vertical travel.

### Public Journey

May use more expressive editorial motion within its accepted interaction contract.

---

## 29. Reduced motion

Under `prefers-reduced-motion: reduce`, remove:

- translation;
- scaling;
- staged movement;
- clipping travel;
- animated scrolling;
- decorative animation.

State must remain immediately understandable.

Acceptable:

- immediate color change;
- immediate background change;
- immediate border or focus state.

Do not add opacity fades merely to make reduced-motion mode prettier.

Do not delay unmount or close only to preserve an animation that has been removed.

Reduced-motion mode must retain:

- keyboard operation;
- focus behavior;
- full content access;
- Journey comprehension.

---

## 30. Iconography

Icons are subordinate to typography and financial hierarchy.

Use:

- restrained geometry;
- consistent stroke;
- consistent optical size;
- established Zplit-compatible forms.

Do not mix arbitrary icon families.

Avoid decorative icons where text alone communicates the action more clearly.

Unread and attention treatment should remain compact rather than becoming a decorative status system.

---

## 31. Identity visuals and avatars

Avatar and identity visuals may be used where they improve orientation.

The current system includes deterministic defaults for:

- user;
- Group;
- Organization identity.

Defaults should remain:

- geometric or editorial;
- recognizable at small sizes;
- compatible with light and dark themes;
- visually consistent with the product palette.

Avoid:

- generic person silhouettes;
- colored-initial circles as the default identity system;
- emoji avatars as product defaults;
- external avatar-service art.

Custom avatar media may be displayed where configured.

Identity visuals remain subordinate to:

- name;
- role;
- financial meaning.

Zplit should not become an avatar-heavy social interface.

---

## 32. Accessibility

Use native semantics first.

Prefer real:

- links;
- buttons;
- inputs;
- selects;
- headings;
- lists;
- disclosures;
- dialogs;

where they express the interaction correctly.

Use ARIA only where native semantics do not provide the necessary state or relationship.

Requirements:

- full keyboard operation;
- visible focus;
- useful accessible names;
- associated validation and error text;
- non-color-only state;
- drag interactions have non-drag alternatives;
- modal surfaces manage focus;
- temporary surfaces remain dismissible;
- reduced motion is respected.

Financial meaning must remain understandable without:

- motion;
- color;
- hover;
- pointer-only interaction.

Realtime updates must avoid disruptive announcement spam.

---

## 33. CSS ownership

`src/app/globals.css` is the root stylesheet manifest.

Current semantic ownership:

### `00-foundation`

Owns:

- semantic tokens;
- browser baseline;
- document defaults;
- shared primitives;
- shared controls;
- radius roles;
- motion timing;
- easing roles.

### `10-public`

Owns:

- public shell;
- public navigation;
- landing composition;
- access presentation;
- informational and public surfaces.

### `20-authenticated-shell`

Owns:

- authenticated shell;
- app navigation;
- page scaffolding;
- workspace and entity browsing;
- account-menu presentation;
- authenticated layout rules.

### `30-records-and-forms`

Owns:

- financial record rows;
- detail views;
- forms;
- filters;
- searchable selection;
- confirmation dialogs;
- progressive disclosure.

### `40-motion-and-feedback`

Owns:

- shared feedback motion;
- result and status surfaces;
- task-panel behavior;
- receipt-preview motion;
- shared keyframes where genuinely shared.

### `90-late-overrides`

Owns only genuine late cascade overrides still required by source order.

It is not a dumping ground.

A UI rehaul may reorganize CSS ownership if the new structure is more coherent, but it must preserve explicit semantic ownership and predictable cascade order.

Do not move rules between layers merely for cosmetic cleanup without checking cascade consequences.

---

## 34. UI rehaul mandate

An intentional Zplit UI rehaul may change:

- exact canvas width;
- typography;
- spacing scale;
- breakpoint values;
- card composition;
- navigation composition;
- visual density;
- color values;
- component geometry;
- motion timings;
- CSS organization;

provided the new system improves coherence and continues to satisfy the enduring principles in this document.

The rehaul should prioritize:

1. clearer financial hierarchy;
2. stronger alignment;
3. better responsive composition;
4. reduced visual noise;
5. more coherent component grammar;
6. better information density;
7. improved focus and interaction states;
8. consistent light and dark treatment;
9. accessible controls;
10. restrained motion.

The redesign should not be evaluated by how different it looks.

It should be evaluated by whether Zplit becomes:

- easier to scan;
- easier to understand;
- faster to operate;
- more visually coherent;
- more trustworthy;
- more distinctive.

---

## 35. Rehaul constraints

During the UI rehaul, do not casually change:

- product semantics;
- accounting behavior;
- authorization;
- durable identity;
- navigation information architecture;
- data ownership;
- lifecycle legality.

Do not hide missing product logic behind presentation.

Do not introduce fake:

- numbers;
- analytics;
- status;
- activity;
- capability.

Do not replace established working interaction patterns merely for novelty.

Avoid redesigns based primarily on:

- more cards;
- more shadows;
- more gradients;
- more pills;
- more animation;
- more iconography.

Prefer fewer, stronger patterns.

---

## 36. Rehaul component strategy

The rehaul should establish a small number of recognizable component families.

Recommended grammar:

- Page
- Section
- Record row
- Entity card
- Summary
- Form
- Disclosure
- Search or select surface
- Dialog or task surface
- Feedback surface
- Identity visual

Do not create a different bespoke card or container grammar for every feature.

Financial content should generally choose between:

- record row;
- summary;
- focused detail;

rather than generic cards.

Workspace browsing may use entity cards.

Temporary focused tasks may use dialogs or task panels.

---

## 37. Rehaul review checklist

A redesigned screen should be reviewed against the following.

### Hierarchy

- Is the most important financial or state information obvious?
- Are primary and secondary actions clearly separated?
- Is metadata subordinate?

### Density

- Is information compact without becoming cramped?
- Are we adding vertical space without adding comprehension?

### Alignment

- Do related values line up?
- Do actions visually belong to their records?
- Are page sections using shared structural lines?

### Components

- Does this reuse an established Zplit pattern?
- Did we invent a container, icon, or badge unnecessarily?

### Responsive behavior

- Does mobile intentionally recompose?
- Is any important desktop relationship lost when stacked?

### Accessibility

- Keyboard?
- Focus?
- Touch?
- Contrast?
- Reduced motion?
- Non-color state?

### Motion

- Does motion explain anything?
- Is it interruptible where needed?
- Is it subtle enough for financial UI?

### Truthfulness

- Does the UI accurately represent canonical product state?
- Is any visual implying functionality that does not exist?

---

## 38. Document authority

`docs/design-system.md` governs presentation and interaction:

- visual identity;
- layout;
- spacing;
- geometry;
- responsive design;
- accessibility;
- motion;
- feedback;
- component grammar;
- CSS ownership.

`docs/collaboration-architecture.md` governs product and domain semantics:

- Personal vs Organization vs Group;
- accounting;
- permissions;
- durable identity;
- participants and memberships;
- lifecycle legality;
- realtime meaning;
- financial-history rules.

When both domains are relevant, implementation must follow both.

If a new product requirement introduces a genuinely new UI family, extend this document intentionally instead of introducing an isolated visual language in source.
