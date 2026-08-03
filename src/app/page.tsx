import { ActionLink } from "@/components/editorial/action-link";
import { ChapterLabel } from "@/components/editorial/chapter-label";
import { LedgerStudy } from "@/components/editorial/ledger-study";
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
  ["Friends", "The people who recur in your shared spending."],
  ["Outings", "The occasions that gather several expenses into one context."],
  ["Expenses", "The individual records that make an amount accountable."],
  ["Repayments", "The closing movement from an open balance to settled."],
];

export default function HomePage() {
  return (
    <main id="top">
      <SiteHeader />

      <section className="hero editorial-section" aria-labelledby="page-title">
        <div className="hero__field" data-reveal="field" aria-hidden="true" />
        <div className="hero__layout editorial-grid editorial-shell">
          <div className="hero__content">
            <ChapterLabel chapter={0} label="Cover" metadata="Personal expense record" />
            <div className="hero__metadata technical-label" aria-label="Page metadata">
              <span>PERSONAL LEDGER</span>
              <span>IDR</span>
              <span>2026</span>
            </div>
            <h1 className="hero__title" id="page-title" data-reveal="hero">
              Keep track of what friends owe you.
            </h1>
            <p className="hero__lede">
              Shared expenses, repayments, and open balances—kept in one disciplined record.
            </p>
            <div className="hero__actions">
              <ActionLink href="#method" variant="primary">
                Read the method
              </ActionLink>
              <ActionLink href="#ledger" variant="quiet">
                View the ledger study
              </ActionLink>
            </div>
          </div>
        </div>
      </section>

      <section className="editorial-section" id="method" aria-labelledby="method-title">
        <div className="section-layout editorial-grid editorial-shell">
          <ChapterLabel chapter={1} label="Method" metadata="Three principles" />
          <h2 className="section-heading" id="method-title">
            A clear record, not another group chat.
          </h2>
          <p className="section-intro">
            Zplit treats shared spending as a small ledger: specific enough to trust, quiet enough to use every day.
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

      <section className="editorial-section" id="ledger" aria-labelledby="ledger-title">
        <div className="section-layout editorial-grid editorial-shell">
          <ChapterLabel chapter={2} label="Ledger" metadata="Explicit record" />
          <h2 className="section-heading" id="ledger-title">
            Every amount has a place.
          </h2>
          <p className="section-intro">
            Message history is a poor ledger. Explicit rows keep amounts, people, and repayment states in the same view.
          </p>
          <LedgerStudy />
        </div>
      </section>

      <section className="editorial-section" id="system" aria-labelledby="system-title">
        <div className="section-layout editorial-grid editorial-shell">
          <ChapterLabel chapter={3} label="System" metadata="Future product layer" />
          <h2 className="section-heading" id="system-title">
            Built for one owner.
          </h2>
          <p className="section-intro">
            The future application keeps one person’s records coherent across four connected areas.
          </p>
          <ul className="system-areas">
            {productAreas.map(([title, description]) => (
              <li key={title}>
                <span className="system-areas__title">{title}</span>
                <span className="system-areas__description">{description}</span>
              </li>
            ))}
          </ul>
          <p className="system-note">
            Authentication and application access are the next product layer. This public page is the governing visual system, not an interactive account surface.
          </p>
        </div>
      </section>

      <footer className="site-footer" aria-labelledby="footer-title">
        <div className="footer-layout editorial-grid editorial-shell">
          <ChapterLabel chapter={4} label="Close" metadata="Zplit / 2026" />
          <span className="footer__brand" id="footer-title">Zplit</span>
          <p className="footer__description">Personal expense and repayment record</p>
          <p className="footer__meta">2026 · idr.wildan.lol</p>
          <a className="footer__top" href="#top">
            Return to top ↑
          </a>
        </div>
      </footer>
    </main>
  );
}
