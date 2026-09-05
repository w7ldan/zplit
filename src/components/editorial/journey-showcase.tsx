"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { formatRupiah } from "@/domain/rupiah";
import { bandungStory as scenario } from "./public-scenario";

const expenseTotal = scenario.expenses.reduce((total, expense) => total + expense.amount, 0);
const assignedTotal = scenario.shares.reduce((total, share) => total + share.amount, 0);
const ownerPortion = expenseTotal - assignedTotal;
const raniAssigned = scenario.shares.filter((share) => share.friend === "Rani").reduce((total, share) => total + share.amount, 0);
const dimasAssigned = scenario.shares.filter((share) => share.friend === "Dimas").reduce((total, share) => total + share.amount, 0);

const steps = [
  { short: "ADD", label: "Add the record", title: "Give the outing a home.", copy: "Name the outing, then add each expense as its own record." },
  { short: "ASSIGN", label: "Assign shares", title: "Enter each share yourself.", copy: "Choose the Friend and enter the amount they owe. Zplit does not auto-split it for you." },
  { short: "REPAY", label: "Record repayment", title: "Show money received.", copy: "Record who paid, then allocate that repayment to their outstanding shares." },
  { short: "SETTLE", label: "Read the balance", title: "See what remains.", copy: "Each Friend's balance follows the shares and repayments recorded against them." },
];

function Amount({ value }: { value: number }) {
  return <span className="tabular-nums">{formatRupiah(value)}</span>;
}

function ProductRow({ label, value, detail, className = "" }: { label: string; value: string; detail?: string; className?: string }) {
  return <div className={`journey-record-row${className ? ` ${className}` : ""}`}><span><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</span><b>{value}</b></div>;
}

function JourneyScene({ activeStep }: { activeStep: number }) {
  const sharesVisible = activeStep >= 1;
  const repaymentVisible = activeStep >= 2;
  const balancesVisible = activeStep >= 3;

  return (
    <article className="journey-panel" data-journey-step={activeStep} data-journey-layout="stable-record">
      <div className="journey-panel__grid">
        <main className="journey-panel__main">
          <div className="journey-panel__outing"><span className="technical-label">Outing record</span><h3>{scenario.outing}</h3><div className="journey-meta"><span>Sunday, 12 April 2026</span><span>Personal · illustrative</span></div></div>
          <section className="journey-record-block" aria-labelledby="journey-expenses-title">
            <div className="journey-block-heading"><span className="technical-label">Expense rows</span><strong id="journey-expenses-title">What happened</strong></div>
            <div className="journey-record-list">
              {scenario.expenses.map((expense) => (
                <div className="journey-expense" data-expense={expense.description} key={expense.description}>
                  <ProductRow label={expense.description} value={formatRupiah(expense.amount)} detail={`Paid by you · ${scenario.outing}`} />
                  <div className="journey-share-list" data-visible={sharesVisible} aria-hidden={!sharesVisible}>
                    {scenario.shares.filter((share) => share.expense === expense.description).map((share) => {
                      const covered = repaymentVisible && share.friend === "Rani";
                      return <ProductRow key={`${share.expense}-${share.friend}`} label={share.friend} value={formatRupiah(share.amount)} detail={covered ? "Covered by repayment" : "Outstanding · not covered"} className="journey-record-row--share" />;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="journey-record-total">
              <span>Outing expense total</span>
              <strong><Amount value={expenseTotal} /></strong>
            </div>
            <div className="journey-assignment" data-visible={sharesVisible} aria-hidden={!sharesVisible}>
              <span>Assigned to Friends</span>
              <strong><Amount value={assignedTotal} /></strong>
              <small>Your portion · <Amount value={ownerPortion} /></small>
            </div>
          </section>
        </main>

        <aside className="journey-panel__summary" aria-label="Journey state">
          <div className="journey-summary-block">
            <span className="technical-label">Current state</span>
            <strong>{steps[activeStep].short}</strong>
            <p>{steps[activeStep].copy}</p>
          </div>
          <div className="journey-summary-block journey-summary-block--state" data-visible={repaymentVisible} aria-hidden={!repaymentVisible}>
            <span className="technical-label">Repayment</span>
            <ProductRow label="Rani received" value={formatRupiah(scenario.repayment.amount)} detail="Allocated to Dinner + Taxi" />
            <div className="journey-allocation"><span>Allocation complete</span><strong>100%</strong></div>
          </div>
          <div className="journey-summary-block journey-summary-block--balances" data-visible={balancesVisible} aria-hidden={!balancesVisible}>
            <span className="technical-label">Balances</span>
            <div className="journey-balance">
              <span><strong>Rani</strong><small>Assigned {formatRupiah(raniAssigned)}</small></span>
              <strong>{formatRupiah(0)}</strong>
              <span className="record-status record-status--settled">Settled</span>
            </div>
            <div className="journey-balance">
              <span><strong>Dimas</strong><small>Assigned {formatRupiah(dimasAssigned)}</small></span>
              <strong>{formatRupiah(dimasAssigned)}</strong>
              <span className="record-status record-status--open">Open</span>
            </div>
          </div>
          <div className="journey-summary-block journey-summary-block--note"><span className="technical-label">Record rule</span><p>{activeStep === 0 ? "Start with the amount and its outing." : activeStep === 1 ? "Shares are entered explicitly." : activeStep === 2 ? "Repayment allocation stays attached to shares." : "Open and settled states remain visible."}</p></div>
        </aside>
      </div>
    </article>
  );
}

export function JourneyShowcase() {
  const [activeStep, setActiveStep] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectStep(step: number, moveFocus = false) {
    setActiveStep(step);
    if (moveFocus) tabs.current[step]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, step: number) {
    const nextStep = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? (step + 1) % steps.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? (step - 1 + steps.length) % steps.length
        : event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1 : null;
    if (nextStep === null) return;
    event.preventDefault();
    selectStep(nextStep, true);
  }

  return (
    <section className="landing-section journey-section" id="journey" aria-labelledby="journey-title" data-story-motion="journey">
      <div className="editorial-shell journey-section__intro">
        <p className="section-label technical-label">03 / A compact journey</p>
        <div><h2 id="journey-title">From an outing to a balance you can explain.</h2><p>One stable record, four states. Use the controls or keyboard to move through the illustrative Bandung day out.</p></div>
      </div>
      <div className="editorial-shell journey-stage">
        <div className="journey-controls" role="tablist" aria-label="Zplit journey steps">
          {steps.map((step, index) => (
            <button
              aria-label={`${step.short} ${step.label}`}
              aria-controls="journey-panel"
              aria-selected={activeStep === index}
              className={`journey-tab${activeStep === index ? " journey-tab--active" : ""}`}
              id={`journey-tab-${index}`}
              key={step.short}
              onClick={() => selectStep(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              ref={(element) => { tabs.current[index] = element; }}
              role="tab"
              tabIndex={activeStep === index ? 0 : -1}
              type="button"
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.short}</strong>
              <small>{step.label}</small>
            </button>
          ))}
        </div>
        <p className="journey-announcement" aria-live="polite"><span>{String(activeStep + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span><strong>{steps[activeStep].title}</strong><span>{steps[activeStep].copy}</span></p>
        <div className="journey-frame" id="journey-panel" role="tabpanel" aria-labelledby={`journey-tab-${activeStep}`} tabIndex={0}><div className="journey-frame__header"><span className="technical-label">Bandung day out</span><span className="technical-label">Shared expense record</span></div><div className="journey-frame__body"><JourneyScene activeStep={activeStep} /></div></div>
      </div>
      <p className="journey-note editorial-shell"><span>Illustrative flow.</span> Shares, repayments, and allocations are shown as recorded actions; nothing here is automatic.</p>
    </section>
  );
}
