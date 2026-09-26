"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { formatRupiah } from "@/domain/rupiah";

const steps = [
  {
    name: "Expense",
    title: "Someone covered the day.",
    detail:
      "Wildan recorded the actual outing expense, time, context, and optional receipt.",
  },
  {
    name: "Shares",
    title: "Every part has a person.",
    detail:
      "Three explicit shares. Wildan’s own share is not money owed back to him.",
  },
  {
    name: "Repayment",
    title: "A payment has a destination.",
    detail:
      "Alya’s cash repayment and the amount applied to her share remain separate records.",
  },
  {
    name: "Remaining",
    title: "The rest stays visible.",
    detail:
      "Alya still owes Rp60.000 and Bima Rp160.000. Together that is Rp220.000.",
  },
] as const;

function Amount({ value }: { value: number }) {
  return <span className="money-trail__amount">{formatRupiah(value)}</span>;
}

function Index({ number, label }: { number: string; label: string }) {
  return (
    <p className="money-trail__index">
      <span>{number}</span>
      <span>{label}</span>
    </p>
  );
}

export function MoneyTrailStory() {
  const [step, setStep] = useState(0);
  const [partial, setPartial] = useState(false);
  useEffect(() => {
    if (typeof window.IntersectionObserver === "undefined") return;
    if (
      window.matchMedia("(max-width: 767px), (prefers-reduced-motion: reduce)")
        .matches
    )
      return;
    const nodes = document.querySelectorAll<HTMLElement>("[data-trail-step]");
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.hidden) return;
        const candidate = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (candidate)
          setStep(Number((candidate.target as HTMLElement).dataset.trailStep));
      },
      { rootMargin: "-25% 0px -35% 0px", threshold: [0, 0.25, 0.5, 0.75] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  const applied = partial ? 80_000 : 100_000;
  const remaining = 160_000 - applied + 160_000;
  const remainingDetail = partial
    ? "Alya still owes Rp80.000 and Bima Rp160.000. Together that is Rp240.000. Rp20.000 received still needs allocation."
    : steps[3].detail;
  return (
    <section
      className="money-trail__section money-trail__story"
      id="record"
      aria-labelledby="record-title"
    >
      <div className="editorial-shell">
        <div className="money-trail__story-heading">
          <Index number="01" label="FOLLOW ONE EXPENSE" />
          <h2 id="record-title">Follow the money.</h2>
          <p>
            One expense becomes named shares, a repayment, and a balance that
            stays readable.
          </p>
        </div>
        <div className="money-trail__story-grid">
          <div className="money-trail__story-steps">
            <div
              className="money-trail__step-selector"
              aria-label="Expense story steps"
            >
              {steps.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  aria-current={step === index ? "step" : undefined}
                  onClick={() => setStep(index)}
                >
                  {String(index + 1).padStart(2, "0")} <span>{item.name}</span>
                </button>
              ))}
            </div>
            {steps.map((item, index) => (
              <div
                className={`money-trail__step ${step === index ? "money-trail__step--active" : ""}`}
                data-trail-step={index}
                key={item.name}
              >
                <span className="money-trail__label">
                  0{index + 1} / {item.name}
                </span>
                <h3>{item.title}</h3>
                <p>{index === 3 ? remainingDetail : item.detail}</p>
              </div>
            ))}
          </div>
          <div className="money-trail__story-sticky">
            <article
              className="money-trail__story-sheet"
              aria-label="Illustrative Bandung expense as it changes through the story"
            >
              <div className="money-trail__paper-head">
                <span>BANDUNG DAY OUT / 001</span>
                <span>Illustrative example</span>
              </div>
              <div className="money-trail__story-total">
                <span>Paid by Wildan · 16 May 2026, 14:30</span>
                <Amount value={480_000} />
                <small>Receipt available ↗</small>
              </div>
              <div
                className={`money-trail__story-events money-trail__story-events--step-${step}`}
              >
                <div className="money-trail__event money-trail__event--payer">
                  <span className="money-trail__event-node" />
                  <span>Expense recorded</span>
                  <Amount value={480_000} />
                </div>
                <div
                  className={`money-trail__event ${step >= 1 ? "money-trail__event--active" : ""}`}
                >
                  <span className="money-trail__event-node" />
                  <span>Wildan · own share</span>
                  <Amount value={160_000} />
                </div>
                <div
                  className={`money-trail__event ${step >= 1 ? "money-trail__event--active" : ""}`}
                >
                  <span className="money-trail__event-node" />
                  <span>Alya · share</span>
                  <Amount value={160_000} />
                </div>
                <div
                  className={`money-trail__event ${step >= 1 ? "money-trail__event--active" : ""}`}
                >
                  <span className="money-trail__event-node" />
                  <span>Bima · share</span>
                  <Amount value={160_000} />
                </div>
                <div
                  className={`money-trail__event ${step >= 2 ? "money-trail__event--active" : ""}`}
                >
                  <span className="money-trail__event-node" />
                  <span>Alya · cash received</span>
                  <Amount value={100_000} />
                </div>
                <div
                  className={`money-trail__event ${step >= 2 ? "money-trail__event--active" : ""}`}
                >
                  <span className="money-trail__event-node" />
                  <span>Applied to Alya’s share</span>
                  <Amount value={applied} />
                </div>
              </div>
              {step >= 2 && (
                <label className="money-trail__allocation">
                  <input
                    type="checkbox"
                    checked={partial}
                    onChange={(event) => setPartial(event.target.checked)}
                  />
                  Show partial allocation
                </label>
              )}
              {step >= 2 && (
                <p className="money-trail__allocation-note" aria-live="polite">
                  {partial
                    ? "Rp100.000 received · Rp80.000 applied · Rp20.000 needs allocation"
                    : "Rp100.000 received · Rp100.000 applied"}
                </p>
              )}
              <div className="money-trail__story-balance">
                <div>
                  <span>Alya still owes</span>
                  <Amount value={160_000 - applied} />
                </div>
                <div>
                  <span>Bima still owes</span>
                  <Amount value={160_000} />
                </div>
                <strong>
                  <span>Remaining</span>
                  <Amount value={remaining} />
                </strong>
              </div>
            </article>
            <p className="money-trail__story-caption" aria-live="polite">
              <strong>{steps[step].title}</strong>{" "}
              {step === 3 ? remainingDetail : steps[step].detail}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const personalRows = [
  {
    label: "Bandung day out",
    detail: "Expense · paid by Wildan",
    amount: 480_000,
  },
  { label: "Alya", detail: "Share · Bandung day out", amount: 160_000 },
  { label: "Bima", detail: "Share · Bandung day out", amount: 160_000 },
  {
    label: "Alya",
    detail: "Repayment · applied to her share",
    amount: 100_000,
  },
];

export function PersonalSearch() {
  const [query, setQuery] = useState("");
  const rows = personalRows.filter((row) =>
    `${row.label} ${row.detail}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="money-trail__personal-sheet">
      <div className="money-trail__paper-head">
        <span>PERSONAL / OUTING</span>
        <span>Illustrative example</span>
      </div>
      <h3>Bandung day out</h3>
      <label className="money-trail__search">
        <span>Search this example</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the record"
        />
      </label>
      <div className="money-trail__personal-rows" aria-live="polite">
        {rows.length ? (
          rows.map((row, index) => (
            <div className="money-trail__row" key={`${row.detail}-${index}`}>
              <span>
                {row.label}
                <small>{row.detail}</small>
              </span>
              <Amount value={row.amount} />
            </div>
          ))
        ) : (
          <p>No matching example rows.</p>
        )}
      </div>
      <details className="money-trail__receipt">
        <summary>
          Receipt available <span aria-hidden="true">↗</span>
        </summary>
        <p>
          Optional receipt attached to Bandung day out. This is an illustrative
          record.
        </p>
      </details>
      <div className="money-trail__personal-foot">
        <span>Current outstanding balance</span>
        <Amount value={220_000} />
      </div>
    </div>
  );
}

export function SharedSpaces() {
  const [space, setSpace] = useState<"groups" | "organizations">("groups");
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home" || event.key === "ArrowLeft"
        ? "groups"
        : "organizations";
    setSpace(next);
    document.getElementById(`${next}-tab`)?.focus();
  }
  return (
    <section
      className="money-trail__section money-trail__spaces"
      id="groups"
      aria-labelledby="groups-title"
    >
      <div className="editorial-shell">
        <Index number="03" label="DIFFERENT KINDS OF TOGETHER" />
        <h2 id="groups-title">TOGETHER</h2>
        <div
          className="money-trail__space-tabs"
          role="tablist"
          aria-label="Shared spaces"
        >
          <button
            type="button"
            role="tab"
            id="groups-tab"
            aria-controls="spaces-panel"
            aria-selected={space === "groups"}
            tabIndex={space === "groups" ? 0 : -1}
            onClick={() => setSpace("groups")}
            onKeyDown={onTabKeyDown}
          >
            Groups
          </button>
          <button
            type="button"
            role="tab"
            id="organizations-tab"
            aria-controls="spaces-panel"
            aria-selected={space === "organizations"}
            tabIndex={space === "organizations" ? 0 : -1}
            onClick={() => setSpace("organizations")}
            onKeyDown={onTabKeyDown}
          >
            Organizations
          </button>
        </div>
        <div className="money-trail__space-layout">
          <div className="money-trail__space-copy">
            <h3>
              {space === "groups"
                ? "Everyone can pay. Everyone can see where things stand."
                : "A shared space with clearer roles."}
            </h3>
            <p>
              {space === "groups"
                ? "Group expenses, participants, settlement confirmations, offsets, and chat stay in their own shared context."
                : "Organization expenses, people, local contacts, activity, and scoped access live in a separate ledger."}
            </p>
          </div>
          <div
            className="money-trail__space-sheet"
            id="spaces-panel"
            role="tabpanel"
            aria-labelledby={
              space === "groups" ? "groups-tab" : "organizations-tab"
            }
          >
            <div className="money-trail__paper-head">
              <span>
                {space === "groups"
                  ? "GROUP / BANDUNG OUTING · SEPARATE LEDGER"
                  : "ORGANIZATION / BANDUNG TEAM"}
              </span>
              <span>Illustrative example</span>
            </div>
            {space === "groups" ? (
              <>
                <div className="money-trail__space-row">
                  <span>Participants</span>
                  <strong>Wildan · Alya · Bima</strong>
                </div>
                <div className="money-trail__space-row">
                  <span>Expense payers</span>
                  <strong>Wildan · Bima</strong>
                </div>
                <div className="money-trail__space-row">
                  <span>Group settlement request</span>
                  <strong>Pending confirmation</strong>
                </div>
                <div className="money-trail__space-row">
                  <span>Reciprocal obligations</span>
                  <strong>Offset · no cash moved</strong>
                </div>
                <div className="money-trail__space-row">
                  <span>Group chat</span>
                  <strong>Context beside the record</strong>
                </div>
              </>
            ) : (
              <>
                <div className="money-trail__space-row">
                  <span>Ledger</span>
                  <strong>Organization only</strong>
                </div>
                <div className="money-trail__space-row">
                  <span>People</span>
                  <strong>Members and local contacts</strong>
                </div>
                <div className="money-trail__space-row">
                  <span>Access</span>
                  <strong>Scoped by role and capability</strong>
                </div>
                <div className="money-trail__space-row">
                  <span>Activity</span>
                  <strong>Inside this organization</strong>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function BudgetPreview() {
  const [included, setIncluded] = useState(true);
  const spent = included ? 1_280_000 : 800_000;
  const remaining = 3_000_000 - spent;
  return (
    <section
      className="money-trail__section money-trail__budget"
      id="budget"
      aria-labelledby="budget-title"
    >
      <div className="editorial-shell">
        <Index number="04" label="A PRIVATE PERSPECTIVE" />
        <div className="money-trail__section-intro">
          <h2 id="budget-title">
            Shared money.
            <br />
            Your own plan.
          </h2>
          <p>
            Choose what counts in your private Budget. That choice never changes
            shares, debt, or settlement for anyone else.
          </p>
        </div>
        <div className="money-trail__budget-layout">
          <div className="money-trail__budget-main">
            <span className="money-trail__label">
              ACTIVE PERIOD / MAY 2026 · ILLUSTRATIVE
            </span>
            <div className="money-trail__budget-numbers">
              <div>
                <span>Remaining</span>
                <Amount value={remaining} />
              </div>
              <div>
                <span>Total plan</span>
                <Amount value={3_000_000} />
              </div>
            </div>
            <div
              className="money-trail__budget-meter"
              role="img"
              aria-label={`Budget net spending ${formatRupiah(spent)} of ${formatRupiah(3_000_000)}`}
            >
              <span style={{ width: `${spent / 30_000}%` }} />
            </div>
            <div className="money-trail__space-row">
              <span>Net spent</span>
              <Amount value={spent} />
            </div>
            <div className="money-trail__space-row">
              <span>Food and outings allocation</span>
              <Amount value={1_500_000} />
            </div>
            <div className="money-trail__space-row">
              <span>Travel allocation</span>
              <Amount value={1_500_000} />
            </div>
            <div className="money-trail__space-row">
              <span>Safe daily spend · 10 days left</span>
              <Amount value={Math.floor(remaining / 10)} />
            </div>
          </div>
          <div className="money-trail__budget-aside">
            <label className="money-trail__budget-toggle">
              <input
                type="checkbox"
                checked={included}
                onChange={(event) => setIncluded(event.target.checked)}
              />
              <span>Count this expense in Budget</span>
            </label>
            <p aria-live="polite">
              Bandung day out{" "}
              {included
                ? "is included in this private illustration."
                : "is excluded from this private illustration."}{" "}
              The shared expense and the Rp220.000 still owed do not change.
            </p>
            <p>
              A repayment’s actual cash amount can differ from its
              Budget-relevant portion. Recurring plans can carry forward; close
              or archive a period before starting another.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
