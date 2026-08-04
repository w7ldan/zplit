import { ActionLink } from "@/components/editorial/action-link";
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
            <div className="hero__metadata technical-label" aria-label="Page metadata">
              <span>SHARED EXPENSE LEDGER</span>
              <span>IDR</span>
              <span>2026</span>
            </div>
            <p className="hero__kicker">Zplit / shared expense record</p>
            <h1 className="hero__title" id="page-title">Shared expenses without the group-chat accounting.</h1>
            <p className="hero__lede">
              Record an outing, add the expenses, enter what each friend owes, and record repayments until the balance is clear. Zplit keeps the numbers in rupiah and the next action visible.
            </p>
            <div className="hero__actions">
              <ActionLink href="/app" variant="primary">
                Open Zplit
              </ActionLink>
              <ActionLink href="#journey" variant="quiet">
                See how it works
              </ActionLink>
            </div>
          </div>
          <div className="hero__ledger" aria-label="Illustrative ledger summary">
            <div className="hero__ledger-header"><span className="technical-label">Outing</span><strong>Bandung day out</strong></div>
            <div className="hero__ledger-row"><span>Dinner</span><strong className="tabular-nums">Rp 240.000</strong></div>
            <div className="hero__ledger-row"><span>Rani&apos;s shares</span><strong className="tabular-nums">Rp 126.500</strong></div>
            <div className="hero__ledger-total"><span>Still open</span><strong className="tabular-nums">Rp 42.500</strong></div>
            <p>Illustrative values. Shares are entered by the owner; repayments are allocated to them.</p>
          </div>
        </div>
      </section>

      <section className="editorial-section journey-section" id="journey" aria-labelledby="journey-title">
        <div className="section-layout editorial-grid editorial-shell">
          <p className="section-label technical-label">01 / How it works</p>
          <h2 className="section-heading" id="journey-title">From one outing to a balance you can settle.</h2>
          <p className="section-intro">
            Follow one illustrative scenario through the same records Zplit uses in the app. Select a step or use the arrow keys; every amount is an explicit whole-rupiah example.
          </p>
          <ProductJourney />
        </div>
      </section>

      <section className="editorial-section" id="ledger" aria-labelledby="ledger-title">
        <div className="section-layout editorial-grid editorial-shell">
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
        </div>
      </section>

      <section className="editorial-section product-areas-section" aria-labelledby="system-title">
        <div className="section-layout editorial-grid editorial-shell">
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
        </div>
      </section>

      <footer className="site-footer" aria-labelledby="footer-title">
        <div className="footer-layout editorial-grid editorial-shell">
          <p className="section-label technical-label">04 / Close</p>
          <span className="footer__brand" id="footer-title">Zplit</span>
          <p className="footer__description">Shared expenses, explicit friend shares, and settled balances.</p>
          <div className="footer__actions"><ActionLink href="/app" variant="primary">Open Zplit</ActionLink><a className="footer__top" href="#top">Return to top ↑</a></div>
        </div>
      </footer>
    </main>
  );
}
