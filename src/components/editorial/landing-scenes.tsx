"use client";

import { useState, type CSSProperties } from "react";
import { UserAvatar } from "@/components/identity/user-avatar";
import { formatRupiah } from "@/domain/rupiah";
import { bandungStory as scenario } from "./public-scenario";

const raniAssigned = scenario.shares.filter((share) => share.friend === "Rani").reduce((total, share) => total + share.amount, 0);
const dimasAssigned = scenario.shares.filter((share) => share.friend === "Dimas").reduce((total, share) => total + share.amount, 0);

function IllustrativeAvatar({ id }: { id: string }) {
  return <UserAvatar userId={`landing-${id}`} decorative size="sm" />;
}

function Amount({ value }: { value: number }) {
  return <span className="tabular-nums">{formatRupiah(value)}</span>;
}

export function HeroLedger() {
  const [sharesOpen, setSharesOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<"Rani" | "Dimas">("Dimas");
  const selectedAmount = selectedPerson === "Rani" ? raniAssigned : dimasAssigned;
  const selectedState = selectedPerson === "Rani" ? "Settled after repayment" : "Open share";

  return (
    <div className="ledger-atlas" aria-label={`Illustrative ${scenario.outing} expense record`}>
      <div className="ledger-atlas__registration" aria-hidden="true"><span>12.04.26</span><span>RECORD / 001</span></div>
      <div className="ledger-paper ledger-paper--proof" aria-hidden="true">
        <span className="technical-label">attached proof</span>
        <strong>receipt.jpg</strong>
        <span>supporting proof for Dinner</span>
      </div>
      <div className="ledger-paper ledger-paper--shadow" aria-hidden="true" />
      <article className={`ledger-record${sharesOpen ? " ledger-record--open" : ""}`} data-shares-open={sharesOpen}>
        <header className="ledger-record__header">
          <div><span className="technical-label">Illustrative / Personal</span><h2>{scenario.outing}</h2></div>
          <span className="ledger-record__date">Sunday<br />12 April 2026</span>
        </header>
        <div className="ledger-record__rail"><span>OUTING</span><strong>2 expenses · 3 shares</strong><span className="landing-status landing-status--open">1 open balance</span></div>
        <div className="ledger-record__expense">
          <div><span className="technical-label">Expense</span><strong>Dinner</strong><small>Paid by you · {scenario.outing}</small></div>
          <b><Amount value={scenario.expenses[0].amount} /></b>
        </div>
        <div className="ledger-record__share-toggle">
          <span>Relationships remain attached to the amount.</span>
          <button type="button" onClick={() => setSharesOpen((open) => !open)} aria-expanded={sharesOpen} aria-controls="hero-shares">
            {sharesOpen ? "Close shares" : "Open shares"}
          </button>
        </div>
        <div className="ledger-record__shares" id="hero-shares" data-visible={sharesOpen}>
          <div className="ledger-record__shares-heading"><span className="technical-label">Friend shares</span><span>Assigned explicitly</span></div>
          {(["Rani", "Dimas"] as const).map((person) => {
            const amount = person === "Rani" ? raniAssigned : dimasAssigned;
            return (
              <button className={`ledger-share${selectedPerson === person ? " ledger-share--selected" : ""}`} type="button" key={person} onClick={() => setSelectedPerson(person)} aria-pressed={selectedPerson === person}>
                <IllustrativeAvatar id={person.toLowerCase()} />
                <span><strong>{person}</strong><small>{formatRupiah(amount)} assigned</small></span>
                <span className={`landing-status landing-status--${person === "Rani" ? "settled" : "open"}`}>{person === "Rani" ? "Settled" : "Open"}</span>
              </button>
            );
          })}
          <div className="ledger-record__selected"><span>{selectedPerson} · selected share</span><strong><Amount value={selectedAmount} /></strong><small>{selectedState}</small></div>
        </div>
        <footer className="ledger-record__footer"><span>Received from Rani</span><strong><Amount value={scenario.repayment.amount} /></strong><span>Remaining</span><strong><Amount value={scenario.openBalance.amount} /></strong></footer>
      </article>
      <div className="ledger-balance-slip" aria-hidden="true"><span className="technical-label">remaining</span><strong><Amount value={scenario.openBalance.amount} /></strong><span>Dimas / open</span></div>
      <p className="ledger-atlas__caption"><span className="technical-label">A record, not a chat thread</span><span>Names, shares, and state stay on the same surface.</span></p>
    </div>
  );
}

export function FinancialModelScene() {
  return (
    <section
      className="spatial-section model-scene"
      id="model"
      aria-labelledby="model-title"
      data-spatial-scene="model"
    >
      <div className="editorial-shell model-scene__intro">
        <p className="section-label technical-label">01 / The financial model</p>
        <div>
          <h2 id="model-title">Watch one amount become a relationship.</h2>
          <p>An expense starts the record. Shares make obligations visible. A repayment changes what remains. The same objects reorganize until the balance can be read.</p>
        </div>
      </div>
      <div className="editorial-shell model-workbench" aria-label="Expense to shares to repayment to balance relationship">
        <div className="model-workbench__axis" aria-hidden="true"><span>source</span><i /><span>state</span></div>
        <article className="model-card model-card--expense">
          <span className="technical-label">Expense</span>
          <strong>Dinner</strong>
          <small>Bandung day out · paid by you</small>
          <b><Amount value={scenario.expenses[0].amount} /></b>
        </article>
        <article className="model-card model-card--shares">
          <span className="technical-label">Shares</span>
          <strong>3 Friend shares</strong>
          <div><span>Rani</span><b><Amount value={raniAssigned} /></b></div>
          <div><span>Dimas</span><b><Amount value={dimasAssigned} /></b></div>
          <small>Assigned explicitly</small>
        </article>
        <article className="model-card model-card--repayment">
          <span className="technical-label">Repayment</span>
          <strong>Received from Rani</strong>
          <small>Allocated to Dinner + Taxi</small>
          <b><Amount value={scenario.repayment.amount} /></b>
          <span className="allocation-line"><i /></span>
        </article>
        <article className="model-card model-card--balance">
          <span className="technical-label">Balance</span>
          <strong>Dimas remains</strong>
          <small>One open share</small>
          <b><Amount value={scenario.openBalance.amount} /></b>
          <span className="landing-status landing-status--open">Open</span>
        </article>
        <p className="model-workbench__note"><span>Cause → effect</span> Nothing here is automatic. The balance is the part of the record still open.</p>
      </div>
    </section>
  );
}

type ScopeId = "personal" | "groups" | "organizations";

const scopeContent: Record<ScopeId, { number: string; label: string; eyebrow: string; title: string; copy: string; nodes: string[]; note: string }> = {
  personal: {
    number: "01",
    label: "Personal",
    eyebrow: "Friends · Outings · Expenses · Repayments",
    title: "A compact ledger for the money you front.",
    copy: "Private, owner-centric records where Friends owe you. Share a balance privately without opening the ledger.",
    nodes: ["You", "Rani", "Dimas"],
    note: "private balance sharing",
  },
  groups: {
    number: "02",
    label: "Groups",
    eyebrow: "Participants · Group expenses · Settlements · Chat",
    title: "A shared space where people and records sit together.",
    copy: "Peer-to-peer Group accounting keeps payer, shares, and settlement context explicit, with Group Chat beside it.",
    nodes: ["Ledger", "Participants", "Chat"],
    note: "conversation beside the ledger",
  },
  organizations: {
    number: "03",
    label: "Organizations",
    eyebrow: "Members · Roles & access · Ledger · History",
    title: "A more structured home for an entity's records.",
    copy: "Organization records are operated by members with the access their role allows. The accounting context becomes durable history.",
    nodes: ["Members", "Roles & access", "Ledger"],
    note: "durable organizational history",
  },
};

export function ScopeScene() {
  const [scope, setScope] = useState<ScopeId>("personal");
  const current = scopeContent[scope];
  const selectScope = (id: ScopeId) => {
    setScope(id);
    window.dispatchEvent(new CustomEvent("zplit:scope", { detail: id }));
  };

  return (
    <section
      className="spatial-section scope-scene"
      id="scopes"
      aria-labelledby="scope-title"
      data-spatial-scene="scopes"
    >
      <div className="editorial-shell scope-scene__intro">
        <div>
          <p className="section-label technical-label">02 / Three contexts</p>
          <h2 id="scope-title">The same language gains structure.</h2>
          <p>Personal, Groups, and Organizations are different accounting contexts. Switch the scope and watch the record desk rearrange without pretending they are identical.</p>
        </div>
        <div className="scope-switcher" role="group" aria-label="Illustrative Zplit contexts">
          {(Object.keys(scopeContent) as ScopeId[]).map((id) => (
            <button
              type="button"
              key={id}
              onClick={() => selectScope(id)}
              className={scope === id ? "scope-switcher__button scope-switcher__button--active" : "scope-switcher__button"}
              aria-pressed={scope === id}
            >
              <span>{scopeContent[id].number}</span>
              {scopeContent[id].label}
            </button>
          ))}
        </div>
      </div>
      <div className={`editorial-shell scope-desk scope-desk--${scope}`}>
        <div className="scope-desk__paper" aria-hidden="true"><span>CONTEXT / {current.number}</span><span>{current.note}</span></div>
        <article className="scope-desk__record">
          <header><span className="technical-label">{current.number} / {current.label}</span><span className="landing-status landing-status--settled">Illustrative</span></header>
          <div className="scope-desk__heading"><span>{current.eyebrow}</span><h3>{current.title}</h3><p>{current.copy}</p></div>
          <div className="scope-desk__nodes" aria-label={`${current.label} structure`}>
            {current.nodes.map((node, index) => {
              const detail = scope === "personal"
                ? index === 0 ? "owner" : "Friend share"
                : scope === "groups"
                  ? index === 0 ? "financial record" : index === 1 ? "people in context" : "conversation"
                  : index === 0 ? "entity participants" : index === 1 ? "access context" : "organizational record";
              return (
                <div className="scope-node" key={node} style={{ "--node-index": index } as CSSProperties}>
                  <span className="scope-node__line" aria-hidden="true" />
                  <strong>{node}</strong>
                  <small>{detail}</small>
                </div>
              );
            })}
          </div>
          <footer><span>One shared Zplit visual language</span><strong>{current.note}</strong></footer>
        </article>
      </div>
    </section>
  );
}

export function CollaborationScene() {
  return (
    <section
      className="spatial-section collaboration-scene"
      id="collaboration"
      aria-labelledby="collaboration-title"
      data-spatial-scene="collaboration"
    >
      <div className="editorial-shell collaboration-scene__intro">
        <p className="section-label technical-label">04 / Collaboration</p>
        <div>
          <h2 id="collaboration-title">Talk beside the record.</h2>
          <p>Group Chat gives participants a place to coordinate. Expenses and settlements remain their own explicit records, so conversation does not become accounting.</p>
        </div>
      </div>
      <div className="editorial-shell collaboration-desk" aria-label="Illustrative Group ledger and chat">
        <div className="collaboration-desk__rule" aria-hidden="true"><span>context</span><i /><span>conversation</span></div>
        <article className="collaboration-plane collaboration-plane--ledger">
          <header><span className="technical-label">Group / Bandung crew</span><strong>Ledger</strong></header>
          <div className="collaboration-row"><span><strong>Dinner</strong><small>Paid by Rani · 3 participants</small></span><b><Amount value={scenario.expenses[0].amount} /></b></div>
          <div className="collaboration-row"><span><strong>Settlement</strong><small>Dimas → Rani</small></span><b><Amount value={scenario.openBalance.amount} /></b></div>
          <footer><span>2 records shown</span><span className="landing-status landing-status--open">Open balance</span></footer>
        </article>
        <article className="collaboration-plane collaboration-plane--chat">
          <header><span className="technical-label">Group Chat</span><strong>General</strong></header>
          <div className="landing-chat-message landing-chat-message--other">
            <IllustrativeAvatar id="rani" />
            <p><strong>Rani</strong><span>Did we settle dinner?</span></p>
          </div>
          <div className="landing-chat-message landing-chat-message--own">
            <p><strong>You</strong><span>Repayment recorded — check the settlement record.</span></p>
            <IllustrativeAvatar id="you" />
          </div>
          <footer><span>Conversation is context.</span><span>Accounting stays explicit.</span></footer>
        </article>
      </div>
    </section>
  );
}

export function ProofScene() {
  const [receiptFocused, setReceiptFocused] = useState(false);
  const toggleReceipt = () => {
    setReceiptFocused((focused) => {
      const next = !focused;
      window.dispatchEvent(new CustomEvent("zplit:receipt", { detail: next }));
      return next;
    });
  };

  return (
    <section
      className="spatial-section proof-scene"
      id="proof"
      aria-labelledby="proof-title"
      data-spatial-scene="proof"
    >
      <div className="editorial-shell proof-scene__layout">
        <div className="proof-scene__copy">
          <p className="section-label technical-label">05 / Record + proof</p>
          <h2 id="proof-title">The explanation stays attached.</h2>
          <p>An expense can carry its outing, payer, date, shares, and attached receipt together. The amount remains readable when the question comes later.</p>
          <button
            type="button"
            className="proof-focus"
            onClick={toggleReceipt}
            aria-pressed={receiptFocused}
          >
            {receiptFocused ? "Return to expense" : "Focus receipt"}
          </button>
        </div>
        <div className={`proof-desk${receiptFocused ? " proof-desk--receipt-focused" : ""}`} aria-label="Illustrative expense record with attached receipt">
          <article className="proof-expense">
            <header><span className="technical-label">Expense / {scenario.outing}</span><span className="landing-status landing-status--settled">Recorded</span></header>
            <div className="proof-expense__title"><h3>Dinner</h3><strong><Amount value={scenario.expenses[0].amount} /></strong></div>
            <dl>
              <div><dt>Payer</dt><dd>You</dd></div>
              <div><dt>Date</dt><dd>12 Apr 2026</dd></div>
              <div><dt>Shares</dt><dd>Rani · Dimas</dd></div>
            </dl>
            <footer><span>Receipt remains with this record</span><strong>receipt.jpg</strong></footer>
          </article>
          <button
            type="button"
            className="proof-receipt"
            onClick={toggleReceipt}
            aria-pressed={receiptFocused}
          >
            <span className="receipt-mark" aria-hidden="true">RECEIPT<br />ATTACHED</span>
            <span><strong>receipt.jpg</strong><small>Supporting proof for this expense</small></span>
            <i aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function PrivateShareScene() {
  return (
    <section
      className="spatial-section private-scene"
      id="private-share"
      aria-labelledby="private-title"
      data-spatial-scene="private-share"
    >
      <div className="editorial-shell private-scene__layout">
        <div>
          <p className="section-label technical-label">06 / Private sharing</p>
          <h2 id="private-title">Share a balance. Keep the ledger private.</h2>
          <p>The owner can create a private, read-only balance link for a Friend. The shared view shows assigned shares and repayments; the owner&apos;s record remains the source.</p>
        </div>
        <div className="private-desk" aria-label="Illustrative private balance share">
          <div className="private-owner">
            <span className="technical-label">Owner ledger</span>
            <strong>Bandung day out</strong>
            <span>Private record · Dimas share</span>
            <b><Amount value={scenario.openBalance.amount} /></b>
          </div>
          <span className="private-bridge" aria-hidden="true">→</span>
          <article className="private-statement">
            <header><span>Zplit / Balance statement</span><span>Private · Read only</span></header>
            <p>Dimas</p>
            <strong><Amount value={scenario.openBalance.amount} /></strong>
            <div>
              <span>Dinner<small>{scenario.outing}</small></span>
              <b><Amount value={scenario.openBalance.amount} /></b>
            </div>
            <footer>Shared view · no ledger editing</footer>
          </article>
        </div>
      </div>
    </section>
  );
}

const findableRecords = scenario.expenses.map((expense) => ({
  title: expense.description,
  detail: `${scenario.outing} · 12 Apr 2026`,
  amount: expense.amount,
}));

export function FindabilityScene() {
  const [query, setQuery] = useState("Bandung");
  const records = findableRecords.filter((record) =>
    `${record.title} ${record.detail}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <section
      className="spatial-section findability-scene"
      id="records"
      aria-labelledby="history-title"
      data-spatial-scene="history"
    >
      <div className="editorial-shell findability-scene__layout">
        <div>
          <p className="section-label technical-label">07 / History + findability</p>
          <h2 id="history-title">Old records remain connected.</h2>
          <p>Search for the expense you remember. Use Inbox for attention. Return to history when the outing is no longer recent.</p>
        </div>
        <div className="findability-desk" aria-label="Illustrative search, inbox, and history">
          <div className="findability-search">
            <label htmlFor="public-search">Search records</label>
            <div className="findability-search__field">
              <span aria-hidden="true">Search /</span>
              <input id="public-search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="findability-search__results" aria-live="polite">
              {records.length > 0
                ? records.map((record) => (
                  <article key={record.title}>
                    <span><strong>{record.title}</strong><small>{record.detail}</small></span>
                    <b><Amount value={record.amount} /></b>
                  </article>
                ))
                : <p className="findability-search__empty">No illustrative records match this search.</p>}
            </div>
          </div>
          <div className="findability-side">
            <div className="inbox-slip">
              <span className="technical-label">Inbox</span>
              <strong>Dimas recorded a payment to you in Bandung crew.</strong>
              <small>Confirmation is required.</small>
            </div>
            <div className="history-slip">
              <span className="technical-label">History</span>
              <strong>Expense → repayment → balance</strong>
              <small>Past records remain a readable chain.</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingFinale() {
  return (
    <footer className="landing-finale" aria-labelledby="footer-title" data-spatial-scene="finale">
      <div className="editorial-shell finale-desk">
        <div className="finale-desk__marker">
          <span className="technical-label">Settlement payoff</span>
          <span>Illustrative Bandung day out</span>
        </div>
        <div className="finale-desk__headline">
          <span>When a share is fully covered,</span>
          <strong>the balance can say so.</strong>
        </div>
        <div className="finale-balances">
          <div>
            <span>Rani</span>
            <strong><Amount value={0} /></strong>
            <span className="landing-status landing-status--settled">Settled</span>
          </div>
          <div>
            <span>Dimas</span>
            <strong><Amount value={scenario.openBalance.amount} /></strong>
            <span className="landing-status landing-status--open">Open</span>
          </div>
        </div>
        <div className="landing-finale__cta">
          <div>
            <span className="footer__brand" id="footer-title">Zplit</span>
            <p>Shared expenses, made explicit.</p>
          </div>
          <a className="action-link action-link--primary" href="/app">
            Open Zplit <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
