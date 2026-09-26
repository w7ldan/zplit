"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { formatRupiah } from "@/domain/rupiah";

function Amount({ value }: { value: number }) {
  return <span className="trail-amount">{formatRupiah(value)}</span>;
}

function Chapter({ number, name }: { number: string; name: string }) {
  return (
    <p className="trail-chapter">
      <span>{number}</span>
      <span>{name}</span>
    </p>
  );
}

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const links = (
    <>
      <a href="#record">How it works</a>
      <a href="#personal">Personal</a>
      <a href="#groups">Groups</a>
      <a href="#budget">Budget</a>
    </>
  );
  return (
    <header
      className={`trail-header ${scrolled ? "trail-header-scrolled" : ""}`}
    >
      <div className="trail-wrap trail-header-row">
        <a className="trail-brand" href="#top" aria-label="Zplit home">
          Zplit<span>THE MONEY TRAIL</span>
        </a>
        <nav aria-label="Primary navigation">{links}</nav>
        <div className="trail-header-actions">
          <a href="/login">Log in</a>
          <details>
            <summary aria-label="Open section menu">Menu</summary>
            <nav aria-label="Mobile section navigation">{links}</nav>
          </details>
        </div>
      </div>
    </header>
  );
}

const steps = [
  {
    name: "Expense",
    title: "Someone covered the day.",
    detail:
      "Wildan recorded the Rp480.000 outing with its date, context, and optional receipt.",
  },
  {
    name: "Shares",
    title: "Every part has a person.",
    detail:
      "Three Rp160.000 shares. Wildan’s own cost is not money owed back to him.",
  },
  {
    name: "Repayment",
    title: "A payment has a destination.",
    detail:
      "Alya sent Rp100.000. The cash received and amount applied to her share are separate facts.",
  },
  {
    name: "Remaining",
    title: "The rest stays visible.",
    detail:
      "Alya’s and Bima’s outstanding shares remain legible until they are repaid.",
  },
] as const;

export function Story() {
  const [step, setStep] = useState(0);
  const [partial, setPartial] = useState(false);
  useEffect(() => {
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(max-width: 767px), (prefers-reduced-motion: reduce)")
        .matches
    )
      return;
    const nodes = document.querySelectorAll<HTMLElement>("[data-story-step]");
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.hidden) return;
        const candidate = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (candidate)
          setStep(Number((candidate.target as HTMLElement).dataset.storyStep));
      },
      { rootMargin: "-20% 0px -30% 0px", threshold: [0, 0.25, 0.5, 0.75] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  const applied = partial ? 80_000 : 100_000;
  const alyaRemaining = 160_000 - applied;
  const totalRemaining = alyaRemaining + 160_000;
  return (
    <section
      className="trail-section trail-story"
      id="record"
      aria-label="Follow the money"
    >
      <div className="trail-wrap">
        <Chapter number="01 / 06" name="FOLLOW ONE EXPENSE" />
        <div className="trail-section-head">
          <h2>Follow the money.</h2>
          <p>
            One expense becomes people, a repayment, and a balance you can trace
            back to the record.
          </p>
        </div>
        <div className="trail-story-layout">
          <div className="trail-story-steps">
            <div className="trail-story-mobile-select" aria-label="Story steps">
              {steps.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  aria-current={step === index ? "step" : undefined}
                  onClick={() => setStep(index)}
                >
                  {String(index + 1).padStart(2, "0")}
                </button>
              ))}
            </div>
            {steps.map((item, index) => (
              <div
                className={`trail-story-step ${step === index ? "trail-story-step-active" : ""}`}
                data-story-step={index}
                key={item.name}
              >
                <button
                  type="button"
                  aria-current={step === index ? "step" : undefined}
                  onClick={() => setStep(index)}
                >
                  <span>
                    {String(index + 1).padStart(2, "0")} / {item.name}
                  </span>
                  <strong>{item.title}</strong>
                </button>
                <p>{item.detail}</p>
              </div>
            ))}
          </div>
          <div className="trail-story-sticky">
            <article
              className={`trail-story-paper trail-story-paper-step-${step}`}
              aria-label="Illustrative Bandung day out ledger"
            >
              <div className="trail-ledger-top">
                <span>EXPENSE / BANDUNG DAY OUT</span>
                <span>Illustrative example</span>
              </div>
              <div className="trail-story-lead">
                <div>
                  <span>16 MAY 2026 · 14:30</span>
                  <h3>Bandung day out</h3>
                  <p>
                    Paid by Wildan <span>· Receipt available</span>
                  </p>
                </div>
                <Amount value={480_000} />
              </div>
              <div className="trail-story-record">
                <svg
                  viewBox="0 0 40 290"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path pathLength="1" d="M10 0 V260 Q10 280 30 280" />
                </svg>
                <div className="trail-story-record-rows">
                  <div className="trail-story-record-row">
                    <span>
                      Wildan <small>Own share</small>
                    </span>
                    <Amount value={160_000} />
                  </div>
                  <div className="trail-story-record-row">
                    <span>
                      Alya <small>Share</small>
                    </span>
                    <Amount value={160_000} />
                  </div>
                  <div className="trail-story-record-row">
                    <span>
                      Bima <small>Share</small>
                    </span>
                    <Amount value={160_000} />
                  </div>
                  <div className="trail-story-record-row trail-story-repayment">
                    <span>
                      Alya <small>Cash received</small>
                    </span>
                    <Amount value={100_000} />
                  </div>
                  <div className="trail-story-record-row trail-story-applied">
                    <span>Applied to Alya’s share</span>
                    <Amount value={applied} />
                  </div>
                </div>
              </div>
              {step >= 2 && (
                <div className="trail-story-settlement">
                  <label>
                    <input
                      type="checkbox"
                      checked={partial}
                      onChange={(event) => setPartial(event.target.checked)}
                    />{" "}
                    Show partial allocation
                  </label>
                  <p aria-live="polite">
                    {partial
                      ? "Rp100.000 received · Rp80.000 applied · Rp20.000 needs allocation"
                      : "Rp100.000 received · Rp100.000 applied"}
                  </p>
                </div>
              )}
              <div className="trail-story-balance" aria-live="polite">
                <div>
                  <span>Alya still owes</span>
                  <Amount value={alyaRemaining} />
                </div>
                <div>
                  <span>Bima still owes</span>
                  <Amount value={160_000} />
                </div>
                <strong>
                  <span>Total still owed</span>
                  <Amount value={totalRemaining} />
                </strong>
              </div>
            </article>
            <p className="trail-story-caption" aria-live="polite">
              {step === 3
                ? `Alya ${formatRupiah(alyaRemaining)} + Bima ${formatRupiah(160_000)} = ${formatRupiah(totalRemaining)} still owed.`
                : steps[step].detail}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const records = [
  {
    name: "Bandung day out",
    type: "Expense · paid by Wildan",
    amount: 480_000,
  },
  { name: "Wildan", type: "Own share · Bandung day out", amount: 160_000 },
  { name: "Alya", type: "Share · Bandung day out", amount: 160_000 },
  { name: "Bima", type: "Share · Bandung day out", amount: 160_000 },
  { name: "Alya", type: "Repayment · applied to share", amount: 100_000 },
];

export function PersonalRecords() {
  const [query, setQuery] = useState("");
  const filtered = records.filter((record) =>
    `${record.name} ${record.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="trail-personal-paper">
      <div className="trail-ledger-top">
        <span>PERSONAL / OUTING</span>
        <span>Illustrative example</span>
      </div>
      <div className="trail-personal-head">
        <h3>Bandung day out</h3>
        <span>16 May 2026</span>
      </div>
      <label className="trail-search">
        <span>Search this example</span>
        <input
          type="search"
          placeholder="Find a person or record"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="trail-personal-rows" aria-live="polite">
        {filtered.length ? (
          filtered.map((record, index) => (
            <div className="trail-personal-row" key={`${record.type}-${index}`}>
              <span>
                {record.name}
                <small>{record.type}</small>
              </span>
              <Amount value={record.amount} />
            </div>
          ))
        ) : (
          <p>No matching example rows.</p>
        )}
      </div>
      <details className="trail-receipt">
        <summary>
          Receipt available <span aria-hidden="true">↗</span>
        </summary>
        <p>Optional receipt attached to this illustrative outing expense.</p>
      </details>
      <div className="trail-personal-foot">
        <span>Current outstanding balance</span>
        <Amount value={220_000} />
      </div>
      <p className="trail-personal-export">
        History can be searched and exported from your Personal space.
      </p>
    </div>
  );
}

export function Spaces() {
  const [space, setSpace] = useState<"groups" | "organizations">("groups");
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home" || event.key === "ArrowLeft"
        ? "groups"
        : "organizations";
    setSpace(next);
    document.getElementById(`space-${next}`)?.focus();
  }
  return (
    <section
      className="trail-section trail-spaces"
      id="groups"
      aria-label="TOGETHER"
    >
      <div className="trail-wrap">
        <Chapter number="03 / 06" name="DIFFERENT KINDS OF TOGETHER" />
        <h2>TOGETHER</h2>
        <div
          className="trail-space-tabs"
          role="tablist"
          aria-label="Shared spaces"
        >
          <button
            id="space-groups"
            role="tab"
            type="button"
            aria-selected={space === "groups"}
            aria-controls="space-panel"
            tabIndex={space === "groups" ? 0 : -1}
            onClick={() => setSpace("groups")}
            onKeyDown={onKeyDown}
          >
            Groups
          </button>
          <button
            id="space-organizations"
            role="tab"
            type="button"
            aria-selected={space === "organizations"}
            aria-controls="space-panel"
            tabIndex={space === "organizations" ? 0 : -1}
            onClick={() => setSpace("organizations")}
            onKeyDown={onKeyDown}
          >
            Organizations
          </button>
        </div>
        <div
          className="trail-space-layout"
          id="space-panel"
          role="tabpanel"
          aria-labelledby={`space-${space}`}
        >
          <div className="trail-space-copy">
            <h3>
              {space === "groups" ? (
                <>
                  Everyone can pay.
                  <br />
                  Everyone can see where things stand.
                </>
              ) : (
                "A shared space with clearer roles."
              )}
            </h3>
            <p>
              {space === "groups"
                ? "If the Bandung outing lived in a Group, its participants would see expenses, payment confirmation, offsets, and adjacent chat context together."
                : "An Organization keeps its own ledger, members, local expense contacts, activity, and scoped access separate from Personal records."}
            </p>
          </div>
          <div className="trail-space-paper">
            <div className="trail-ledger-top">
              <span>
                {space === "groups"
                  ? "GROUP / BANDUNG DAY OUT"
                  : "ORGANIZATION / SEPARATE LEDGER"}
              </span>
              <span>Illustrative view</span>
            </div>
            {space === "groups" ? (
              <>
                <div className="trail-space-row">
                  <span>Participants</span>
                  <strong>Wildan · Alya · Bima</strong>
                </div>
                <div className="trail-space-row">
                  <span>Expense payer</span>
                  <strong>Wildan</strong>
                </div>
                <div className="trail-space-row">
                  <span>Bima payment</span>
                  <strong>Pending confirmation</strong>
                </div>
                <div className="trail-space-row">
                  <span>Reciprocal obligations</span>
                  <strong>Offset · not cash</strong>
                </div>
                <div className="trail-space-row">
                  <span>Context</span>
                  <strong>Group chat</strong>
                </div>
              </>
            ) : (
              <>
                <div className="trail-space-row">
                  <span>Ledger</span>
                  <strong>Organization only</strong>
                </div>
                <div className="trail-space-row">
                  <span>People</span>
                  <strong>Members and local contacts</strong>
                </div>
                <div className="trail-space-row">
                  <span>Access</span>
                  <strong>Scoped by role and capability</strong>
                </div>
                <div className="trail-space-row">
                  <span>Record</span>
                  <strong>Activity in this space</strong>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Budget() {
  const [included, setIncluded] = useState(false);
  const spent = 1_720_000 + (included ? 480_000 : 0);
  const remaining = 3_000_000 - spent;
  const daily = remaining / 20;
  return (
    <section
      className="trail-section trail-budget"
      id="budget"
      aria-label="Shared money. Your own plan."
    >
      <div className="trail-wrap">
        <Chapter number="04 / 06" name="BUDGET / PRIVATE PERSPECTIVE" />
        <div className="trail-section-head">
          <h2>
            Shared money.
            <br />
            Your own plan.
          </h2>
          <p>
            Choose which expenses count toward your private Budget. Debt and
            settlement stay anchored to the underlying ledger.
          </p>
        </div>
        <div className="trail-budget-layout">
          <div className="trail-budget-main">
            <div className="trail-budget-top">
              <span>ACTIVE PERIOD / MAY 2026</span>
              <span>Private to you</span>
            </div>
            <div className="trail-budget-summary">
              <div>
                <span>Remaining</span>
                <Amount value={remaining} />
              </div>
              <div className="trail-budget-ring">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle
                    className="trail-budget-track"
                    cx="50"
                    cy="50"
                    r="42"
                  />
                  <circle
                    className="trail-budget-progress"
                    cx="50"
                    cy="50"
                    r="42"
                    strokeDasharray={`${(spent / 3_000_000) * 264} 264`}
                  />
                </svg>
                <span>
                  {Math.round((spent / 3_000_000) * 100)}%<small>USED</small>
                </span>
              </div>
            </div>
            <div className="trail-budget-row">
              <span>Total plan</span>
              <Amount value={3_000_000} />
            </div>
            <div className="trail-budget-row">
              <span>Net spending</span>
              <Amount value={spent} />
            </div>
            <div className="trail-budget-row">
              <span>Safe daily spend · 20 days left</span>
              <Amount value={daily} />
            </div>
            <div className="trail-budget-categories">
              <div>
                <span>Outings</span>
                <span>Rp800.000 allocated</span>
              </div>
              <div>
                <span>Everyday</span>
                <span>Rp1.200.000 allocated</span>
              </div>
              <div>
                <span>Other</span>
                <span>Rp1.000.000 allocated</span>
              </div>
            </div>
          </div>
          <aside className="trail-budget-aside">
            <label>
              <input
                type="checkbox"
                checked={included}
                onChange={(event) => setIncluded(event.target.checked)}
              />{" "}
              Count this expense in Budget
            </label>
            <p aria-live="polite">
              {included
                ? "Bandung day out adds Rp480.000 to this private illustration."
                : "Bandung day out is excluded from this private illustration."}{" "}
              Alya’s Rp60.000 and Bima’s Rp160.000 remain owed.
            </p>
            <p>
              Actual repayment cash can differ from the Budget-relevant amount.
              Recurring plans can continue into a new period after this one is
              closed or archived.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
