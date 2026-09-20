"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef } from "react";
import { formatRupiah } from "@/domain/rupiah";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const MONEY_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const visuallyHiddenStyle: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
};

export type AnimatedMoneyTone = "default" | "primary" | "debt" | "settled";

export type AnimatedMoneyProps = {
  amount: number;
  className?: string;
  label?: string;
  tone?: AnimatedMoneyTone;
};

function transformForDigit(digit: number) {
  return `translate3d(0, -${digit * 10}%, 0)`;
}

function isReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MONEY_REDUCED_MOTION_QUERY).matches;
}

function digitsIn(formatted: string) {
  return [...formatted].filter((character) => /\d/.test(character)).map(Number);
}

function applyFinalTransforms(reels: Array<HTMLElement | null>, digits: number[]) {
  digits.forEach((digit, index) => {
    const reel = reels[index];
    if (reel) reel.style.transform = transformForDigit(digit);
  });
}

function cancelAnimations(animations: Animation[]) {
  animations.forEach((animation) => animation.cancel());
  animations.length = 0;
}

export function AnimatedMoney({ amount, className, label, tone = "default" }: AnimatedMoneyProps) {
  const formatted = formatRupiah(amount);
  const previousAmountRef = useRef<number | null>(null);
  const reelRefs = useRef<Array<HTMLElement | null>>([]);
  const animationsRef = useRef<Animation[]>([]);
  const targetDigits = useMemo(() => digitsIn(formatted), [formatted]);

  useEffect(() => {
    const previousAmount = previousAmountRef.current;
    previousAmountRef.current = amount;
    const animations = animationsRef.current;
    cancelAnimations(animations);

    const reels = reelRefs.current;
    if (isReducedMotion()) {
      applyFinalTransforms(reels, targetDigits);
      return;
    }

    const fromDigits = digitsIn(formatRupiah(previousAmount ?? 0));
    const shouldAnimate = previousAmount === null ? amount > 0 : previousAmount !== amount;
    if (!shouldAnimate || typeof HTMLElement.prototype.animate !== "function") {
      applyFinalTransforms(reels, targetDigits);
      return;
    }

    targetDigits.forEach((digit, index) => {
      const reel = reels[index];
      if (!reel) return;
      const fromDigit = fromDigits[index] ?? 0;
      const start = transformForDigit(fromDigit);
      const end = transformForDigit(digit);
      reel.style.transform = start;
      const animation = reel.animate(
        [{ transform: start }, { transform: end }],
        {
          delay: Math.min(index * 18, 120),
          duration: previousAmount === null ? 460 : 320,
          easing: "cubic-bezier(.22,.78,.24,1)",
          fill: "forwards",
        },
      );
      animations.push(animation);
      animation.finished.then(() => {
        if (animations.includes(animation)) reel.style.transform = end;
      }).catch(() => undefined);
    });
  }, [amount, targetDigits]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MONEY_REDUCED_MOTION_QUERY);
    const applyPreference = () => {
      if (media.matches) {
        cancelAnimations(animationsRef.current);
        applyFinalTransforms(reelRefs.current, targetDigits);
      }
    };
    media.addEventListener?.("change", applyPreference);
    media.addListener?.(applyPreference);
    return () => {
      media.removeEventListener?.("change", applyPreference);
      media.removeListener?.(applyPreference);
    };
  }, [amount, targetDigits]);

  useEffect(() => () => cancelAnimations(animationsRef.current), []);

  let digitIndex = 0;
  return (
    <span
      aria-label={label ? `${label}: ${formatted}` : formatted}
      className={`animated-money${className ? ` ${className}` : ""}`}
      data-tone={tone}
      data-value={amount}
      style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
    >
      <span className="animated-money__visual" aria-hidden="true">
        {[...formatted].map((character, index) => {
          if (!/\d/.test(character)) {
            return <span className="animated-money__character" key={`${index}-${character}`}>{character === " " ? " " : character}</span>;
          }
          const currentDigitIndex = digitIndex;
          digitIndex += 1;
          return (
            <span className="animated-money__digit" key={index} style={{ display: "inline-block", height: "1em", overflow: "hidden", verticalAlign: "bottom", width: "0.62em" }}>
              <span
                ref={(element) => { reelRefs.current[currentDigitIndex] = element; }}
                className="animated-money__reel"
                data-money-reel={currentDigitIndex}
                style={{ display: "flex", flexDirection: "column", lineHeight: 1, transform: transformForDigit(Number(character)) }}
              >
                {DIGITS.map((reelDigit) => <span key={reelDigit} style={{ display: "block", height: "1em" }}>{reelDigit}</span>)}
              </span>
            </span>
          );
        })}
      </span>
      <span className="animated-money__accessible" style={visuallyHiddenStyle}>{formatted}</span>
    </span>
  );
}
