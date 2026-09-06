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
        <article className="collaboration-ledger" data-collab-ledger>
          <header><span className="technical-label">Group / Saturday crew</span><strong>Ledger</strong></header>
          <div className="collab-ledger-row" data-related="raka"><span><strong>Market + picnic</strong><small>Paid by Raka · 3 participants</small></span><b>{formatRupiah(ledgerStory.groupExpense.amount)}</b></div>
          <div className="collab-ledger-row" data-related="sari"><span><strong>Sari owes Raka</strong><small>Original share · still open</small></span><b>{formatRupiah(ledgerStory.groupBalance.amount)}</b></div>
          <div className="collab-ledger-row" data-related="you"><span><strong>Your share</strong><small>Read-only participant view</small></span><b>{formatRupiah(ledgerStory.groupBalance.amount)}</b></div>
          <footer><span>Explicit records</span><span data-collab-badge className="record-status record-status--open">Open share</span></footer>
        </article>
        <span className="collaboration-demo__connector" data-collab-connector aria-hidden="true"><i data-collab-scan />↔</span>
        <article className="collaboration-chat" data-collab-chat>
          <header><span className="technical-label">Group Chat</span><strong>Saturday crew</strong></header>
          <div className="collab-message" data-related="raka"><Avatar id="raka" name="Raka" /><p><strong>Raka</strong><span>Receipt is attached to the market expense.</span></p></div>
          <div className="collab-message" data-related="sari"><Avatar id="sari" name="Sari" /><p><strong>Sari</strong><span>I’ll settle the open share from here.</span></p></div>
          <div className="collab-message collab-message--own" data-related="you"><p><strong>You</strong><span>Good — the share stays in the ledger.</span></p><Avatar id="you" name="You" /></div>
          <footer><span>Chat coordinates.</span><span>Records account.</span></footer>
        </article>
      </div>
      <p className="collaboration-demo__hint"><span>Trace:</span> select a person to highlight their messages and financial relationship.</p>
    </div>
  );
}

export function PrivateShareDemo() {
  const [view, setView] = useState<"owner" | "shared">("owner");
  return (
    <div className="private-demo" data-private-view={view}>
      <div className="private-demo__toolbar" role="group" aria-label="Illustrative private sharing view">
        <span className="technical-label">A read-only window into one balance</span>
        <div className="private-demo__switcher">
          <button type="button" aria-pressed={view === "owner"} onClick={() => setView("owner")}>Owner view</button>
          <button type="button" aria-pressed={view === "shared"} onClick={() => setView("shared")}>Shared view</button>
        </div>
      </div>
      <div className="private-demo__views">
        <article className="private-owner-view" data-private-panel="owner">
          <span className="technical-label">Personal / private</span>
          <strong>Saturday market</strong>
          <p>Your ledger · Sari’s open share</p>
          <b data-public-number="private-owner-balance" data-public-value={ledgerStory.personalBalance.amount}>{formatRupiah(ledgerStory.personalBalance.amount)}</b>
          <footer>Owner remains the source of the record.</footer>
        </article>
        <article className="private-shared-view" data-private-panel="shared">
          <header><span>Zplit / Balance statement</span><span>Private · Read only</span></header>
          <p>Sari</p>
          <strong data-public-number="private-shared-balance" data-public-value={ledgerStory.personalBalance.amount}>{formatRupiah(ledgerStory.personalBalance.amount)}</strong>
          <div><span>Market + picnic<small>Saturday market · 18 May 2026</small></span><b data-public-number="private-shared-line" data-public-value={ledgerStory.personalBalance.amount}>{formatRupiah(ledgerStory.personalBalance.amount)}</b></div>
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
            <span><strong>{record.title}</strong><small>{record.context} · {record.date}</small></span><b>{formatRupiah(record.amount)}</b>
          </button>
        )) : <p className="search-demo__empty">No matching record in this illustrative history.</p>}
      </div>
      <p className="search-demo__status"><span>Selected:</span> {results.find((record) => record.id === selected)?.title ?? "nothing"}</p>
    </div>
  );
}
