import type { CSSProperties } from "react";
import { ActionLink } from "@/components/editorial/action-link";
import { UserAvatar } from "@/components/identity/user-avatar";
import { formatRupiah } from "@/domain/rupiah";
import { CollaborationDemo, PrivateShareDemo, RecordSearchDemo } from "./public-interactions";
import { ledgerStory } from "./public-scenario";

function Avatar({ id, name }: { id: string; name: string }) {
  return <UserAvatar userId={`public-${id}`} decorative size="sm" alt={name} />;
}

function SceneMarker({ number, label }: { number: string; label: string }) {
  return <p className="public-scene__marker"><span>{number}</span><span className="technical-label">{label}</span></p>;
}

export function HeroScene() {
  return (
    <section className="public-scene public-hero" data-public-scene="hero" aria-labelledby="page-title">
      <div className="public-scene__stage public-hero__stage" data-scene-stage>
        <div className="public-hero__wash" aria-hidden="true" />
        <div className="public-hero__layout editorial-shell editorial-grid">
          <div className="public-hero__copy" data-hero-copy>
            <SceneMarker number="00" label="Zplit / shared money, made legible" />
            <h1 id="page-title">Make the number make sense.</h1>
            <p className="public-hero__lede">Zplit keeps the expense, the people, the proof, and the balance in the same story.</p>
            <div className="public-hero__actions">
              <ActionLink href="/app" variant="primary" data-magnetic>Open Zplit <span aria-hidden="true">↗</span></ActionLink>
              <a className="public-text-link" href="#record-flow">Follow one record <span aria-hidden="true">↓</span></a>
            </div>
            <p className="public-hero__note"><span>Personal · Groups · Organizations</span><br />Different contexts. Explicit records.</p>
          </div>

          <div className="hero-composition" aria-label={`Illustrative ${ledgerStory.outing} expense record`} data-hero-card>
            <div className="hero-composition__orbit" data-hero-orbit aria-hidden="true"><span /><span /><span /></div>
            <div className="hero-composition__label hero-composition__label--top"><span className="technical-label">A record in motion</span><span>drag the page / watch the state</span></div>
            <article className="hero-product-record">
              <header>
                <div><span className="technical-label">Personal · Outing</span><h2>{ledgerStory.outing}</h2></div>
                <span>{ledgerStory.date}</span>
              </header>
              <div className="hero-product-record__summary"><span>2 expenses</span><span>2 Friend shares</span><span className="record-status record-status--open">1 open</span></div>
              <div className="hero-product-record__main">
                <div className="hero-product-record__title"><span className="technical-label">Expense</span><strong>{ledgerStory.expenses[0].title}</strong><small>Paid by you · {ledgerStory.outing}</small></div>
                <strong className="hero-product-record__amount" data-public-number="hero-expense" data-public-value={ledgerStory.expenses[0].amount}>{formatRupiah(ledgerStory.expenses[0].amount)}</strong>
              </div>
              <div className="hero-product-record__people">
                {ledgerStory.personalShares.map((person) => (
                  <div className="hero-person" key={person.id}>
                    <Avatar id={person.id} name={person.name} />
                    <span><strong>{person.name}</strong><small>{formatRupiah(person.amount)} share</small></span>
                    <span className={`record-status ${person.id === "raka" ? "record-status--settled" : "record-status--open"}`}>{person.id === "raka" ? "Settled" : "Open"}</span>
                  </div>
                ))}
              </div>
              <footer><span>Received from Raka</span><strong data-public-number="hero-repayment" data-public-value={ledgerStory.repayment.amount}>{formatRupiah(ledgerStory.repayment.amount)}</strong><span>Remaining</span><strong data-public-number="hero-balance" data-public-value={ledgerStory.personalBalance.amount}>{formatRupiah(ledgerStory.personalBalance.amount)}</strong></footer>
            </article>
            <div className="hero-composition__label hero-composition__label--bottom"><span data-hero-bridge /><span>amount → relationship → state</span></div>
          </div>
        </div>
        <a className="public-scroll-cue" href="#record-flow"><span><b>NEXT</b> / enter the record</span><i aria-hidden="true">↓</i></a>
      </div>
    </section>
  );
}

export function RecordFlowScene() {
  const expense = ledgerStory.expenses[0];
  return (
    <section className="public-scene record-flow" id="record-flow" data-public-scene="record-flow" aria-labelledby="record-flow-title">
      <div className="public-scene__stage record-flow__stage" data-scene-stage>
        <div className="record-flow__layout editorial-shell">
          <div className="record-flow__copy">
            <SceneMarker number="01" label="The record / four readable states" />
            <h2 id="record-flow-title">Follow the amount.</h2>
            <p>One expense becomes a chain you can inspect: source amount, explicit shares, a recorded repayment, and what remains open.</p>
            <ol className="flow-steps" aria-label="Expense record states">
              <li><span>01</span><strong>Capture the expense</strong><small>What was paid, and where.</small></li>
              <li><span>02</span><strong>Assign the shares</strong><small>Who owes which amount.</small></li>
              <li><span>03</span><strong>Record repayment</strong><small>What money was received.</small></li>
              <li><span>04</span><strong>Read the balance</strong><small>The part still open.</small></li>
            </ol>
          </div>
          <div className="flow-interface" aria-label="Illustrative expense, shares, repayment, and balance sequence">
            <div className="flow-interface__topline"><span className="technical-label">Personal ledger / {ledgerStory.outing}</span><span className="flow-interface__state" data-flow-state-label>CAPTURED</span></div>
            <div className="flow-interface__track" aria-hidden="true"><span data-flow-progress /><i data-flow-ambient-rule /></div>
            <article className="flow-card flow-card--expense" data-flow-expense>
              <div><span className="technical-label">Expense</span><strong>{expense.title}</strong><small>Paid by you · {ledgerStory.date}</small></div>
              <b data-public-number="flow-expense" data-public-value={expense.amount}>{formatRupiah(expense.amount)}</b>
            </article>
            <article className="flow-card flow-card--shares" data-flow-shares>
              <header><span className="technical-label">Shares / explicit</span><strong>Friends in the record</strong></header>
              {ledgerStory.personalShares.map((person) => (
                <div className="flow-share-row" data-flow-share-row key={person.id}>
                  <span>
                    <Avatar id={person.id} name={person.name} />
                    <strong>{person.name}</strong>
                  </span>
                  <b data-public-number={`flow-share-${person.id}`} data-public-value={person.amount}>{formatRupiah(person.amount)}</b>
                  <i style={{ "--share-width": person.id === "raka" ? "58%" : "44%" } as CSSProperties} />
                </div>
              ))}
              <footer><span>Assigned shares</span><b data-public-number="flow-assigned" data-public-value={210_000}>{formatRupiah(210_000)}</b></footer>
            </article>
            <article className="flow-card flow-card--repayment" data-flow-repayment>
              <div><span className="technical-label">Repayment / recorded</span><strong>Received from Raka</strong><small>Allocated to Raka’s share</small></div>
              <b data-public-number="flow-repayment" data-public-value={ledgerStory.repayment.amount}>{formatRupiah(ledgerStory.repayment.amount)}</b>
            </article>
            <aside className="flow-balance" data-flow-balance>
              <span className="technical-label">Balance / current state</span>
              <strong data-public-number="flow-balance" data-public-value={ledgerStory.personalBalance.amount}>{formatRupiah(ledgerStory.personalBalance.amount)}</strong>
              <p><b>{ledgerStory.personalBalance.friend}</b> remains open.</p>
              <span className="record-status record-status--open">Open share</span>
              <span className="flow-balance__resolved" data-flow-resolved>One relationship resolved; one remains visible.</span>
            </aside>
            <p className="flow-interface__footnote"><span>Nothing here is automatic.</span> The illustration shows how explicit records relate.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ContextsScene() {
  return (
    <section className="public-scene contexts-scene" id="contexts" data-public-scene="contexts" aria-labelledby="contexts-title">
      <div className="public-scene__stage contexts-scene__stage" data-scene-stage>
        <div className="contexts-scene__layout editorial-shell">
          <div className="contexts-scene__copy">
            <SceneMarker number="02" label="Scope / the context changes the record" />
            <h2 id="contexts-title">Same clarity. Different money worlds.</h2>
            <p>Personal, Groups, and Organizations stay distinct because who owns the ledger, who can participate, and who can act all matter.</p>
            <div className="scope-progress" aria-hidden="true"><span data-scope-track /></div>
            <p className="scope-progress__caption"><span>NEXT / widen the room</span><span><b data-scope-active-label>PERSONAL</b> · <span data-scope-index>01 / 03</span></span></p>
          </div>
          <div className="scope-viewport" aria-label="Illustrative Zplit contexts">
            <div className="scope-state scope-state--personal" data-scope-personal>
              <header><span className="technical-label">Personal / private ledger</span><span className="scope-state__number">01</span></header>
              <div className="scope-state__body"><div className="scope-state__title"><span className="scope-glyph scope-glyph--personal">P</span><h3>Personal</h3><p>You front money; Friends owe you.</p></div><div className="scope-lines"><span><b>Owner</b><em>You</em></span><span><b>Friends</b><em>2 linked / 1 open</em></span><span><b>Records</b><em>Expenses · Repayments</em></span></div></div>
              <footer><span className="record-status record-status--open">Private</span><span>Friends · Outings · Shares</span></footer>
            </div>
            <div className="scope-state scope-state--group" data-scope-group>
              <header><span className="technical-label">Group / peer-to-peer accounting</span><span className="scope-state__number">02</span></header>
              <div className="scope-state__body">
                <div className="scope-state__title">
                  <span className="scope-glyph scope-glyph--group">G</span>
                  <h3>Groups</h3>
                  <p>The payer can change per expense.</p>
                </div>
                <div className="scope-network">
                  <span><Avatar id="raka" name="Raka" /><b>Raka</b><small>paid</small></span>
                  <i aria-hidden="true">↔</i>
                  <span><Avatar id="sari" name="Sari" /><b>Sari</b><small>owes</small></span>
                  <i aria-hidden="true">↔</i>
                  <span><Avatar id="you" name="You" /><b>You</b><small>member</small></span>
                </div>
              </div>
              <footer><span className="record-status record-status--settled">Peer-to-peer</span><span>Participants · Settlements · Chat</span></footer>
            </div>
            <div className="scope-state scope-state--organization" data-scope-organization>
              <header><span className="technical-label">Organization / operated ledger</span><span className="scope-state__number">03</span></header>
              <div className="scope-state__body">
                <div className="scope-state__title">
                  <span className="scope-glyph scope-glyph--organization">O</span>
                  <h3>Organizations</h3>
                  <p>Members act with the access their role allows.</p>
                </div>
                <div className="role-table">
                  <span><b>Owner</b><em>Ledger · settings</em></span>
                  <span><b>Treasurer</b><em>Expenses · repayments</em></span>
                  <span><b>Member</b><em>Read what is shared</em></span>
                </div>
              </div>
              <footer><span className="record-status record-status--settled">Role-aware</span><span>Members · Access · History</span></footer>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CollaborationScene() {
  return (
    <section className="public-scene collaboration-scene" id="collaboration" data-public-scene="collaboration" aria-labelledby="collaboration-title">
      <div className="public-scene__stage collaboration-scene__stage" data-scene-stage>
        <div className="collaboration-scene__layout editorial-shell">
          <div className="collaboration-scene__copy">
            <SceneMarker number="03" label="Together / conversation beside the record" />
            <h2 id="collaboration-title">Talk around it. Keep it accounted for.</h2>
            <p>Group Chat gives people somewhere to coordinate. The ledger remains the place where expenses and settlements become explicit.</p>
          </div>
          <CollaborationDemo />
        </div>
      </div>
    </section>
  );
}

export function ProofScene() {
  return (
    <section className="public-scene proof-scene" id="proof" data-public-scene="proof" aria-labelledby="proof-title">
      <div className="public-scene__stage proof-scene__stage" data-scene-stage>
      <div className="proof-scene__layout editorial-shell">
        <div className="proof-scene__copy">
          <SceneMarker number="04" label="Evidence / context that stays attached" />
          <h2 id="proof-title">A number can carry its proof.</h2>
          <p>Keep the payer, date, shares, outing, and an attached receipt together. Later, the question has somewhere precise to land.</p>
          <p className="quiet-note">Receipts are supporting evidence for an expense; they do not change the financial facts.</p>
        </div>
        <article className="proof-record" aria-label="Illustrative expense with receipt attached">
          <header><span className="technical-label">Expense detail / {ledgerStory.outing}</span><span className="record-status record-status--settled">Recorded</span></header>
          <div className="proof-record__headline" data-related="proof"><div><h3>{ledgerStory.expenses[0].title}</h3><span>Paid by you · {ledgerStory.date}</span></div><strong data-public-number="proof-expense" data-public-value={ledgerStory.expenses[0].amount}>{formatRupiah(ledgerStory.expenses[0].amount)}</strong></div>
          <dl><div><dt>Payer</dt><dd>You</dd></div><div><dt>Shares</dt><dd>Raka · Sari</dd></div><div><dt>Outing</dt><dd>{ledgerStory.outing}</dd></div></dl>
          <div className="proof-receipt__link" data-proof-receipt-link aria-hidden="true"><span /> source expense <span /></div>
          <div className="proof-receipt" data-proof-receipt data-related="proof"><span className="proof-receipt__stamp">RECEIPT<br />ATTACHED</span><span><strong>market-picnic.jpg</strong><small>Supporting proof for this expense</small></span><span aria-hidden="true">↗</span></div>
        </article>
      </div>
      </div>
    </section>
  );
}

export function PrivateAndHistoryScene() {
  return (
    <section className="public-scene private-history-scene" id="records" data-public-scene="records" aria-labelledby="records-title">
      <div className="public-scene__stage private-history-scene__stage" data-scene-stage>
        <div className="private-history-scene__layout editorial-shell">
          <div className="private-history-scene__copy">
            <SceneMarker number="05" label="After / share less, find more" />
            <h2 id="records-title">The record can travel without losing its shape.</h2>
            <p>Expose one relevant balance through a private, read-only share. Search the history when the details matter again.</p>
            <div className="after-handoff" aria-hidden="true"><span data-after-handoff-line /><span>OWNER</span><b>→</b><span data-after-handoff-state>SHARED</span></div>
            <PrivateShareDemo />
          </div>
          <div className="history-panel">
            <div className="history-panel__intro">
              <span className="technical-label">Search / history / inbox</span>
              <strong>Find it again. Keep the trail.</strong>
            </div>
            <div className="history-workspace">
              <div className="history-panel__rail" data-history-rail aria-label="Illustrative recent record rail">
                <div className="history-rail__head"><span>Recent records</span><span data-history-counter>02 / 02</span></div>
                <button className="history-rail__record history-rail__record--active" type="button" data-history-slip="market"><span><b>Market + picnic</b><small>Saturday market · Shared</small></span><strong data-public-number="history-market" data-public-value={ledgerStory.expenses[0].amount}>{formatRupiah(ledgerStory.expenses[0].amount)}</strong></button>
                <button className="history-rail__record" type="button" data-history-slip="train"><span><b>Train home</b><small>Saturday market · Personal</small></span><strong data-public-number="history-train" data-public-value={ledgerStory.expenses[1].amount}>{formatRupiah(ledgerStory.expenses[1].amount)}</strong></button>
                <div className="history-rail__tail"><span data-history-rule />record → share → history</div>
              </div>
              <div className="history-panel__search">
                <RecordSearchDemo />
                <div className="history-panel__inbox"><span className="technical-label">Inbox / one action</span><strong>Attention has a place.</strong><small>Review an incoming request or payment record.</small><span className="record-status record-status--open" data-history-inbox-status>1 to review</span></div>
              </div>
            </div>
            <div className="history-panel__slips">
              <div><span className="technical-label">Shared</span><strong>Read-only by design.</strong><small>The owner remains the source of the record.</small></div>
              <div><span className="technical-label">History</span><strong>Search returns context.</strong><small>Amounts and relationships stay attached.</small></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingFinale() {
  return (
    <footer className="public-scene public-finale" id="finale" data-public-scene="finale" aria-labelledby="finale-title">
      <div className="public-finale__rule" aria-hidden="true"><span /><span /><span /></div>
      <div className="public-finale__layout editorial-shell">
        <div><SceneMarker number="06" label="End state / quiet enough to trust" /><h2 id="finale-title">No loose ends.<br />Just the record.</h2><p>Shared money is easier to talk about when the facts stay attached.</p></div>
        <div className="public-finale__action"><span className="public-finale__wordmark">Zplit</span><ActionLink href="/app" variant="primary" data-magnetic>Open Zplit <span aria-hidden="true">↗</span></ActionLink></div>
      </div>
    </footer>
  );
}
