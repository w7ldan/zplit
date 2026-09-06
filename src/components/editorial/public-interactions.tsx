"use client";

import { useMemo, useState } from "react";
import { UserAvatar } from "@/components/identity/user-avatar";
import { formatRupiah } from "@/domain/rupiah";
import { ledgerStory } from "./public-scenario";

function Avatar({ id, name }: { id: string; name: string }) {
  return <UserAvatar userId={`public-${id}`} decorative size="sm" alt={name} />;
}

export function CollaborationDemo() {
  const [selected, setSelected] = useState("raka");
  const people = [{ id: "raka", name: "Raka" }, { id: "sari", name: "Sari" }, { id: "you", name: "You" }];

  return (
    <div className="collaboration-demo" data-selected-person={selected}>
      <div className="collaboration-demo__people" role="group" aria-label="Choose a participant to trace through the record">
        {people.map((person) => (
          <button
            className={`participant-chip${selected === person.id ? " participant-chip--selected" : ""}`}
            data-related={person.id}
            key={person.id}
            onPointerEnter={() => setSelected(person.id)}
            onFocus={() => setSelected(person.id)}
            onClick={() => setSelected(person.id)}
            type="button"
            aria-pressed={selected === person.id}
          >
            <Avatar id={person.id} name={person.name} />
            <span>{person.name}</span>
          </button>
        ))}
      </div>
      <div className="collaboration-demo__surfaces">
        <article className="collaboration-chat" data-collab-chat>
          <header><span className="technical-label">Group Chat</span><strong>Chat coordinates.</strong></header>
          <div className="collab-message" data-related="raka"><Avatar id="raka" name="Raka" /><p><strong>Raka</strong><span>Shall we meet at the market at ten?</span></p></div>
          <div className="collab-message" data-related="sari"><Avatar id="sari" name="Sari" /><p><strong>Sari</strong><span>Yes — I’ll bring the picnic blanket.</span></p></div>
          <div className="collab-message collab-message--own" data-related="you"><p><strong>You</strong><span>See you both there.</span></p><Avatar id="you" name="You" /></div>
          <footer><span>Chat coordinates.</span><span>Records account.</span></footer>
        </article>
        <div className="collaboration-demo__connector" data-collab-connector><strong>CHAT ≠ LEDGER</strong><span>Conversation does not create<br />or change a financial record.</span></div>
        <article className="collaboration-ledger" data-collab-ledger>
          <header><span className="technical-label">Group alternative / before settlement</span><strong>Ledger accounts.</strong></header>
          <div className="collab-ledger-row" data-related="you">
            <span>
              <strong>Market + picnic</strong>
              <small>Paid by you · 3 participants</small>
            </span>
            <b>{formatRupiah(ledgerStory.groupExpense.amount)}</b>
          </div>
          <div className="collab-ledger-row" data-related="sari">
            <span>
              <strong>Sari owes you</strong>
              <small>Original share · still open</small>
            </span>
            <b>{formatRupiah(ledgerStory.groupBalance.amount)}</b>
          </div>
          <div className="collab-ledger-row" data-related="raka">
            <span>
              <strong>Raka owes you</strong>
              <small>Explicit participant share</small>
            </span>
            <b>{formatRupiah(ledgerStory.personalShares[0].amount)}</b>
          </div>
          <footer><span>Explicit records</span><span data-collab-badge className="record-status record-status--open">Open share</span></footer>
        </article>

      </div>
      <p className="collaboration-demo__hint"><span>Trace:</span> select a person to highlight their messages and financial relationship.</p>
    </div>
  );
}

export function PrivateShareDemo() {
  return (
    <div className="private-demo" data-private-view="owner">
      <div className="private-demo__views">
        <article className="private-owner-view" data-private-panel="owner" data-related="owner">
          <span className="technical-label">01 / Owner record · Personal</span>
          <strong>Market + picnic</strong><small>Saturday market · {ledgerStory.date} · Expense {formatRupiah(ledgerStory.expenses[0].amount)}</small>
          <p>Your ledger · Sari’s open share</p>
          <b data-public-number="private-owner-balance" data-public-value={ledgerStory.personalBalance.amount}>{formatRupiah(ledgerStory.personalBalance.amount)}</b>
          <footer>Owner remains the source of the record.</footer>
        </article>
        <article className="private-shared-view" data-private-panel="shared" data-related="shared">
          <header><span>02 / Private balance statement</span><span>Private · Read only</span></header>
          <p>Sari</p>
          <strong data-public-number="private-shared-balance" data-public-value={ledgerStory.personalBalance.amount}>{formatRupiah(ledgerStory.personalBalance.amount)}</strong>
          <div>
            <span>Market + picnic<small>Saturday market · 16 May 2026</small>
            </span>
            <b data-public-number="private-shared-line" data-public-value={ledgerStory.personalBalance.amount}>{formatRupiah(ledgerStory.personalBalance.amount)}</b>
          </div>
          <footer>Shared view · no ledger editing</footer>
        </article>
      </div>
    </div>
  );
}

export function RecordSearchDemo() {
  const [query, setQuery] = useState("market");
  const [selected, setSelected] = useState<string>(ledgerStory.searchRecords[0].id);
  const results = useMemo(() => ledgerStory.searchRecords.filter((record) => record.title.toLowerCase().includes(query.toLowerCase())), [query]);
  return (
    <div className="search-demo">
      <label htmlFor="public-record-search">Search the record</label>
      <div className="search-demo__input"><span aria-hidden="true">⌕</span><input id="public-record-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="search-demo__results" aria-live="polite">
        {results.length > 0 ? results.map((record) => (
          <button className={`search-result${selected === record.id ? " search-result--selected" : ""}`} key={record.id} onClick={() => setSelected(record.id)} type="button" aria-pressed={selected === record.id}>
            <span>
              <strong>{record.title}</strong>
              <small>{record.context} · {record.date}</small>
              <small>{record.id === "market" ? "Paid by you · Raka + Sari · market-picnic.jpg" : "Paid by you · travel expense"}</small>
            </span>
            <b>{formatRupiah(record.amount)}</b>
          </button>
        )) : <p className="search-demo__empty">No matching record in this illustrative history.</p>}
      </div>
      <p className="search-demo__status"><span>Selected:</span> {results.find((record) => record.id === selected)?.title ?? "nothing"}</p>
    </div>
  );
}
