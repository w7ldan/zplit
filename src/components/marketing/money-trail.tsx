import { formatRupiah } from "@/domain/rupiah";
import {
  LandingHeader,
  Story,
  PersonalRecords,
  Spaces,
  Budget,
} from "./money-trail-interactions";

function Amount({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return (
    <span className={`trail-amount ${className}`.trim()}>
      {formatRupiah(value)}
    </span>
  );
}

function Chapter({ number, name }: { number: string; name: string }) {
  return (
    <p className="trail-chapter">
      <span>{number}</span>
      <span>{name}</span>
    </p>
  );
}

function HeroLedger() {
  return (
    <figure
      className="trail-hero-ledger"
      aria-label="Illustrative Bandung day out expense statement"
    >
      <figcaption className="trail-ledger-top">
        <span>EXPENSE / 001</span>
        <span>Illustrative example</span>
      </figcaption>
      <div className="trail-hero-ledger-main">
        <p>PERSONAL / BANDUNG DAY OUT</p>
        <h2>
          One day.
          <br />
          Three shares.
        </h2>
        <Amount value={480_000} className="trail-hero-ledger-total" />
      </div>
      <div className="trail-ledger-payer">
        <span className="trail-node" aria-hidden="true" />
        <span>Paid by Wildan</span>
        <time dateTime="2026-05-16T14:30:00">16 May 2026 · 14:30</time>
      </div>
      <div className="trail-hero-ledger-shares">
        <svg viewBox="0 0 52 178" preserveAspectRatio="none" aria-hidden="true">
          <path pathLength="1" d="M4 2 V145 Q4 166 24 166 H50" />
        </svg>
        <div>
          <p>EXPLICIT SHARES</p>
          <div>
            <span>
              Wildan <small>Own cost</small>
            </span>
            <Amount value={160_000} />
          </div>
          <div>
            <span>Alya</span>
            <Amount value={160_000} />
          </div>
          <div>
            <span>Bima</span>
            <Amount value={160_000} />
          </div>
        </div>
      </div>
      <div className="trail-hero-ledger-end">
        <span>After Alya’s Rp100.000 repayment</span>
        <strong>
          <span>Still owed</span>
          <Amount value={220_000} />
        </strong>
      </div>
    </figure>
  );
}

function Hero() {
  return (
    <section className="trail-hero" aria-labelledby="landing-title">
      <div className="trail-wrap">
        <Chapter
          number="00 / 06"
          name="A CLEARER WAY TO KEEP TRACK OF SHARED MONEY"
        />
        <div className="trail-hero-composition">
          <div className="trail-hero-copy">
            <h1 id="landing-title">
              <span>Money together.</span>
              <span>Nothing lost between.</span>
            </h1>
            <p>
              From the first expense to the final repayment, see exactly who
              paid, who owes, and what changed.
            </p>
            <div className="trail-actions">
              <a className="trail-button trail-button-primary" href="#record">
                See how it works <span aria-hidden="true">↘</span>
              </a>
              <a className="trail-button trail-button-secondary" href="/login">
                Have an invite? Open Zplit
              </a>
            </div>
            <small>Invite-only accounts</small>
          </div>
          <HeroLedger />
        </div>
        <a className="trail-scroll-cue" href="#record">
          Scroll to follow the money <span aria-hidden="true">↓</span>
        </a>
      </div>
    </section>
  );
}

function Personal() {
  return (
    <section
      className="trail-section trail-personal"
      id="personal"
      aria-labelledby="personal-heading"
    >
      <div className="trail-wrap">
        <Chapter number="02 / 06" name="PERSONAL / THE WHOLE HISTORY" />
        <div className="trail-section-head">
          <h2 id="personal-heading">
            Your life doesn’t happen in one transaction.
          </h2>
          <p>
            Keep expenses, friends, repayments, trips, and outings together.
            Search the record, inspect a balance, or export your history when
            you need it.
          </p>
        </div>
        <div className="trail-personal-layout">
          <div className="trail-spine">
            EXPENSE <span>→</span> SHARE <span>→</span> REPAYMENT <span>→</span>{" "}
            BALANCE
          </div>
          <PersonalRecords />
        </div>
      </div>
    </section>
  );
}

function Share() {
  return (
    <section
      className="trail-section trail-share"
      id="sharing"
      aria-labelledby="share-heading"
    >
      <div className="trail-wrap">
        <Chapter number="05 / 06" name="A SELECTED VIEW" />
        <div className="trail-section-head">
          <h2 id="share-heading">
            No account?
            <br />
            They can still see their part.
          </h2>
          <p>
            A temporary, revocable link can show Alya her selected share.
            Personal records outside that scope stay private.
          </p>
        </div>
        <div className="trail-share-layout">
          <div className="trail-share-origin">
            <span>FROM WILDAN’S PERSONAL RECORD</span>
            <p>
              One person.
              <br />
              One selected view.
            </p>
            <small>Illustrative example · Revocable by the owner</small>
          </div>
          <details className="trail-share-disclosure">
            <summary className="trail-share-link">
              Open Alya’s temporary statement <span aria-hidden="true">↗</span>
            </summary>
            <article
              className="trail-share-sheet"
              aria-label="Illustrative public statement for Alya"
            >
              <div className="trail-ledger-top">
                <span>ALYA / YOUR PART</span>
                <span>Illustrative example</span>
              </div>
              <div className="trail-share-sheet-body">
                <h3>Bandung day out</h3>
                <div>
                  <span>Your share</span>
                  <Amount value={160_000} />
                </div>
                <div>
                  <span>Repayment applied</span>
                  <Amount value={100_000} />
                </div>
                <strong>
                  <span>Still owed to Wildan</span>
                  <Amount value={60_000} />
                </strong>
                <p>
                  Repayment destination and receipt appear only when the owner
                  enables them.
                </p>
              </div>
              <div className="trail-ledger-top">
                <span>Link expires</span>
                <span>Owner can revoke access</span>
              </div>
            </article>
          </details>
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <footer className="trail-closing" id="entry">
      <div className="trail-wrap">
        <Chapter number="06 / 06" name="THE RECORD CONTINUES" />
        <div className="trail-closing-body">
          <svg viewBox="0 0 240 96" aria-hidden="true">
            <path d="M2 48 H116 L145 76 L238 3" />
          </svg>
          <h2>
            Keep the story of
            <br />
            the money straight.
          </h2>
          <p>
            One clear record for the things you pay, share, repay, and plan.
          </p>
          <div className="trail-actions">
            <a className="trail-button trail-button-primary" href="/login">
              Have an invite? Open Zplit <span aria-hidden="true">↗</span>
            </a>
            <a className="trail-button trail-button-secondary" href="#top">
              Back to the top ↑
            </a>
          </div>
        </div>
        <div className="trail-footer-line">
          <strong>Zplit</strong>
          <nav aria-label="Footer navigation">
            <a href="#record">How it works</a>
            <a href="#personal">Personal</a>
            <a href="#groups">Groups</a>
            <a href="#budget">Budget</a>
            <a href="/login">Log in</a>
          </nav>
          <span>Invite-only</span>
        </div>
      </div>
    </footer>
  );
}

export function MoneyTrailLanding() {
  return (
    <div className="trail-site zplit-vnext" id="top">
      <LandingHeader />
      <main>
        <Hero />
        <Story />
        <Personal />
        <Spaces />
        <Budget />
        <Share />
      </main>
      <Closing />
    </div>
  );
}
