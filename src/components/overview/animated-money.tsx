"use client";

import { useEffect, useRef } from "react";
import { formatRupiah } from "@/domain/rupiah";

const MONEY_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type AnimatedMoneyTone = "default" | "primary" | "debt" | "settled";

export type AnimatedMoneyProps = {
  amount: number;
  animate?: boolean;
  className?: string;
  label?: string;
  tone?: AnimatedMoneyTone;
};

function cancelAnimation(animation: Animation | null) {
  animation?.cancel();
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(MONEY_REDUCED_MOTION_QUERY).matches;
}

export function AnimatedMoney({ amount, animate = false, className, label, tone = "default" }: AnimatedMoneyProps) {
  const formatted = formatRupiah(amount);
  const previousAmountRef = useRef<number | null>(null);
  const visualRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<Animation | null>(null);

  useEffect(() => {
    const visual = visualRef.current;
    const previousAmount = previousAmountRef.current;
    previousAmountRef.current = amount;
    cancelAnimation(animationRef.current);
    animationRef.current = null;

    if (!visual || !animate || prefersReducedMotion() || typeof visual.animate !== "function") return;
    if (previousAmount === amount || (previousAmount === null && amount === 0)) return;

    const animation = visual.animate(
      [
        { opacity: 0, transform: "translateY(0.18em)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: previousAmount === null ? 480 : 280,
        easing: "cubic-bezier(.22, 1, .36, 1)",
        fill: "both",
      },
    );
    animationRef.current = animation;
    animation.finished.then(() => {
      if (animationRef.current === animation) animationRef.current = null;
    }).catch(() => undefined);
  }, [amount, animate]);

  useEffect(() => {
    if (!animate || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MONEY_REDUCED_MOTION_QUERY);
    const applyPreference = () => {
      if (!media.matches) return;
      cancelAnimation(animationRef.current);
      animationRef.current = null;
      if (visualRef.current) {
        visualRef.current.style.opacity = "";
        visualRef.current.style.transform = "";
      }
    };
    media.addEventListener?.("change", applyPreference);
    media.addListener?.(applyPreference);
    return () => {
      media.removeEventListener?.("change", applyPreference);
      media.removeListener?.(applyPreference);
    };
  }, [animate]);

  useEffect(() => () => cancelAnimation(animationRef.current), []);

  return (
    <span
      aria-label={label ? `${label}: ${formatted}` : formatted}
      className={`animated-money${className ? ` ${className}` : ""}`}
      data-tone={tone}
      data-value={amount}
      style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
    >
      <span ref={visualRef} className="animated-money__visual">{formatted}</span>
    </span>
  );
}
