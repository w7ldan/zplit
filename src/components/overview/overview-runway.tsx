"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import { formatRupiah } from "@/domain/rupiah";

type OverviewRunwayProps = {
  remaining: number;
  totalBudget: number;
};

export function OverviewRunway({ remaining, totalBudget }: OverviewRunwayProps) {
  const runwayRef = useRef<HTMLDivElement>(null);
  const ratio = totalBudget > 0 ? remaining / totalBudget : 0;
  const proportion = Math.max(0, Math.min(1, ratio));
  const caption = remaining > totalBudget
    ? `${formatRupiah(remaining - totalBudget)} above starting budget`
    : remaining < 0
      ? `${formatRupiah(Math.abs(remaining))} over budget`
      : `${Math.round(ratio * 100)}% of budget remaining`;

  useEffect(() => {
    const element = runwayRef.current;
    if (!element) return;
    element.style.setProperty("--overview-runway-end", `${proportion * 100}%`);
    element.style.setProperty("--overview-runway-scale", `${proportion}`);
    const reduceMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const frame = reduceMotion?.matches
      ? null
      : window.requestAnimationFrame(() => {
        element.dataset.runway = "running";
      });
    if (reduceMotion?.matches) element.dataset.runway = "settled";
    const updateMotionPreference = () => {
      if (reduceMotion?.matches) element.dataset.runway = "settled";
    };
    reduceMotion?.addEventListener("change", updateMotionPreference);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      reduceMotion?.removeEventListener("change", updateMotionPreference);
    };
  }, [proportion]);

  const style = { "--overview-runway-end": `${proportion * 100}%`, "--overview-runway-scale": proportion } as CSSProperties;
  return (
    <div
      ref={runwayRef}
      className="overview-runway"
      data-runway="idle"
      role="meter"
      aria-label="Budget remaining"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(proportion * 100)}
      aria-valuetext={`${formatSignedRupiah(remaining)} remaining of ${formatRupiah(totalBudget)}`}
      style={style}
    >
      <span className="overview-runway__track" aria-hidden="true">
        <span className="overview-runway__fill" />
        <span className="overview-runway__seam" />
      </span>
      <span className="overview-runway__caption" aria-hidden="true">{caption}</span>
    </div>
  );
}
