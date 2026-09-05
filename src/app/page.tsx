import { ActionLink } from "@/components/editorial/action-link";
import { JourneyShowcase } from "@/components/editorial/journey-showcase";
import { LandingReveal, LandingStoryMotion } from "@/components/editorial/landing-reveal";
import { bandungStory } from "@/components/editorial/public-scenario";
import { SiteHeader } from "@/components/editorial/site-header";
import { formatRupiah } from "@/domain/rupiah";

const dinner = bandungStory.expenses[0];
const taxi = bandungStory.expenses[1];
const openBalance = formatRupiah(bandungStory.openBalance.amount);
const raniPayment = formatRupiah(bandungStory.repayment.amount);
const dinnerAmount = formatRupiah(dinner.amount);
const taxiAmount = formatRupiah(taxi.amount);
const assignedAmount = bandungStory.shares.reduce((total, share) => total + share.amount, 0);

function Avatar({ label, tone }: { label: string; tone: "blue" | "peach" | "mint" }) {
  return <span className={`record-avatar record-avatar--${tone}`} aria-hidden="true">{label}</span>;
}

export default function HomePage() {
  return (
    <LandingStoryMotion>
      <SiteHeader />

      <section className="landing-hero" aria-labelledby="page-title">
        <div className="landing-hero__geometry" aria-hidden="true"><span /><span /><span /></div>
        <div className="editorial-shell editorial-grid landing-hero__layout">
          <div className="landing-hero__content">
            <LandingReveal as="div" className="landing-hero__prelude" aria-label="Page metadata">
              <p className="technical-label">Zplit / the shared money record</p>
              <span className="landing-hero__date">Personal · Groups · Organizations</span>
            </LandingReveal>
            <h1 id="page-title" className="landing-hero__title">Keep shared money on the record.</h1>
            <LandingReveal as="p" className="landing-hero__lede" delay={100}>
              Expenses, shares, repayments, proof, and the balance that follows—kept readable from the first amount to the last open share.
            </LandingReveal>
            <LandingReveal as="div" className="landing-hero__actions" delay={160}>
              <ActionLink href="/app" variant="primary">Open Zplit</ActionLink>
              <ActionLink href="#model" variant="quiet">Read the model</ActionLink>
            </LandingReveal>
          </div>

          <LandingReveal as="div" className="hero-record-wrap" aria-label={`Illustrative ${bandungStory.outing} record`} delay={180}>
            <article className="product-record hero-record">
              <header className="product-record__header">
                <div><span className="technical-label">Illustrative / Personal</span><h2>{bandungStory.outing}</h2></div>
                <span className="product-record__date">12 Apr 2026</span>
              </header>
              <div className="hero-record__context"><span>Outing</span><strong>2 expenses · 3 shares</strong><span className="record-status record-status--open">1 open balance</span></div>
              <div className="hero-record__expense">
                <div className="hero-record__expense-label"><span className="technical-label">Expense</span><strong>{dinner.description}</strong><small>Paid by you · {bandungStory.outing}</small></div>
                <strong className="record-amount">{dinnerAmount}</strong>
              </div>
              <div className="hero-record__people" aria-label="Expense shares">
                <div className="record-person">
                  <Avatar label="R" tone="blue" />
                  <span><strong>Rani</strong><small>{formatRupiah(84000)} share</small></span>
                  <span className="record-status record-status--settled">Settled</span>
                </div>
                <div className="record-person">
                  <Avatar label="D" tone="peach" />
                  <span><strong>Dimas</strong><small>{formatRupiah(42500)} share</small></span>
                  <span className="record-status record-status--open">Open</span>
                </div>
              </div>
              <footer className="hero-record__footer"><span>Rani repayment allocated</span><strong>{raniPayment}</strong><span>Remaining</span><strong className="record-amount">{openBalance}</strong></footer>
            </article>
            <p className="hero-record-wrap__caption"><span className="technical-label">01 / A record, not a chat thread</span><span>Names, shares, and state stay attached to the amount.</span></p>
          </LandingReveal>
        </div>
      </section>

      <section className="landing-section landing-model" id="model" aria-labelledby="model-title" data-story-motion="model">
        <div className="editorial-shell">
          <div className="section-intro-row">
            <p className="section-label technical-label">01 / The financial model</p>
            <div><h2 id="model-title">A number is useful when its relationship stays visible.</h2><p>Records hold the source facts. Shares explain who owes what. Repayments are allocated to those shares, and balances come from what remains.</p></div>
          </div>
          <div className="record-chain" aria-label="Expense to balance relationship">
            <article className="record-chain__item"><span className="technical-label">Expense</span><strong>{dinner.description}</strong><span>{bandungStory.outing}</span><b>{dinnerAmount}</b></article>
            <span className="record-chain__arrow" aria-hidden="true">↓</span>
            <article className="record-chain__item"><span className="technical-label">Shares</span><strong>3 Friend shares</strong><span>Assigned explicitly</span><b>{formatRupiah(assignedAmount)}</b></article>
            <span className="record-chain__arrow" aria-hidden="true">↓</span>
            <article className="record-chain__item"><span className="technical-label">Repayment</span><strong>Rani received</strong><span>Allocated to shares</span><b>{raniPayment}</b></article>
            <span className="record-chain__arrow" aria-hidden="true">↓</span>
            <article className="record-chain__item record-chain__item--balance"><span className="technical-label">Balance</span><strong>Dimas remains</strong><span>One open share</span><b>{openBalance}</b></article>
          </div>
          <p className="section-footnote"><span>Traceable by design</span> The balance is not a guess; it is the part of the record still open.</p>
        </div>
      </section>

      <section className="landing-section scope-section" id="scopes" aria-labelledby="scope-title" data-story-motion="scopes">
        <div className="editorial-shell scope-section__layout">
          <div className="scope-section__intro"><p className="section-label technical-label">02 / Three contexts</p><h2 id="scope-title">One product. Different places for the money to live.</h2><p>Personal, Groups, and Organizations share a clear record language without collapsing their accounting models into one.</p></div>
          <div className="scope-sheet" aria-label="Zplit financial contexts">
            <article className="scope-row scope-row--personal"><div className="scope-row__marker"><span>01</span><strong>Personal</strong></div><div className="scope-row__details"><span>Friends · Outings · Expenses · Repayments</span><p>Private, owner-centric ledger. You front money; Friends owe you.</p></div><span className="scope-row__aside">Private balance sharing</span></article>
            <article className="scope-row scope-row--groups">
              <div className="scope-row__marker"><span>02</span><strong>Groups</strong></div>
              <div className="scope-row__details"><span>Participants · Group expenses · Settlements · Chat</span><p>Peer-to-peer records where the payer, shares, and settlement context stay with the Group.</p></div>
              <span className="scope-row__aside">Conversation beside the ledger</span>
            </article>
            <article className="scope-row scope-row--organizations">
              <div className="scope-row__marker"><span>03</span><strong>Organizations</strong></div>
              <div className="scope-row__details"><span>Members · Roles &amp; access · Ledger · History</span><p>Entity-centric records operated by members with the access their role allows.</p></div>
              <span className="scope-row__aside">A durable organizational history</span>
            </article>
          </div>
        </div>
      </section>

      <JourneyShowcase />

      <section className="landing-section collaboration-section" id="collaboration" aria-labelledby="collaboration-title" data-story-motion="collaboration">
        <div className="editorial-shell collaboration-section__layout">
          <div className="collaboration-section__copy"><p className="section-label technical-label">04 / Collaboration</p><h2 id="collaboration-title">Talk beside the record. Keep the record authoritative.</h2><p>Group Chat gives participants a place to coordinate. Expenses and settlements remain their own explicit records, so conversation does not become accounting.</p></div>
          <div className="collaboration-spread" aria-label="Illustrative Group ledger and chat">
            <article className="group-ledger">
              <header><span className="technical-label">Group / Bandung crew</span><strong>Ledger</strong></header>
              <div className="group-ledger__row"><span><strong>Dinner</strong><small>Paid by Rani · 3 participants</small></span><b>{dinnerAmount}</b></div>
              <div className="group-ledger__row"><span><strong>Settlement</strong><small>Rani → Dimas</small></span><b>{openBalance}</b></div>
              <footer><span>2 records shown</span><span className="record-status record-status--open">Open balance</span></footer>
            </article>
            <article className="group-chat">
              <header><span className="technical-label">Group Chat</span><strong>General</strong></header>
              <div className="chat-message chat-message--other"><Avatar label="R" tone="blue" /><p><strong>Rani</strong><span>Did we settle dinner?</span></p></div>
              <div className="chat-message chat-message--own"><p><strong>You</strong><span>Repayment recorded — check the settlement record.</span></p><Avatar label="Y" tone="mint" /></div>
              <footer><span>Conversation is context.</span><span>Accounting stays explicit.</span></footer>
            </article>
          </div>
        </div>
      </section>

      <section className="landing-section proof-section" id="proof" aria-labelledby="proof-title" data-story-motion="proof">
        <div className="editorial-shell proof-section__layout">
          <div className="expense-detail" aria-label="Illustrative expense detail">
            <header><span className="technical-label">Expense / {bandungStory.outing}</span><span className="record-status record-status--settled">Recorded</span></header>
            <div className="expense-detail__headline"><h3>{dinner.description}</h3><strong>{dinnerAmount}</strong></div>
            <dl className="expense-detail__facts"><div><dt>Payer</dt><dd>You</dd></div><div><dt>Date</dt><dd>12 Apr 2026</dd></div><div><dt>Shares</dt><dd>Rani · Dimas</dd></div></dl>
            <div className="expense-detail__receipt"><span className="receipt-mark" aria-hidden="true">RECEIPT<br />ATTACHED</span><span><strong>receipt.jpg</strong><small>Supporting proof for this expense</small></span></div>
          </div>
          <div className="proof-section__copy"><p className="section-label technical-label">05 / Record + proof</p><h2 id="proof-title">The explanation stays with the number.</h2><p>An expense can carry its outing, payer, date, shares, and attached receipt together. The amount remains readable when the question comes later.</p></div>
        </div>
      </section>

      <section className="landing-section private-section" id="private-share" aria-labelledby="private-title" data-story-motion="private-share">
        <div className="editorial-shell private-section__layout">
          <div className="private-section__copy"><p className="section-label technical-label">06 / Private sharing</p><h2 id="private-title">Share a balance without opening the ledger.</h2><p>The owner can create a private, read-only balance link for a Friend. The shared view shows assigned shares and repayments; the owner’s record remains the source.</p></div>
          <div className="private-spread" aria-label="Illustrative private balance share">
            <div className="private-spread__owner"><span className="technical-label">Owner ledger</span><strong>Bandung day out</strong><span>Private record · {bandungStory.openBalance.friend} share</span><b>{openBalance}</b></div>
            <div className="private-spread__arrow" aria-hidden="true">→</div>
            <article className="private-statement">
              <header><span>Zplit / Balance statement</span><span>Private · Read only</span></header>
              <p>{bandungStory.openBalance.friend}</p>
              <strong>{openBalance}</strong>
              <div><span>{dinner.description}<small>{bandungStory.outing}</small></span><b>{openBalance}</b></div>
              <footer>Shared view · no ledger editing</footer>
            </article>
          </div>
        </div>
      </section>

      <section className="landing-section history-section" id="records" aria-labelledby="history-title" data-story-motion="history">
        <div className="editorial-shell history-section__layout">
          <div className="history-section__copy"><p className="section-label technical-label">07 / History + findability</p><h2 id="history-title">Every record stays findable.</h2><p>Search for the expense you remember. Use Inbox for attention. Return to history when the outing is no longer recent.</p></div>
          <div className="history-spread" aria-label="Illustrative search, inbox, and history">
            <div className="history-search">
              <label htmlFor="public-search">Search records</label>
              <div><span aria-hidden="true">Search /</span><input id="public-search" value="Dinner" readOnly /></div>
              <article><span><strong>{dinner.description}</strong><small>{bandungStory.outing} · 12 Apr 2026</small></span><b>{dinnerAmount}</b></article>
              <article><span><strong>{taxi.description}</strong><small>{bandungStory.outing} · 12 Apr 2026</small></span><b>{taxiAmount}</b></article>
            </div>
            <div className="history-side">
              <div className="inbox-slip"><span className="technical-label">Inbox</span><strong>Rani repayment recorded</strong><small>Attention stays close to the record.</small></div>
              <div className="history-slip"><span className="technical-label">History</span><strong>Expense → repayment → balance</strong><small>Past records remain a readable chain.</small></div>
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-finale" aria-labelledby="footer-title">
        <div className="editorial-shell">
          <div className="landing-finale__marker"><span className="technical-label">Settlement payoff</span><span>Illustrative Bandung day out</span></div>
          <div className="settlement-readout">
            <p>When a share is fully covered, the balance can say so.</p>
            <div className="settlement-readout__rows">
              <div><span>Rani</span><strong>Rp 0</strong><span className="record-status record-status--settled">Settled</span></div>
              <div><span>Dimas</span><strong>{openBalance}</strong><span className="record-status record-status--open">Open</span></div>
            </div>
          </div>
          <div className="landing-finale__cta"><div><span className="footer__brand" id="footer-title">Zplit</span><p>Shared expenses, made explicit.</p></div><ActionLink href="/app" variant="primary">Open Zplit →</ActionLink></div>
        </div>
      </footer>
    </LandingStoryMotion>
  );
}
