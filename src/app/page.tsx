import { ActionLink } from "@/components/editorial/action-link";
import { LandingReveal } from "@/components/editorial/landing-reveal";
import { JourneyShowcase } from "@/components/editorial/journey-showcase";
import { SiteHeader } from "@/components/editorial/site-header";

const principles = [
  {
    number: "01",
    title: "Record the expense",
    description: "Name the moment, the amount, and the people involved while the detail is still clear.",
  },
  {
    number: "02",
    title: "Assign every share",
    description: "Give each person an explicit share so an open balance has an owner and a reason.",
  },
  {
    number: "03",
    title: "Close the balance",
    description: "Keep repayment visible until the record is settled, then leave a clean trace behind.",
  },
];

const productAreas = [
  ["Friends", "Keep the people who recur in your shared spending in one place."],
  ["Outings", "Group expenses by the occasion that gave them context."],
  ["Expenses", "Record each amount and choose the outing it belongs to."],
  ["Repayments", "Record money received and allocate it to eligible shares."],
];

export default function HomePage() {
  return (
    <main className="public-home" id="top">
      <SiteHeader />

      <section className="hero editorial-section" aria-labelledby="page-title">
        <div className="hero__field" data-reveal="field" aria-hidden="true" />
        <div className="hero__layout editorial-grid editorial-shell">
          <div className="hero__content">
            <LandingReveal as="div" className="hero__prelude" delay={0} aria-label="Page metadata">
              <div className="hero__metadata technical-label"><span>SHARED EXPENSE LEDGER</span><span>IDR</span><span>2026</span></div>
              <p className="hero__kicker">Zplit / shared expense record</p>
            </LandingReveal>
            <h1 className="hero__title" id="page-title" data-reveal="hero">Shared expenses without the group-chat accounting.</h1>
            <LandingReveal as="p" className="hero__lede" delay={100}>
              Record an outing, add the expenses, enter what each friend owes, and record repayments until the balance is clear. Zplit keeps the numbers in rupiah and the next action visible.
            </LandingReveal>
            <LandingReveal as="div" className="hero__actions" delay={160}>
              <ActionLink href="/app" variant="primary">
                Open Zplit
              </ActionLink>
              <ActionLink href="#journey" variant="quiet">
                See how it works
              </ActionLink>
            </LandingReveal>
          </div>
          <LandingReveal as="div" className="hero__ledger" aria-label="Illustrative ledger summary" delay={180}>
            <div className="hero__ledger-header"><span className="technical-label">Outing</span><strong>Bandung day out</strong></div>
            <div className="hero__ledger-row"><span>Dinner</span><strong className="tabular-nums">Rp 240.000</strong></div>
            <div className="hero__ledger-row"><span>Rani&apos;s shares</span><strong className="tabular-nums">Rp 126.500</strong></div>
            <div className="hero__ledger-total"><span>Still open</span><strong className="tabular-nums">Rp 42.500</strong></div>
            <p>Illustrative values. Shares are entered by the owner; repayments are allocated to them.</p>
          </LandingReveal>
        </div>
      </section>

      <JourneyShowcase />

      <section className="editorial-section" id="ledger" aria-labelledby="ledger-title">
        <LandingReveal as="div" className="section-layout editorial-grid editorial-shell" aria-label="The ledger">
          <p className="section-label technical-label">02 / The ledger</p>
          <h2 className="section-heading" id="ledger-title">A clear record, not another group chat.</h2>
          <p className="section-intro">
            Three small habits make the balance trustworthy: record the event, assign the shares, and keep repayments attached to what they settle.
          </p>
          <ol className="principles">
            {principles.map((principle) => (
              <li className="principle" key={principle.number}>
                <span className="principle__number">{principle.number} /</span>
                <h3>{principle.title}</h3>
                <p>{principle.description}</p>
              </li>
            ))}
          </ol>
        </LandingReveal>
      </section>

      <section className="editorial-section product-areas-section" aria-labelledby="system-title">
        <LandingReveal as="div" className="section-layout editorial-grid editorial-shell" aria-label="Product areas">
          <p className="section-label technical-label">03 / Product areas</p>
          <h2 className="section-heading" id="system-title">The working parts stay connected.</h2>
          <p className="section-intro">
            Friends, outings, expenses, and repayments are the records behind a useful open balance.
          </p>
          <ul className="system-areas">
            {productAreas.map(([title, description]) => (
              <li key={title}>
                <span className="system-areas__title">{title}</span>
                <span className="system-areas__description">{description}</span>
              </li>
            ))}
          </ul>
          <p className="system-note">Open Zplit to work with your own records. The public journey is illustrative; it never writes to your ledger.</p>
        </LandingReveal>
      </section>

      <footer className="site-footer" aria-labelledby="footer-title">
        <LandingReveal as="div" className="footer-layout editorial-grid editorial-shell" aria-label="Close">
          <p className="section-label technical-label">04 / Close</p>
          <span className="footer__brand" id="footer-title">Zplit</span>
          <p className="footer__description">Shared expenses, explicit friend shares, and settled balances.</p>
          <div className="footer__actions"><ActionLink href="/app" variant="primary">Open Zplit</ActionLink><a className="footer__top" href="#top">Return to top ↑</a></div>
        </LandingReveal>
      </footer>
    </main>
  );
}
