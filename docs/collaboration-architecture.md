# Collaboration architecture contracts

This is the Stage 0 product and architecture contract for collaboration. The
rules below are normative: later stages MUST preserve them unless a reviewed
product decision explicitly changes this document. This document defines
semantics and UI/UX boundaries; it does not define a schema or implement a
feature.

## 1. Top-level product model

Zplit has three distinct financial contexts. They MUST NOT be collapsed into a
generic `workspace` abstraction.

| Context | Contract |
| --- | --- |
| **Personal private ledger** | The current owner-centric Zplit ledger. The owner fronts money and Friends owe the owner. Existing repayment and allocation semantics remain intact. |
| **Organizations** | Managed financial entities. The Organization is the financial entity; privileged members operate its ledger. An ordinary Member does not automatically gain financial mutation access. Accounting is owner/entity-centric, similar to Personal, but Organization and Group are not the same abstraction. |
| **Groups** | Persistent social circles of Friends under Personal. Accounting is peer-to-peer: the payer may change per expense, and registered members may pay, owe, or be owed. External participants are debtor-only. Groups MUST NOT blindly reuse Personal repayment semantics. |

## 2. Authenticated information architecture

The authenticated top-level navigation is:

`Overview | Personal | Organizations`

- **Overview** is a cross-Zplit summary of Personal position, relevant Groups,
  Organizations, and Inbox/attention. It MUST NOT combine unrelated
  Organization finances into a misleading single personal net value.
- **Personal** contains the existing private ledger and its Groups
  section/grid.
- **Organizations** is a simple landing overview with a responsive grid of
  Organization cards. Selecting a card enters that Organization.

The header MUST also contain a custom Zplit Inbox/notification SVG icon, its
unread indicator/count, and a user avatar/profile control. It MUST NOT use a
text `Inbox` item in the navbar.

## 3. Username and identity

Every collaborative Zplit user has a display name, unique username, user ID,
and avatar.

Usernames:

- MUST display as `@username`.
- MUST be normalized to lowercase and be case-insensitively unique.
- MUST be 3–20 characters.
- MAY contain only `a-z`, `0-9`, `.`, and `_`.
- MUST NOT begin or end with punctuation or contain consecutive punctuation
  combinations.
- MUST reject reserved system/product names.

Display names are not unique. Registered-user identity is the user ID and
username, never the name.

Once username discovery exists, users MUST NEVER be searchable or
discoverable by email. There is no “username or email” search. Invitations,
Friend linking, Group invites, and Organization invites use `@username`.
Email remains private authentication and account-recovery data.

## 4. Avatars

Identity images are supported for users, Groups, and Organizations. An
uploaded photo MAY replace a generated default.

The default avatar MUST be custom to Zplit, deterministic from the entity ID,
geometric/editorial, light/dark compatible, and expressed through a restrained
pastel-accent language. It MUST NOT be a generic silhouette, third-party
avatar service, random emoji/cartoon imagery, or merely a colored initials
circle. User, Group, and Organization variants MAY share the same visual
grammar.

## 5. Friend ↔ Zplit-user linking

A Friend MAY start as an external identity. It can later be linked to a real
Zplit user through `@username` search, an explicit link request, a realtime
Inbox request, and target-user confirmation.

The original Friend financial identity and ID MUST remain unchanged. Historical
shares, repayments, allocations, balances, and links remain attached to that
same Friend. Identity MUST NEVER be inferred from matching display names; two
different people may both be named Alice.

External identities MAY share names and MAY use a local descriptive label such
as `Fasilkom`, `Office`, or `Bob's sister`.

An accepted Friend link is a bidirectional registered-user identity connection.
It does not create a reciprocal ledger Friend, copy financial history, or grant
the target access to the owner's private ledger. The local Friend remains the
owner-controlled financial identity. Either connected user MAY unlink the
connection; unlinking preserves the Friend, shares, repayments, allocations,
balances, and accepted request history, and a future connection requires a new
explicit link request.

## 6. Realtime contract

Notifications and Chat share a deliberate realtime substrate. PostgreSQL is
the persistent source of truth; realtime transport supplies freshness:

```text
PostgreSQL = truth
realtime transport = freshness
```

Unless a later bounded technical preflight proves it unsuitable, authenticated
SSE is the transport direction. Missed or reconnected events MUST be
recoverable from canonical persisted state.

Stage 3 uses a user-scoped in-process publisher because the current deployment
has one effective web instance. It is a freshness channel, not durable event
storage; multi-instance notification or chat delivery needs a later shared
wake-up adapter such as PostgreSQL `LISTEN/NOTIFY` without moving truth out of
PostgreSQL. Consumers must refetch canonical state after a reconnect or
relevant invalidation; the transport does not replay missed events.

Realtime notifications update Inbox unread state, relevant attention surfaces,
and restrained in-app feedback where appropriate. The system MUST avoid
notification spam.

## 7. Organizations

Built-in Organization roles are Owner, Admin, Treasurer, Member, and Custom.
Roles are permission presets. Authorization MUST be capability-based and
centralized, not scattered checks such as `role === "admin"`.

Permission families include:

- Organization/settings
- membership/invitations
- roles
- ledger read
- Friends/Trips/Outings
- Expenses
- Repayments
- repayment destinations
- exports
- Chat/moderation

Financial operations are available only to members with the required
permissions. Custom roles MUST be supported architecturally even if their UI
exposure comes later. Invitations to existing users use `@username` and appear
in the realtime Inbox.

### Organization card UI

The Organizations landing uses a compact responsive grid. The wide-desktop
target is 4 columns × N rows, reducing columns responsively.

Cards MUST be horizontally composed to reduce Y-axis height:

```text
[photo/avatar] [details]
```

Details MAY include Organization name, the current user's role, member count,
permitted financial/attention summary, and useful unread state. Do not use
tall SaaS cards with image-above-content layouts.

## 8. Groups

Groups live under Personal. Built-in roles are Owner, Admin, and Member.

Registered members may normally participate financially, be selected as payer,
owe, be owed, create Group expenses, record settlements, and Chat. Admins also
manage membership, Group profile/settings, and moderation. Owners additionally
control ownership transfer and Group deletion.

Admin or Owner privileges MUST NOT silently fabricate financial claims
attributed to another member.

### Group participant identity

| Participant | Financial and access contract |
| --- | --- |
| **Registered participant** | A linked Zplit user who may pay, owe, or be owed, and may access the Group according to membership. |
| **External participant** | Has no Zplit account/link; is debtor-only, cannot be payer or creditor, and cannot Chat or access the full Group. |

An external participant MAY later link to a Zplit account without changing the
historical participant identity. The system MUST NOT prevent two external
people from sharing a display name.

## 9. Group accounting

Every Group expense preserves its original financial facts: Group, payer,
creator, total, occurrence time, shares, and receipt/evidence where applicable.
Payer and creator are separate concepts.

Canonical accounting:

- Expense shares generate obligations.
- Reciprocal obligations between the same two people are bilaterally netted.
- V1 MUST NOT perform automatic three-person or cross-person debt
  simplification.

```text
Alice owes Bob 100
Bob owes Alice 30
→ Alice owes Bob 70
```

```text
Alice owes Bob 100
Bob owes Charlie 100
→ MUST NOT silently become: Alice owes Charlie 100
```

The following remain distinct:

- **Original obligations:** historical expense-share facts.
- **Bilateral current balance:** current net debt between two participants.
- **Group-wide position:** total owed, total owed to the participant, and an
  optional net-position summary.

Simpler net balances MUST NOT erase original obligations.

### Financial confirmation and history

A member entering their own payer claim may confirm it immediately. If another
user records “Alice paid Rp X”, Alice MUST acknowledge/confirm that claim
before it becomes authoritative. Person-to-person payment settlements likewise
require counterparty acknowledgement. Pending financial claims MUST NOT alter
authoritative balances. Proof/evidence is evidence only and is not
confirmation.

Confirmed financial events MUST be auditable. Prefer the states `pending`,
`confirmed`, `rejected`, and `voided`. A confirmed event that must be removed
normally becomes voided or reversed with history retained. A member leaving a
Group MUST NOT delete historical participant identity, expenses, settlements,
or outstanding balances.

## 10. Settlements and offsets

### Payment settlements

A payment settlement is a direct participant-to-participant payment where real
money moves. It records amount, payment method, timestamp, optional proof, and
confirmation state. Optional proof MAY use existing evidence-storage
infrastructure, but proof is evidence only; the recipient/counterparty still
confirms the settlement.

V1 MUST NOT silently turn accidental settlement overpayment into a new credit
balance.

### Offset settlements

An offset is an explicit cancellation of reciprocal obligations where no money
moves. It is distinct from payment, needs no payment proof, and remains
explainable through its underlying obligations.

```text
You owe Alice 100k
Alice owes you 55k
Available offset: 55k
After offset: you owe Alice 45k
```

The system MUST NOT create offset records silently merely because bilateral
netting exists. The user explicitly chooses payment or offset. The default MAY
apply the oldest applicable obligations first; a later advanced `Choose
expenses` control MAY allow explicit selection.

Group accounting MAY maintain explicit applications from payments and offsets
to underlying expense-share obligations. This supports `Open`, `Partially
settled`, and `Settled` share states without requiring ordinary users to
manually allocate every transaction. Personal allocation semantics remain
separate.

## 11. Chat and read receipts

V1 starts with one `General` Organization chat and one Group chat. It does not
add channels, DMs, reactions, threads, or voice.

Chat uses restrained message bubbles with sender avatar, sender identity, and
clear own-versus-other styling. Consecutive messages from one user MAY group
visually. The treatment must fit Zplit and must not imitate Messenger or
Discord; no gradients, glows, or heavy shadows.

Read state SHOULD use an efficient thread read position/message-sequence
semantics rather than one receipt row per user per message where possible.
Inline status is shown only on the latest message as `Seen by N`. Older
messages have no permanent receipt clutter; their action/menu exposes `Seen
by…`. Detail MAY show `Seen` or `Not seen` with member names, avatars, and
useful timestamps where supported.

## 12. UI/UX governing rules

All later feature prompts MUST cite and preserve this section and the
established rules in `docs/design-system.md`.

### Visual language

Zplit remains clean, sleek, editorial, modern, understated, information-clear,
and deliberate: generous but controlled negative space, strict alignment,
clear hierarchy, thin rules/borders, restrained geometry, light pastel-blue
accent, and excellent light/dark parity.

Avoid generic SaaS dashboards, random rounded cards, excessive pills,
glassmorphism, gradient blobs, glowing effects, heavy shadows, decorative 3D,
oversized UI, and unnecessary dashboard chrome.

### Spacing and alignment

- Reuse the existing spacing scale/tokens and established CSS ownership.
- Keep consistent vertical rhythm between headings, supporting copy, controls,
  rows, and sections; do not add arbitrary one-off margins where an existing
  pattern applies.
- Dense record management stays compact. Page-level sections may breathe more
  than row-level controls.
- Avoid tall forms/cards when information can be presented horizontally or
  collapsed.
- Align related content to shared grid lines.
- Form labels, inputs, and actions follow existing form geometry.
- Row actions align with their row, metadata keeps predictable baselines, and
  controls appearing/disappearing do not cause layout shifts.
- Responsive layouts intentionally reflow rather than squeeze desktop
  geometry.

### Cards and forms

- Use cards only when they improve entity browsing, especially for Groups and
  Organizations.
- Organization and Group cards use avatar/photo left plus details right,
  remain compact in Y-axis, target four wide-desktop columns, and use
  restrained border/surface treatment rather than large image headers.
- Large optional forms default collapsed behind explicit actions where
  appropriate.
- Keep clear Cancel/Save semantics and preserve input after validation failure.
- Use searchable selection only when selection is actually required; never
  substitute arbitrary typing for identity selection.

### Motion, responsive behavior, and accessibility

- Motion is restrained and purposeful: small hover/press/focus transitions only,
  no ornamental motion competing with financial content, and full respect for
  reduced motion.
- Avoid layout-moving hover effects beyond tiny measured displacement.
- Desktop, tablet, and mobile layouts are deliberately designed without
  horizontal overflow or clipped controls.
- Cards reduce column count responsively. Chat, Inbox, and financial forms
  remain touch-usable, and important actions do not depend only on hover.
- Interactive controls are keyboard-operable with visible focus states and
  semantic controls.
- Use proper labels and ARIA only where needed. Color is never the sole state
  indicator.
- Realtime updates MUST NOT create disruptive announcement spam.

## 13. Implementation discipline for future stages

Later stages MUST:

- preserve existing Personal ledger invariants unless explicitly changing
  them;
- use targeted preflight inspection and keep domain ownership explicit;
- avoid giant generic abstractions and centralize authorization;
- use PostgreSQL constraints for cross-entity integrity;
- create verified backups before risky schema or financial migrations;
- use focused tests during development and run full validation once at the
  end;
- stage explicit files only;
- avoid casual dependency additions; and
- avoid Chromium/Playwright unless explicitly required.
