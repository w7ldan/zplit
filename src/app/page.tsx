import { ActionLink } from "@/components/editorial/action-link";
import { JourneyShowcase } from "@/components/editorial/journey-showcase";
import { LandingReveal, LandingStoryMotion } from "@/components/editorial/landing-reveal";
import { bandungStory } from "@/components/editorial/public-scenario";
import { SiteHeader } from "@/components/editorial/site-header";
import { formatRupiah } from "@/domain/rupiah";

const dinner = bandungStory.expenses[0];
const dinnerAmount = formatRupiah(dinner.amount);
const openBalance = formatRupiah(bandungStory.openBalance.amount);
const raniPayment = formatRupiah(bandungStory.repayment.amount);

export default function HomePage() {
  return (
    <LandingStoryMotion>
      <SiteHeader />

      <section className="hero editorial-section" aria-labelledby="page-title">
        <div className="hero__field" data-reveal="field" aria-hidden="true" />
        <div className="hero__layout editorial-grid editorial-shell">
          <div className="hero__content">
            <LandingReveal as="div" className="hero__prelude" delay={0} aria-label="Page metadata">
              <p className="hero__kicker">Zplit / shared expense record</p>
            </LandingReveal>
            <h1 className="hero__title" id="page-title" data-reveal="hero">Shared expenses without the group-chat accounting.</h1>
            <LandingReveal as="p" className="hero__lede" delay={100}>
              One outing. Every expense, share, payment, and remaining balance kept in the same explicit record.
            </LandingReveal>
            <LandingReveal as="div" className="hero__actions" delay={160}>
              <ActionLink href="/app" variant="primary">Open Zplit</ActionLink>
              <ActionLink href="#journey" variant="quiet">See how it works</ActionLink>
            </LandingReveal>
          </div>

          <LandingReveal as="div" className="hero__ledger" aria-label={`Illustrative ${bandungStory.outing} ledger`} delay={180}>
            <div className="hero__ledger-header hero-story__rule"><span className="technical-label">Shared expense record</span><strong>{bandungStory.outing}</strong></div>
            <div className="hero__ledger-row hero-story__dinner"><span>{dinner.description}</span><strong>{dinnerAmount}</strong></div>
            <div className="hero__ledger-row hero-story__share"><span>Rani assigned</span><strong>{raniPayment}</strong></div>
            <div className="hero__ledger-total hero-story__open"><span>Still open</span><strong>{openBalance}</strong></div>
          </LandingReveal>
        </div>
      </section>

      <div className="ledger-handoff-runway" data-ledger-handoff-runway aria-hidden="true">
        <div className="ledger-handoff editorial-shell" data-ledger-handoff>
          <div className="ledger-handoff__header"><span className="technical-label">Shared expense record</span><strong>{bandungStory.outing}</strong></div>
          <div className="ledger-handoff__row"><span>{dinner.description}</span><strong>{dinnerAmount}</strong></div>
          <div className="ledger-handoff__row"><span>Rani assigned</span><strong>{raniPayment}</strong></div>
          <div className="ledger-handoff__open"><span>Still open</span><strong>{openBalance}</strong></div>
        </div>
      </div>

      <JourneyShowcase />

      <section className="editorial-section capability capability--search" id="ledger" aria-labelledby="search-title" data-story-motion="search">
        <div className="capability__layout editorial-grid editorial-shell">
          <div className="capability__copy">
            <p className="section-label technical-label">Find the record</p>
            <h2 id="search-title">2,000 records.<br />Still one search away.</h2>
          </div>
          <div className="search-ledger" role="search" aria-label="Illustrative expense search">
            <label htmlFor="public-search">Search expenses</label>
            <div className="search-ledger__query"><span aria-hidden="true">Search /</span><input id="public-search" value="Dinner" readOnly /></div>
            <p className="technical-label">1 matching expense</p>
            <div className="search-ledger__result">
              <span><strong>{dinner.description}</strong><small>{bandungStory.outing}</small></span>
              <strong>{dinnerAmount}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="editorial-section capability capability--receipt" aria-labelledby="receipt-title" data-story-motion="receipt">
        <div className="capability__layout editorial-grid editorial-shell">
          <div className="expense-proof">
            <p className="technical-label">Expense / {bandungStory.outing}</p>
            <div className="expense-proof__amount"><span>{dinner.description}</span><strong>{dinnerAmount}</strong></div>
            <figure className="expense-proof__receipt">
              <div aria-hidden="true"><span>RECEIPT</span><span>{dinner.description.toUpperCase()}</span><span>{dinnerAmount.slice(3)}</span></div>
              <figcaption><strong>receipt.jpg</strong><span>Attached to this expense</span></figcaption>
            </figure>
          </div>
          <div className="capability__copy">
            <p className="section-label technical-label">Keep the proof</p>
            <h2 id="receipt-title">The receipt stays with the expense.</h2>
            <p>Dinner has one amount, one outing, and its supporting document in the same record.</p>
          </div>
        </div>
      </section>

      <section className="editorial-section capability capability--private" aria-labelledby="private-title" data-story-motion="private-share">
        <div className="capability__layout editorial-grid editorial-shell">
          <div className="capability__copy">
            <p className="section-label technical-label">Private share</p>
            <h2 id="private-title">Send the balance,<br />not the spreadsheet.</h2>
          </div>
          <article className="private-ledger" aria-label={`Private read-only balance for ${bandungStory.openBalance.friend}`}>
            <div className="private-ledger__source" aria-hidden="true"><span>{bandungStory.openBalance.friend}</span><strong>{openBalance}</strong></div>
            <div className="private-ledger__statement">
              <header><span>{bandungStory.openBalance.friend}</span><span>Private · Read only</span></header>
              <p>Still owes</p>
              <strong className="private-ledger__amount">{openBalance}</strong>
              <div className="private-ledger__row"><span>{dinner.description}<small>{bandungStory.outing}</small></span><strong>{openBalance}</strong></div>
              <p className="private-ledger__proof">Receipt available</p>
            </div>
          </article>
        </div>
      </section>

      <footer className="story-close" aria-labelledby="footer-title" data-story-motion="finale">
        <div className="editorial-shell">
          <p className="section-label technical-label">Settlement payoff</p>
          <div className="payoff">
            <span>Still open</span>
            <strong data-payoff-state="amount">{openBalance}</strong>
            <div className="payoff__row" data-payoff-state="row"><span>{bandungStory.openBalance.friend}</span><strong>{openBalance}</strong></div>
          </div>
          <div className="story-close__cta" data-payoff-state="cta">
            <div><span className="footer__brand" id="footer-title">Zplit</span><p>Shared expenses, made explicit.</p></div>
            <ActionLink href="/app" variant="primary">Open Zplit →</ActionLink>
          </div>
        </div>
      </footer>
    </LandingStoryMotion>
  );
}
