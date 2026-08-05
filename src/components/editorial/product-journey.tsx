"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { formatRupiah } from "@/domain/rupiah";

const scenario = {
  outing: "Bandung day out",
  expenses: [
    { description: "Dinner", amount: 240000 },
    { description: "Taxi", amount: 120000 },
  ],
  shares: [
    { expense: "Dinner", friend: "Rani", amount: 84000 },
    { expense: "Dinner", friend: "Dimas", amount: 42500 },
    { expense: "Taxi", friend: "Rani", amount: 42500 },
  ],
  repayment: { friend: "Rani", amount: 126500 },
};

const expenseTotal = scenario.expenses.reduce((total, expense) => total + expense.amount, 0);
const assignedTotal = scenario.shares.reduce((total, share) => total + share.amount, 0);
const ownerPortion = expenseTotal - assignedTotal;
const raniAssigned = scenario.shares.filter((share) => share.friend === "Rani").reduce((total, share) => total + share.amount, 0);
const dimasAssigned = scenario.shares.filter((share) => share.friend === "Dimas").reduce((total, share) => total + share.amount, 0);

const steps = [
  { label: "An outing is created", title: "Start with the occasion", copy: "Give the shared moment a name and date so every expense has a clear home." },
  { label: "Expenses enter the outing", title: "Record what happened", copy: "Add each expense as its own row. Zplit keeps the amount attached to the outing." },
  { label: "Friend shares are assigned", title: "Enter each share yourself", copy: "Choose a friend and enter the amount they owe. Zplit does not auto-split or allocate it for you." },
  { label: "A repayment is recorded", title: "Show money received", copy: "Record who paid and allocate that repayment to their outstanding expense shares." },
  { label: "The balance becomes settled", title: "Read what remains", copy: "A friend reaches settled when their assigned shares are fully covered by allocated repayments." },
];

function Amount({ value }: { value: number }) {
  return <span className="tabular-nums">{formatRupiah(value)}</span>;
}

function ProductRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="journey-row">
      <span className="journey-row__label">{label}</span>
      <strong>{value}</strong>
      {detail ? <span className="journey-row__detail">{detail}</span> : null}
    </div>
  );
}

function StepPanel({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="journey-panel__content">
        <p className="technical-label">Outing record</p>
        <h3>{scenario.outing}</h3>
        <div className="journey-record-meta">
          <ProductRow label="When" value="Saturday, 12 April 2026" />
          <ProductRow label="Expenses" value="None yet" detail="Ready for the first row" />
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="journey-panel__content">
        <p className="technical-label">Expense rows · {scenario.outing}</p>
        <h3>Two things paid for</h3>
        <div className="journey-list">
          {scenario.expenses.map((expense) => <ProductRow key={expense.description} label={expense.description} value={formatRupiah(expense.amount)} />)}
        </div>
        <div className="journey-total"><span>Outing expense total</span><strong><Amount value={expenseTotal} /></strong></div>
      </div>
    );
  }

  if (step === 2) {
    const allocationStyle = { "--allocation": `${(assignedTotal / expenseTotal) * 100}%` } as CSSProperties;
    return (
      <div className="journey-panel__content">
        <p className="technical-label">Manual share assignment</p>
        <h3>Each share has an owner</h3>
        <div className="journey-list">
          {scenario.shares.map((share) => <ProductRow key={`${share.expense}-${share.friend}`} label={`${share.friend} · ${share.expense}`} value={formatRupiah(share.amount)} />)}
        </div>
        <div className="journey-allocation" style={allocationStyle}>
          <div className="journey-allocation__caption"><span>Assigned shares</span><strong><Amount value={assignedTotal} /></strong></div>
          <div className="journey-allocation__track" aria-label={`${formatRupiah(assignedTotal)} assigned of ${formatRupiah(expenseTotal)}`}><span /></div>
          <div className="journey-allocation__caption"><span>Owner portion</span><strong><Amount value={ownerPortion} /></strong></div>
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="journey-panel__content">
        <p className="technical-label">Repayment record</p>
        <h3>Rani pays back her shares</h3>
        <div className="journey-repayment-row">
          <span><strong>{scenario.repayment.friend}</strong><small>Received and ready to allocate</small></span>
          <strong><Amount value={scenario.repayment.amount} /></strong>
        </div>
        <div className="journey-allocation-list">
          <ProductRow label="Dinner share" value={formatRupiah(84000)} detail="Allocated" />
          <ProductRow label="Taxi share" value={formatRupiah(42500)} detail="Allocated" />
          <ProductRow label="Unallocated" value={formatRupiah(0)} detail="Nothing left" />
        </div>
      </div>
    );
  }

  return (
    <div className="journey-panel__content">
      <p className="technical-label">Friend balances</p>
      <h3>One balance is settled; one remains</h3>
      <div className="journey-balance-list">
        <div className="journey-balance journey-balance--settled">
          <div><strong>Rani</strong><span>Assigned {formatRupiah(raniAssigned)}</span></div>
          <div><span>Remaining</span><strong><Amount value={0} /></strong></div>
          <span className="journey-state">SETTLED</span>
        </div>
        <div className="journey-balance journey-balance--open">
          <div><strong>Dimas</strong><span>Assigned {formatRupiah(dimasAssigned)}</span></div>
          <div><span>Remaining</span><strong><Amount value={dimasAssigned} /></strong></div>
          <span className="journey-state">OPEN</span>
        </div>
      </div>
      <p className="journey-footnote">Remaining across this illustrative outing: <strong><Amount value={dimasAssigned} /></strong>. The owner portion is already excluded from friend balances.</p>
    </div>
  );
}

function JourneyPanel({ step, index, active, desktop }: { step: (typeof steps)[number]; index: number; active: boolean; desktop: boolean }) {
  return (
    <article className={`journey-panel${active ? " journey-panel--active" : ""}`} data-journey-step={index} aria-hidden={desktop ? !active : undefined}>
      <div className="journey-frame__intro">
        <span className="journey-step-mark">{String(index + 1).padStart(2, "0")}</span>
        <div><p className="technical-label">{step.label}</p><p>{step.copy}</p></div>
      </div>
      <StepPanel step={index} />
    </article>
  );
}

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function ProductJourney() {
  const [activeStep, setActiveStep] = useState(0);
  const [desktopSequence, setDesktopSequence] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const runway = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  const setRailProgress = useCallback((progress: number) => {
    const value = clampProgress(progress);
    rail.current?.style.setProperty("--journey-progress", value.toFixed(4));
    rail.current?.style.setProperty("--journey-offset", `${value * -80}%`);
  }, []);

  useEffect(() => {
    const wide = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 960px)") : null;
    const reduced = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const updateMode = () => setDesktopSequence((current) => {
      const next = Boolean(wide?.matches && !reduced?.matches);
      if (current && !next) setRailProgress(0);
      return current === next ? current : next;
    });
    updateMode();
    wide?.addEventListener?.("change", updateMode);
    reduced?.addEventListener?.("change", updateMode);
    return () => {
      wide?.removeEventListener?.("change", updateMode);
      reduced?.removeEventListener?.("change", updateMode);
    };
  }, [setRailProgress]);

  useEffect(() => {
    if (!desktopSequence) return;
    let frame: number | null = null;

    const updateProgress = () => {
      frame = null;
      const element = runway.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const travel = Math.max(element.offsetHeight - window.innerHeight, 1);
      const progress = clampProgress(-bounds.top / travel);
      setRailProgress(progress);
      const nextStep = Math.round(progress * (steps.length - 1));
      setActiveStep((current) => current === nextStep ? current : nextStep);
    };
    const scheduleUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [desktopSequence, setRailProgress]);

  function selectStep(step: number, moveFocus = false) {
    setActiveStep(step);
    if (desktopSequence) setRailProgress(step / (steps.length - 1));
    if (moveFocus) requestAnimationFrame(() => tabs.current[step]?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, step: number) {
    const nextStep = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? (step + 1) % steps.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? (step - 1 + steps.length) % steps.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? steps.length - 1
            : null;
    if (nextStep === null) return;
    selectStep(nextStep, true);
  }

  return (
    <div className="product-journey" aria-label="Illustrative Zplit journey">
      <div className="journey-tabs" role="tablist" aria-label="Zplit journey steps">
        {steps.map((item, index) => (
          <button
            aria-controls="journey-panel"
            aria-selected={activeStep === index}
            className={`journey-tab${activeStep === index ? " journey-tab--active" : ""}`}
            id={`journey-tab-${index}`}
            key={item.label}
            onClick={() => selectStep(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => { tabs.current[index] = element; }}
            role="tab"
            tabIndex={activeStep === index ? 0 : -1}
            type="button"
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.label}
          </button>
        ))}
      </div>
      <p className="journey-announcement" aria-live="polite">Step {activeStep + 1} of {steps.length}: {steps[activeStep].label}</p>
      <div className="journey-runway" ref={runway}>
        <div className="journey-sticky">
          <div className="journey-frame" id="journey-panel" role="tabpanel" aria-labelledby={`journey-tab-${activeStep}`} tabIndex={0}>
            <div className="journey-frame__header">
              <span className="technical-label">Zplit / illustrative scenario</span>
              <span className="technical-label">Whole rupiah · entered by owner</span>
            </div>
            <div className="journey-frame__body">
              <div className="journey-rail" ref={rail}>
                {steps.map((step, index) => <JourneyPanel key={step.label} step={step} index={index} active={activeStep === index} desktop={desktopSequence} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
      <noscript>
        <p className="journey-noscript">This example starts with the Bandung day out, then records Dinner and Taxi, assigns Rani and Dimas explicit shares, allocates Rani&apos;s Rp 126.500 repayment, and leaves Dimas&apos;s Rp 42.500 balance open.</p>
      </noscript>
    </div>
  );
}
