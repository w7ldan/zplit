"use client";

import type { CSSProperties, PointerEvent } from "react";
import { useEffect, useRef } from "react";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import { formatRupiah } from "@/domain/rupiah";

type OverviewRunwayProps = {
  remaining: number;
  totalBudget: number;
};

export function OverviewRunway({ remaining, totalBudget }: OverviewRunwayProps) {
  const runwayRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<DOMRect | null>(null);
  const ratio = totalBudget > 0 ? remaining / totalBudget : 0;
  const proportion = Math.max(0, Math.min(1, ratio));

  useEffect(() => {
    const element = runwayRef.current;
    if (!element) return;
    element.style.setProperty("--overview-runway-end", `${proportion * 100}%`);
    element.style.setProperty("--overview-runway-scale", `${proportion}`);
    const reduceMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (reduceMotion?.matches) {
      element.dataset.runway = "settled";
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      element.dataset.runway = "running";
    });
    const updateMotionPreference = () => {
      if (reduceMotion?.matches) element.dataset.runway = "settled";
    };
    reduceMotion?.addEventListener("change", updateMotionPreference);
    return () => {
      window.cancelAnimationFrame(frame);
      reduceMotion?.removeEventListener("change", updateMotionPreference);
    };
  }, [proportion]);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    const element = runwayRef.current;
    const bounds = boundsRef.current;
    if (!element || !bounds) return;
    const pointer = Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100));
    element.style.setProperty("--overview-runway-pointer", `${pointer}%`);
    element.dataset.pointer = "active";
  }

  function clearPointer() {
    boundsRef.current = null;
    runwayRef.current?.removeAttribute("data-pointer");
  }

  const style = { "--overview-runway-end": `${proportion * 100}%`, "--overview-runway-scale": proportion } as CSSProperties;
  return (
    <div
      ref={runwayRef}
      className="overview-runway"
      data-runway="idle"
      onPointerMove={handlePointerMove}
      onPointerLeave={clearPointer}
      role="meter"
      aria-label="Budget remaining"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(proportion * 100)}
      aria-valuetext={`${formatSignedRupiah(remaining)} remaining of ${formatRupiah(totalBudget)}`}
      style={style}
      onPointerEnter={() => { boundsRef.current = runwayRef.current?.getBoundingClientRect() ?? null; }}
    >
      <span className="overview-runway__track" aria-hidden="true">
        <span className="overview-runway__fill" />
        <span className="overview-runway__seam" />
      </span>
      <span className="overview-runway__pointer" aria-hidden="true">{Math.round(ratio * 100)}% remaining</span>
    </div>
  );
}
