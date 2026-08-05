import { ActionLink } from "@/components/editorial/action-link";
import { LandingReveal } from "@/components/editorial/landing-reveal";
import { ProductJourney } from "@/components/editorial/product-journey";
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
            <LandingReveal as="div" className="hero__metadata technical-label" aria-label="Page metadata" delay={0}>
              <span>SHARED EXPENSE LEDGER</span>
              <span>IDR</span>
              <span>2026</span>
            </LandingReveal>
            <LandingReveal as="p" className="hero__kicker" delay={60}>Zplit / shared expense record</LandingReveal>
            <h1 className="hero__title" id="page-title">Shared expenses without the group-chat accounting.</h1>
            <LandingReveal as="p" className="hero__lede" delay={120}>
              Record an outing, add the expenses, enter what each friend owes, and record repayments until the balance is clear. Zplit keeps the numbers in rupiah and the next action visible.
            </LandingReveal>
            <LandingReveal as="div" className="hero__actions" delay={180}>
              <ActionLink href="/app" variant="primary">
                Open Zplit
              </ActionLink>
              <ActionLink href="#journey" variant="quiet">
                See how it works
              </ActionLink>
            </LandingReveal>
          </div>
          <LandingReveal as="div" className="hero__ledger" aria-label="Illustrative ledger summary" delay={120}>
            <div className="hero__ledger-header"><span className="technical-label">Outing</span><strong>Bandung day out</strong></div>
            <div className="hero__ledger-row"><span>Dinner</span><strong className="tabular-nums">Rp 240.000</strong></div>
            <div className="hero__ledger-row"><span>Rani&apos;s shares</span><strong className="tabular-nums">Rp 126.500</strong></div>
            <div className="hero__ledger-total"><span>Still open</span><strong className="tabular-nums">Rp 42.500</strong></div>
            <p>Illustrative values. Shares are entered by the owner; repayments are allocated to them.</p>
          </LandingReveal>
        </div>
      </section>

      <section className="editorial-section journey-section" id="journey" aria-labelledby="journey-title">
        <div className="section-layout editorial-grid editorial-shell">
          <LandingReveal as="p" className="section-label technical-label">01 / How it works</LandingReveal>
          <LandingReveal as="h2" className="section-heading" id="journey-title" delay={60}>From one outing to a balance you can settle.</LandingReveal>
          <LandingReveal as="p" className="section-intro" delay={120}>
            Follow one illustrative scenario through the same records Zplit uses in the app. Select a step or use the arrow keys; every amount is an explicit whole-rupiah example.
          </LandingReveal>
          <ProductJourney />
        </div>
      </section>

      <section className="editorial-section" id="ledger" aria-labelledby="ledger-title">
        <div className="section-layout editorial-grid editorial-shell">
          <LandingReveal as="p" className="section-label technical-label">02 / The ledger</LandingReveal>
          <LandingReveal as="h2" className="section-heading" id="ledger-title" delay={60}>A clear record, not another group chat.</LandingReveal>
          <LandingReveal as="p" className="section-intro" delay={120}>
            Three small habits make the balance trustworthy: record the event, assign the shares, and keep repayments attached to what they settle.
          </LandingReveal>
          <ol className="principles">
            {principles.map((principle, index) => (
              <LandingReveal as="li" className="principle" key={principle.number} delay={index * 60}>
                <span className="principle__number">{principle.number} /</span>
                <h3>{principle.title}</h3>
                <p>{principle.description}</p>
              </LandingReveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="editorial-section product-areas-section" aria-labelledby="system-title">
        <div className="section-layout editorial-grid editorial-shell">
          <LandingReveal as="p" className="section-label technical-label">03 / Product areas</LandingReveal>
          <LandingReveal as="h2" className="section-heading" id="system-title" delay={60}>The working parts stay connected.</LandingReveal>
          <LandingReveal as="p" className="section-intro" delay={120}>
            Friends, outings, expenses, and repayments are the records behind a useful open balance.
          </LandingReveal>
          <ul className="system-areas">
            {productAreas.map(([title, description], index) => (
              <LandingReveal as="li" key={title} delay={index * 60}>
                <span className="system-areas__title">{title}</span>
                <span className="system-areas__description">{description}</span>
              </LandingReveal>
            ))}
          </ul>
          <LandingReveal as="p" className="system-note" delay={180}>Open Zplit to work with your own records. The public journey is illustrative; it never writes to your ledger.</LandingReveal>
        </div>
      </section>

      <footer className="site-footer" aria-labelledby="footer-title">
        <div className="footer-layout editorial-grid editorial-shell">
          <LandingReveal as="p" className="section-label technical-label">04 / Close</LandingReveal>
          <LandingReveal as="span" className="footer__brand" id="footer-title" delay={60}>Zplit</LandingReveal>
          <LandingReveal as="p" className="footer__description" delay={120}>Shared expenses, explicit friend shares, and settled balances.</LandingReveal>
          <LandingReveal as="div" className="footer__actions" delay={180}><ActionLink href="/app" variant="primary">Open Zplit</ActionLink><a className="footer__top" href="#top">Return to top ↑</a></LandingReveal>
        </div>
      </footer>
    </main>
  );
}
