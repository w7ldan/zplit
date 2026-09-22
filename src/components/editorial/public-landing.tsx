import { ActionLink } from "@/components/editorial/action-link";
import { UserAvatar } from "@/components/identity/user-avatar";
import { formatRupiah } from "@/domain/rupiah";

const example = {
  expense: 360_000,
  shares: [
    { id: "raka", name: "Raka", amount: 120_000, state: "Settled" },
    { id: "sari", name: "Sari", amount: 90_000, state: "Open" },
    { id: "you", name: "You", amount: 150_000, state: "Your share" },
  ],
  repayment: 120_000,
  remaining: 90_000,
} as const;

function Marker({ number, label }: { number: string; label: string }) {
  return (
    <p className="public-vnext__marker">
      <span className="public-vnext__marker-number">{number}</span>
      <span className="technical-label">{label}</span>
    </p>
  );
}

function ExampleAvatar({ id, name }: { id: string; name: string }) {
  return <UserAvatar userId={`public-example-${id}`} decorative size="sm" alt={name} />;
}

function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={`public-vnext__money tabular-nums ${className}`.trim()}>{formatRupiah(amount)}</span>;
}

function HeroRecord() {
  return (
    <article className="public-vnext__hero-record" aria-label="Illustrative personal expense record">
      <header className="public-vnext__record-header">
        <div>
          <span className="technical-label">Illustrative personal record</span>
          <h2>Saturday market</h2>
        </div>
        <span className="public-vnext__record-date">16 May 2026</span>
      </header>
      <div className="public-vnext__record-expense">
        <div>
          <span className="technical-label">Expense</span>
          <strong>Market + picnic</strong>
          <small>Paid by you · 3 participants</small>
        </div>
        <Money amount={example.expense} className="public-vnext__record-amount" />
      </div>
      <div className="public-vnext__record-status">
        <span>Recorded</span>
        <span>2 shares open</span>
        <span>1 repayment recorded</span>
      </div>
      <footer className="public-vnext__record-footer">
        <span className="public-vnext__record-footer-label">Remaining with Sari</span>
        <Money amount={example.remaining} />
      </footer>
    </article>
  );
}

export function PublicLanding() {
  return (
    <main>
      <section className="public-vnext__hero" aria-labelledby="public-title">
        <div className="public-vnext__hero-layout editorial-shell">
          <div className="public-vnext__hero-copy">
            <Marker number="00" label="Zplit / shared money, made legible" />
            <h1 id="public-title">Record shared money. See what remains.</h1>
            <p className="public-vnext__hero-lede">
              Zplit keeps the expense, explicit shares, repayments, and context in one private ledger.
            </p>
            <div className="public-vnext__actions">
              <ActionLink href="/app" variant="primary">Open Zplit <span aria-hidden="true">↗</span></ActionLink>
              <a className="public-vnext__text-link" href="#record">See one record <span aria-hidden="true">↓</span></a>
            </div>
            <p className="public-vnext__hero-note">Invite-only access · Personal · Budget · Groups · Organizations</p>
          </div>
          <div className="public-vnext__hero-example">
            <div className="public-vnext__example-caption">
              <span className="technical-label">A compact product view</span>
              <span>synthetic data</span>
            </div>
            <HeroRecord />
          </div>
        </div>
      </section>

      <section className="public-vnext__section public-vnext__section--record" id="record" aria-labelledby="record-title">
        <div className="public-vnext__section-layout editorial-shell">
          <div className="public-vnext__section-copy">
            <Marker number="01" label="Record / responsibility stays explicit" />
            <h2 id="record-title">One record. Clearly followed.</h2>
            <p>
              Start with what was paid, assign each person’s share, record what moved, and leave the remaining responsibility visible.
            </p>
          </div>
          <div className="public-vnext__flow" aria-label="Illustrative expense record sequence">
            <article className="public-vnext__flow-step public-vnext__flow-step--expense">
              <span className="technical-label">01 / Expense</span>
              <strong>Market + picnic</strong>
              <small>Paid by you</small>
              <Money amount={example.expense} />
            </article>
            <article className="public-vnext__flow-step public-vnext__flow-step--shares">
              <span className="technical-label">02 / Shares</span>
              <strong>Who owes which amount</strong>
              <div className="public-vnext__share-list">
                {example.shares.map((share) => (
                  <div className="public-vnext__share-row" key={share.id}>
                    <span className="public-vnext__person">
                      <ExampleAvatar id={share.id} name={share.name} />
                      <span>{share.name}</span>
                    </span>
                    <span className="public-vnext__share-value"><Money amount={share.amount} /></span>
                    <small>{share.state}</small>
                  </div>
                ))}
              </div>
            </article>
            <article className="public-vnext__flow-step public-vnext__flow-step--repayment">
              <span className="technical-label">03 / Repayment</span>
              <strong>What money moved</strong>
              <small>Received from Raka</small>
              <Money amount={example.repayment} />
            </article>
            <article className="public-vnext__flow-step public-vnext__flow-step--remaining">
              <span className="technical-label">04 / Remaining</span>
              <strong>What is still open</strong>
              <small>Sari owes you</small>
              <Money amount={example.remaining} />
            </article>
          </div>
        </div>
      </section>

      <section className="public-vnext__section public-vnext__section--contexts" id="contexts" aria-labelledby="contexts-title">
        <div className="public-vnext__section-layout editorial-shell">
          <div className="public-vnext__section-copy">
            <Marker number="02" label="Contexts / not every relationship is the same" />
            <h2 id="contexts-title">Use the structure the money needs.</h2>
            <p>Zplit keeps different kinds of shared money distinct instead of forcing them into one model.</p>
          </div>
          <ol className="public-vnext__context-list">
            <li className="public-vnext__context-item">
              <div className="public-vnext__context-name"><span>01</span><strong>Personal</strong></div>
              <div><p>Private records for friends, trips, outings, expenses, shares, repayments, and balance links.</p><small>Budget stays private while classifying actual Personal and Group cash movement.</small></div>
            </li>
            <li className="public-vnext__context-item">
              <div className="public-vnext__context-name"><span>02</span><strong>Groups</strong></div>
              <div><p>Peer-to-peer accounting for participants, payer claims, settlements, offsets, Chat, and history.</p><small>Conversation can coordinate the group; it does not create a financial record.</small></div>
            </li>
            <li className="public-vnext__context-item">
              <div className="public-vnext__context-name"><span>03</span><strong>Organizations</strong></div>
              <div><p>A scoped collaborative ledger with capability-based access for the people and records in that space.</p><small>Its permissions and responsibilities are not the same as a peer Group.</small></div>
            </li>
          </ol>
        </div>
      </section>

      <section className="public-vnext__section public-vnext__section--context" id="context" aria-labelledby="context-title">
        <div className="public-vnext__section-layout editorial-shell">
          <div className="public-vnext__section-copy">
            <Marker number="03" label="Context / the number keeps its surroundings" />
            <h2 id="context-title">Keep the question attached to the record.</h2>
            <p>Dates, people, outings, Chat, and receipts help explain a number without silently changing what the ledger says.</p>
          </div>
          <div className="public-vnext__context-workbench">
            <article className="public-vnext__evidence-record" aria-label="Illustrative expense with supporting evidence">
              <header><span className="technical-label">Expense detail</span><span className="public-vnext__state public-vnext__state--settled">Recorded</span></header>
              <div className="public-vnext__evidence-heading"><div><h3>Market + picnic</h3><span>Paid by you · 16 May 2026</span></div><Money amount={example.expense} /></div>
              <dl className="public-vnext__evidence-meta"><div><dt>Payer</dt><dd>You</dd></div><div><dt>Shares</dt><dd>Raka · Sari</dd></div><div><dt>Outing</dt><dd>Saturday market</dd></div></dl>
              <div className="public-vnext__receipt"><span className="technical-label">Illustrative receipt</span><strong>Market provisions</strong><span>16 May 2026 · MKT-160526-014</span><footer><span>Supporting evidence</span><span>market-picnic.jpg</span></footer></div>
              <p className="public-vnext__evidence-note">A receipt supports context. It does not confirm or change the financial state by itself.</p>
            </article>
            <div className="public-vnext__context-note"><span className="technical-label">Traceable by design</span><strong>One question, one place to look.</strong><p>Who paid? Who owes? What moved? The surrounding context stays close enough to answer.</p></div>
          </div>
        </div>
      </section>

      <section className="public-vnext__section public-vnext__section--private" id="private" aria-labelledby="private-title">
        <div className="public-vnext__section-layout editorial-shell">
          <div className="public-vnext__section-copy">
            <Marker number="04" label="Private / share only what is relevant" />
            <h2 id="private-title">The ledger stays private by default.</h2>
            <p>Personal Budget classification remains yours. Account access stays controlled. A balance can travel through a temporary, read-only link without opening the whole ledger.</p>
          </div>
          <div className="public-vnext__privacy-example" aria-label="Illustrative private balance sharing example">
            <div className="public-vnext__privacy-owner"><span className="technical-label">Owner ledger</span><strong>Market + picnic</strong><small>Personal record · full context retained</small><Money amount={example.remaining} /><span className="public-vnext__state public-vnext__state--open">Open with Sari</span></div>
            <div className="public-vnext__privacy-link"><span className="technical-label">Temporary balance link</span><strong>Read-only statement</strong><small>One relevant balance · no account access</small><span className="public-vnext__privacy-arrow" aria-hidden="true">→</span></div>
            <div className="public-vnext__privacy-shared"><span className="technical-label">Shared view</span><strong>Sari owes you</strong><Money amount={example.remaining} /><small>Private balance · read only</small></div>
          </div>
        </div>
      </section>

      <footer className="public-vnext__finale" id="entry" aria-labelledby="entry-title">
        <div className="public-vnext__finale-layout editorial-shell">
          <div><Marker number="05" label="Entry / start with the record" /><h2 id="entry-title">Less guesswork.<br />More shared clarity.</h2><p>Record the money, keep responsibility explicit, and let the context stay attached.</p></div>
          <div className="public-vnext__finale-action"><span className="public-vnext__finale-wordmark">Zplit</span><ActionLink href="/app" variant="primary">Open Zplit <span aria-hidden="true">↗</span></ActionLink><small>Invite-only access</small></div>
        </div>
      </footer>
    </main>
  );
}
