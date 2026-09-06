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
              <li aria-current="step"><span>01</span><strong>Capture the expense</strong><small>What was paid, and where.</small></li>
              <li><span>02</span><strong>Assign the shares</strong><small>Who owes which amount.</small></li>
              <li><span>03</span><strong>Record repayment</strong><small>What money was received.</small></li>
              <li><span>04</span><strong>Read the balance</strong><small>The part still open.</small></li>
            </ol>
          </div>
          <div className="flow-interface" data-flow-active-step="0" aria-label="Illustrative expense, shares, repayment, and balance sequence">
            <div className="flow-interface__topline">
              <span className="technical-label">Personal ledger / {ledgerStory.outing}</span>
              <span className="flow-interface__state" data-flow-state-label>CAPTURED</span>
            </div>
            <div className="flow-interface__track" aria-hidden="true"><span data-flow-progress /></div>
            <div className="flow-composition">
              <article className="flow-card flow-card--expense" data-flow-expense data-expanded="true">
                <div><span className="technical-label">Expense</span><strong>{expense.title}</strong><small>Paid by you · {ledgerStory.date}</small></div>
                <b data-public-number="flow-expense" data-public-value={expense.amount}>{formatRupiah(expense.amount)}</b>
              </article>
              <article className="flow-card flow-card--shares" data-flow-shares>
                <header><span className="technical-label">Shares / explicit</span><strong>Friends in the record</strong></header>
                {ledgerStory.personalShares.map((person) => (
                  <div className="flow-share-row" data-flow-share-row data-related={person.id} key={person.id}>
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
            </div>
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
            <h2 id="contexts-title">Same situation. Different structure.</h2>
            <p>Personal, Groups, and Organizations stay distinct because who owns the ledger, who can participate, and who can act all matter.</p>
            <div className="scope-progress" aria-hidden="true"><span data-scope-track /></div>
            <p className="scope-progress__caption"><span>NEXT / widen the room</span><span><b data-scope-active-label>PERSONAL</b> · <span data-scope-index>01 / 03</span></span></p>
          </div>
          <div className="scope-viewport" aria-label="Same situation, different financial structures">
            <div className="scope-source">
              <span className="technical-label">Same situation / illustrative alternatives</span>
              <strong>{ledgerStory.expenses[0].title}</strong>
              <b>{formatRupiah(ledgerStory.expenses[0].amount)}</b>
              <small>{ledgerStory.outing} · {ledgerStory.date}</small>
            </div>
            <div className="scope-contexts">
              <article className="scope-state" data-scope-personal>
                <header><span className="technical-label">Personal</span><h3>You are the source.</h3></header>
                <div className="scope-topology scope-topology--personal">
                  <strong className="scope-anchor">You <small>Owner · fronts the expense</small>
                  </strong>
                  <div className="scope-relations">
                    <span data-related="raka">Raka <b>120,000 → you</b>
                    </span>
                    <span data-related="sari">Sari <b>90,000 → you</b>
                    </span>
                  </div>
                </div>
                <footer>Friend shares point back to your private ledger. Repayments are recorded by the owner.</footer>
              </article>
              <article className="scope-state" data-scope-group>
                <header><span className="technical-label">Group / Saturday crew</span><h3>People owe people.</h3></header>
                <div className="scope-topology scope-topology--group">
                  <strong className="scope-anchor">You <small>Payer on this expense · own portion 150,000</small>
                  </strong>
                  <div className="scope-relations">
                    <span data-related="raka">Raka <b>120,000 → you</b>
                    </span>
                    <span data-related="sari">Sari <b>90,000 → you</b>
                    </span>
                  </div>
                  <p className="scope-peer-rule">Next expense: any registered participant may pay.<br />Settlements connect debtor → creditor in the Group.</p>
                </div>
                <footer>Financial relationships belong to participants, not to the Group owner.</footer>
              </article>
              <article className="scope-state" data-scope-organization>
                <header><span className="technical-label">Organization / illustrative market team</span><h3>The entity holds the ledger.</h3></header>
                <div className="scope-access"><span>Owner / Admin / Treasurer</span><b>↓ permitted operations</b><small>Membership & access roles</small></div>
                <div className="scope-topology scope-topology--organization">
                  <strong className="scope-anchor">Organization ledger <small>Entity fronts the expense</small>
                  </strong>
                  <div className="scope-relations">
                    <span data-related="raka">Raka <b>120,000 → entity</b>
                    </span>
                    <span data-related="sari">Sari <b>90,000 → entity</b>
                    </span>
                  </div>
                </div>
                <footer>Financial participants & history stay organization-scoped. Membership does not create a financial share.</footer>
              </article>
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
            <div className="proof-record__headline" data-related="proof">
              <div>
                <h3>{ledgerStory.expenses[0].title}</h3>
                <span>Paid by you · {ledgerStory.date}</span>
              </div>
              <strong data-public-number="proof-expense" data-public-value={ledgerStory.expenses[0].amount}>{formatRupiah(ledgerStory.expenses[0].amount)}</strong>
            </div>
            <dl><div><dt>Payer</dt><dd>You</dd></div><div><dt>Shares</dt><dd>Raka · Sari</dd></div><div><dt>Outing</dt><dd>{ledgerStory.outing}</dd></div></dl>
            <div className="proof-receipt__link" data-proof-receipt-link aria-hidden="true"><span /> source expense <span /></div>
            <div className="proof-receipt" data-proof-receipt data-related="proof" tabIndex={0}>
              <header>
                <span className="technical-label">Illustrative receipt</span>
                <h4>{ledgerStory.receipt.merchant}</h4>
                <small>{ledgerStory.date} · {ledgerStory.receipt.time}<br />{ledgerStory.receipt.reference}</small>
              </header>
              <div className="proof-receipt__items">{ledgerStory.receipt.items.map((item) => <div key={item.label}><span>{item.label}</span><b>{formatRupiah(item.amount)}</b></div>)}</div>
              <div className="proof-receipt__total"><span>Total</span><strong>{formatRupiah(ledgerStory.expenses[0].amount)}</strong></div>
              <footer><span className="proof-receipt__stamp">ATTACHED</span><strong>{ledgerStory.receipt.filename}</strong><small>Supporting evidence · manually attached</small></footer>
            </div>
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
          </div>
          <div className="record-lifecycle">
            <PrivateShareDemo />
            <div className="history-panel" data-related="history">
              <div className="history-panel__intro"><span className="technical-label">03 / Find the context again</span><strong>The same record. Later.</strong></div>
              <RecordSearchDemo />
              <p className="lifecycle-inbox">Inbox keeps requests and review actions separate from record history.</p>
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
