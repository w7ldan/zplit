"use client";

import { useEffect, useRef, useState } from "react";
import { formatRupiah } from "@/domain/rupiah";
import { useReducedMotion } from "./use-reduced-motion";

export type AnimatedMoneyTone = "default" | "primary" | "debt" | "settled";

export type AnimatedMoneyProps = {
  amount: number;
  animate?: boolean;
  className?: string;
  label?: string;
  tone?: AnimatedMoneyTone;
};

export function AnimatedMoney({ amount, animate = true, className, label, tone = "default" }: AnimatedMoneyProps) {
  const formatted = formatRupiah(amount);
  const previousAmountRef = useRef(amount);
  const [isAnimating, setIsAnimating] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const previousAmount = previousAmountRef.current;
    previousAmountRef.current = amount;
    if (previousAmount === amount) {
      if (!animate || reducedMotion) {
        const frame = window.requestAnimationFrame(() => setIsAnimating(false));
        return () => window.cancelAnimationFrame(frame);
      }
      return;
    }
    if (!animate || reducedMotion) {
      const frame = window.requestAnimationFrame(() => setIsAnimating(false));
      return () => window.cancelAnimationFrame(frame);
    }
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      setIsAnimating(true);
    });
    const timeout = window.setTimeout(() => {
      if (frame) window.cancelAnimationFrame(frame);
      setIsAnimating(false);
    }, 180);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [amount, animate, reducedMotion]);

  return (
    <span
      aria-label={label ? `${label}: ${formatted}` : formatted}
      className={`animated-money vnext-money${className ? ` ${className}` : ""}`}
      data-animating={isAnimating && animate && !reducedMotion}
      data-tone={tone}
      data-value={amount}
    >
      <span className="animated-money__static" aria-hidden="true">{formatted}</span>
    </span>
  );
}
