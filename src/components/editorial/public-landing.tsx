import { ActionLink } from "@/components/editorial/action-link";
import { formatRupiah } from "@/domain/rupiah";
import {
  BudgetPreview,
  MoneyTrailStory,
  PersonalSearch,
  SharedSpaces,
} from "./public-landing-interactions";

export function MoneyAmount({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return (
    <span className={`money-trail__amount ${className}`.trim()}>
      {formatRupiah(value)}
    </span>
  );
}

function Index({ number, label }: { number: string; label: string }) {
  return (
    <p className="money-trail__index">
      <span>{number}</span>
      <span>{label}</span>
    </p>
  );
}

function LedgerRow({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note?: string;
}) {
  return (
    <div className="money-trail__row">
      <span>
        {label}
        {note && <small>{note}</small>}
      </span>
      <MoneyAmount value={value} />
    </div>
  );
}

function HeroStatement() {
  return (
    <figure
      className="money-trail__hero-ledger"
      aria-label="Illustrative Bandung day out expense statement"
    >
      <div className="money-trail__paper-head">
        <span>EXPENSE / 001</span>
        <span>Illustrative example</span>
      </div>
      <div className="money-trail__paper-title">
        <div>
          <span className="money-trail__label">PERSONAL · BANDUNG DAY OUT</span>
          <h2>
            One day,
            <br />
            three shares.
          </h2>
        </div>
        <MoneyAmount value={480_000} />
      </div>
      <div className="money-trail__payer">
        <span className="money-trail__dot" aria-hidden="true" />
        <span>Paid by Wildan</span>
        <span>16 May 2026 · 14:30</span>
      </div>
      <div className="money-trail__ledger-grid">
        <div className="money-trail__trail" aria-hidden="true">
          <svg viewBox="0 0 40 198" preserveAspectRatio="none">
            <path d="M20 0V162Q20 180 38 180" />
          </svg>
        </div>
        <div>
          <p className="money-trail__label">EXPLICIT SHARES</p>
          <LedgerRow label="Wildan" note="His own share" value={160_000} />
          <LedgerRow label="Alya" value={160_000} />
          <LedgerRow label="Bima" value={160_000} />
        </div>
      </div>
      <div className="money-trail__paper-foot">
        <span>
          After Alya repaid <MoneyAmount value={100_000} />
        </span>
        <strong>
          <span>Still owed</span>
          <MoneyAmount value={220_000} />
        </strong>
      </div>
    </figure>
  );
}

function PersonalSpread() {
  return (
    <section
      className="money-trail__section money-trail__personal"
      id="personal"
      aria-labelledby="personal-title"
    >
      <div className="editorial-shell">
        <Index number="02" label="PERSONAL / THE WHOLE HISTORY" />
        <div className="money-trail__section-intro">
          <h2 id="personal-title">
            Your life doesn’t happen in one transaction.
          </h2>
          <p>
            Keep expenses, friends, repayments, trips, and outings together.
            Search the record, inspect a balance, or export your history when
            you need it.
          </p>
        </div>
        <div className="money-trail__personal-layout">
          <div className="money-trail__spine" aria-label="Expense to balance">
            EXPENSE <span>→</span> SHARE <span>→</span> REPAYMENT <span>→</span>{" "}
            BALANCE
          </div>
          <PersonalSearch />
        </div>
      </div>
    </section>
  );
}

function ShareStatement() {
  return (
    <section
      className="money-trail__section money-trail__share"
      id="sharing"
      aria-labelledby="share-title"
    >
      <div className="editorial-shell">
        <Index number="05" label="A SELECTED VIEW" />
        <div className="money-trail__section-intro">
          <h2 id="share-title">
            No account?
            <br />
            They can still see their part.
          </h2>
          <p>
            A temporary, revocable link can show a selected person their own
            share. It does not open your Personal ledger.
          </p>
        </div>
        <div className="money-trail__share-layout">
          <div className="money-trail__share-explain">
            <span className="money-trail__label">FROM A PRIVATE RECORD</span>
            <p>Wildan shares only Alya’s statement for Bandung day out.</p>
            <div className="money-trail__share-arrow" aria-hidden="true">
              ↗
            </div>
            <span className="money-trail__label">
              TEMPORARY LINK · REVOCABLE
            </span>
          </div>
          <article
            className="money-trail__public-sheet"
            aria-label="Illustrative public statement for Alya"
          >
            <div className="money-trail__paper-head">
              <span>ALYA / YOUR PART</span>
              <span>Illustrative example</span>
            </div>
            <h3>Bandung day out</h3>
            <LedgerRow label="Your share" value={160_000} />
            <LedgerRow label="Repayment applied" value={100_000} />
            <div className="money-trail__public-total">
              <span>Still owed to Wildan</span>
              <MoneyAmount value={60_000} />
            </div>
            <p>
              Repayment destination appears when the owner enables it. A receipt
              appears only if sharing it is enabled.
            </p>
            <div className="money-trail__paper-head">
              <span>Link expires</span>
              <span>Owner can revoke access</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <footer className="money-trail__closing" id="entry">
      <div className="editorial-shell">
        <Index number="06" label="THE RECORD CONTINUES" />
        <div className="money-trail__closing-content">
          <svg
            className="money-trail__closing-mark"
            viewBox="0 0 240 95"
            aria-hidden="true"
          >
            <path d="M2 48H118L145 75L237 2" />
          </svg>
          <h2>
            Keep the story of
            <br />
            the money straight.
          </h2>
          <p>
            One clear record for the things you pay, share, repay, and plan.
          </p>
          <div className="money-trail__actions">
            <ActionLink href="/login" variant="primary">
              Have an invite? Open Zplit <span aria-hidden="true">↗</span>
            </ActionLink>
            <ActionLink href="#top">Back to the top ↑</ActionLink>
          </div>
        </div>
        <div className="money-trail__footer-line">
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

export function PublicLanding() {
  return (
    <main>
      <section className="money-trail__hero" aria-labelledby="public-title">
        <div className="editorial-shell">
          <Index
            number="00"
            label="A CLEARER WAY TO KEEP TRACK OF SHARED MONEY"
          />
          <div className="money-trail__hero-grid">
            <div className="money-trail__hero-copy">
              <h1 id="public-title">
                <span>Money together.</span>
                <span>Nothing lost between.</span>
              </h1>
              <p>
                From the first expense to the final repayment, see exactly who
                paid, who owes, and what changed.
              </p>
              <div className="money-trail__actions">
                <ActionLink href="#record" variant="primary">
                  See how it works <span aria-hidden="true">↘</span>
                </ActionLink>
                <ActionLink href="/login">
                  Have an invite? Open Zplit
                </ActionLink>
              </div>
              <p className="money-trail__note">Invite-only accounts</p>
            </div>
            <HeroStatement />
          </div>
          <a className="money-trail__scroll-cue" href="#record">
            Scroll to follow the money ↓
          </a>
        </div>
      </section>
      <MoneyTrailStory />
      <PersonalSpread />
      <SharedSpaces />
      <BudgetPreview />
      <ShareStatement />
      <ClosingCTA />
    </main>
  );
}
