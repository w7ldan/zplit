import { ActionLink } from "@/components/editorial/action-link";
import { formatRupiah } from "@/domain/rupiah";

const market = {
  paid: 360_000,
  repaid: 120_000,
  remaining: 90_000,
  shares: [
    { name: "Raka", amount: 120_000, status: "Settled" },
    { name: "Sari", amount: 90_000, status: "Still owes you" },
    { name: "You", amount: 150_000, status: "Your share" },
  ],
} as const;

function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={["public-vnext__money", "tabular-nums", className].join(" ").trim()}>{formatRupiah(amount)}</span>;
}

function Marker({ number, label }: { number: string; label: string }) {
  return <p className="public-vnext__marker"><span>{number}</span><span>{label}</span></p>;
}

function MarketShares({ showStatus = true }: { showStatus?: boolean }) {
  return <div className="public-vnext__shares">{market.shares.map((share) => (
    <div className="public-vnext__share" key={share.name}>
      <span className="public-vnext__share-name">{share.name}</span>
      <Money amount={share.amount} />
      {showStatus && <span className={share.name === "Sari" ? "public-vnext__share-status public-vnext__share-status--open" : "public-vnext__share-status"}>{share.status}</span>}
    </div>
  ))}</div>;
}

function HeroRecord() {
  return <article className="public-vnext__hero-record" aria-label="Illustrative personal expense record">
    <header className="public-vnext__record-header">
      <div><span className="technical-label">Personal / Expense</span><h2>Saturday market</h2></div>
      <span className="public-vnext__record-date">16 May 2026</span>
    </header>
    <div className="public-vnext__record-body">
      <div className="public-vnext__record-total">
        <span className="technical-label">Paid by you</span>
        <Money amount={market.paid} />
        <span className="public-vnext__record-index">01 expense / 03 shares</span>
      </div>
      <div className="public-vnext__record-people"><span className="technical-label">Shares and repayments</span><MarketShares /></div>
    </div>
    <footer className="public-vnext__record-footer"><span>After Raka repaid {formatRupiah(market.repaid)}</span><strong><Money amount={market.remaining} /> remains</strong></footer>
  </article>;
}

function Workflow() {
  return <div className="public-vnext__workflow" aria-label="Saturday market record, from payment to repayment">
    <article className="public-vnext__step">
      <div className="public-vnext__step-heading"><span>01 / Record</span><h3>Start with the payment.</h3></div>
      <div className="public-vnext__step-detail"><span>Saturday market · Paid by you</span><Money amount={market.paid} /></div>
    </article>
    <article className="public-vnext__step">
      <div className="public-vnext__step-heading"><span>02 / Assign</span><h3>Give every share a name.</h3></div>
      <div className="public-vnext__step-detail"><MarketShares showStatus={false} /></div>
    </article>
    <article className="public-vnext__step">
      <div className="public-vnext__step-heading"><span>03 / Repay</span><h3>See what remains.</h3></div>
      <div className="public-vnext__step-detail public-vnext__step-detail--repay"><div><span>Raka repaid {formatRupiah(market.repaid)}</span><strong>Settled</strong></div><div><span>Sari still owes you</span><Money amount={market.remaining} /></div><div><span>When Sari repays</span><strong>All shares settled</strong></div></div>
    </article>
  </div>;
}

function Contexts() {
  return <div className="public-vnext__contexts">
    <article className="public-vnext__context public-vnext__context--personal" id="personal">
      <span className="technical-label">01 / Personal</span><h3>Between you and them.</h3><p>Keep individual balances close.</p>
      <div className="public-vnext__context-ledger"><div><span>Kayla <small>Owes you</small></span><strong>Rp 115.000</strong></div><div><span>Arip <small>Settled</small></span><strong>Rp 109.662</strong></div></div>
    </article>
    <article className="public-vnext__context public-vnext__context--groups" id="groups">
      <span className="technical-label">02 / Groups</span><h3>Everyone on the same trip.</h3><p>Shared expenses, separate balances.</p>
      <div className="public-vnext__context-ledger"><div><span>Japan trip <small>6 participants</small></span></div><div><span>You are owed</span><strong>¥66,000</strong></div><div><span>You owe</span><strong>¥14,400</strong></div></div>
    </article>
    <article className="public-vnext__context public-vnext__context--organizations" id="organizations">
      <span className="technical-label">03 / Organizations</span><h3>A ledger for the team.</h3><p>Records and access within the organization.</p>
      <div className="public-vnext__context-ledger"><div><span>Design committee</span><strong>12 records</strong></div><div><span>Awaiting confirmation</span><strong>3</strong></div></div>
    </article>
  </div>;
}

function PrivacyComparison() {
  return <div className="public-vnext__comparison" aria-label="Illustrative owner view and Sari balance link">
    <article className="public-vnext__view public-vnext__view--owner">
      <span className="technical-label">Your private view</span><h3>Saturday market</h3>
      <div className="public-vnext__view-total"><span>Expense · paid by you</span><Money amount={market.paid} /></div>
      <MarketShares />
      <div className="public-vnext__view-extra"><span>Receipt and allocation history</span><span>Other Personal records</span><span>Repayment history</span></div>
    </article>
    <div className="public-vnext__comparison-divider" aria-hidden="true"><span>Share Sari’s balance →</span></div>
    <article className="public-vnext__view public-vnext__view--shared">
      <span className="technical-label">Sari’s public balance link</span><h3>Saturday market</h3>
      <div className="public-vnext__statement"><div><span>Your share</span><Money amount={market.remaining} /></div><div><span>Paid</span><Money amount={0} /></div><div className="public-vnext__statement-remaining"><span>Remaining</span><Money amount={market.remaining} /></div></div>
      <p>No sign-in needed. Only Sari’s balance is shown here. Receipts and repayment destinations appear only when shared.</p>
    </article>
  </div>;
}

export function PublicLanding() {
  return <main>
    <section className="public-vnext__hero" aria-labelledby="public-title">
      <div className="editorial-shell">
        <Marker number="00" label="Shared money, made clear" />
        <div className="public-vnext__hero-intro"><h1 id="public-title">Record shared money.<br /><span>See what remains.</span></h1><div><p>You paid for everyone. Zplit keeps each share and repayment attached to the expense.</p><ActionLink href="/app" variant="primary">Open Zplit <span aria-hidden="true">↗</span></ActionLink></div></div>
        <HeroRecord />
      </div>
    </section>
    <section className="public-vnext__section public-vnext__section--workflow" id="record" aria-labelledby="record-title">
      <div className="editorial-shell"><Marker number="01" label="How it works" /><h2 id="record-title">One payment.<br />The whole story.</h2><Workflow /></div>
    </section>
    <section className="public-vnext__section public-vnext__section--contexts" id="contexts" aria-labelledby="contexts-title">
      <div className="editorial-shell"><Marker number="02" label="Where Zplit fits" /><h2 id="contexts-title">Money moves differently<br />with different people.</h2><Contexts /></div>
    </section>
    <section className="public-vnext__section public-vnext__section--private" id="private" aria-labelledby="private-title">
      <div className="editorial-shell"><Marker number="03" label="Share only what they need" /><div className="public-vnext__private-intro"><h2 id="private-title">Your record.<br />Their balance.</h2><p>A read-only bearer link lets Sari see her balance without opening your Personal ledger.</p></div><PrivacyComparison /></div>
    </section>
    <footer className="public-vnext__finale" id="entry" aria-labelledby="entry-title"><div className="editorial-shell"><Marker number="04" label="Start with a record" /><div><h2 id="entry-title">Keep the record.<br />Skip the guesswork.</h2><ActionLink href="/app" variant="primary">Open Zplit <span aria-hidden="true">↗</span></ActionLink></div></div></footer>
  </main>;
}
