"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatRupiah } from "@/domain/rupiah";
import { useReducedMotion } from "./use-reduced-motion";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const DIGIT_LINE_HEIGHT = 1.1;

export type AnimatedMoneyTone = "default" | "primary" | "debt" | "settled";

export type AnimatedMoneyProps = {
  amount: number;
  animate?: boolean;
  className?: string;
  label?: string;
  tone?: AnimatedMoneyTone;
};

function transformForDigit(digit: number) {
  return `translate3d(0, -${digit * DIGIT_LINE_HEIGHT}em, 0)`;
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

function digitFromRight(digits: number[], index: number, targetLength: number) {
  const sourceIndex = digits.length - (targetLength - index);
  return sourceIndex >= 0 ? digits[sourceIndex] ?? 0 : 0;
}

export function AnimatedMoney({ amount, animate = true, className, label, tone = "default" }: AnimatedMoneyProps) {
  const formatted = formatRupiah(amount);
  const previousAmountRef = useRef<number | null>(null);
  const initialAnimationPendingRef = useRef(true);
  const reelRefs = useRef<Array<HTMLElement | null>>([]);
  const animationsRef = useRef<Animation[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const reducedMotion = useReducedMotion();
  const targetDigits = useMemo(() => digitsIn(formatted), [formatted]);

  useEffect(() => {
    const previousAmount = previousAmountRef.current;
    previousAmountRef.current = amount;
    cancelAnimations(animationsRef.current);

    const shouldAnimate = animate && !reducedMotion && (initialAnimationPendingRef.current || (previousAmount !== null && previousAmount !== amount));
    if (!shouldAnimate) {
      applyFinalTransforms(reelRefs.current, targetDigits);
      if (reducedMotion) initialAnimationPendingRef.current = false;
      setIsAnimating(false);
      return;
    }

    const fromDigits = digitsIn(formatRupiah(previousAmount ?? 0));
    const animations: Animation[] = [];
    animationsRef.current = animations;

    targetDigits.forEach((digit, index) => {
      const reel = reelRefs.current[index];
      if (!reel || typeof reel.animate !== "function") return;
      const fromDigit = digitFromRight(fromDigits, index, targetDigits.length);
      const start = transformForDigit(fromDigit);
      const end = transformForDigit(digit);
      reel.style.transform = start;
      animations.push(reel.animate(
        [{ transform: start }, { transform: end }],
        {
          delay: Math.min(index * 18, 120),
          duration: previousAmount === null ? 460 : 320,
          easing: "cubic-bezier(.22,.78,.24,1)",
          fill: "forwards",
        },
      ));
    });

    if (animations.length === 0) {
      applyFinalTransforms(reelRefs.current, targetDigits);
      initialAnimationPendingRef.current = false;
      setIsAnimating(false);
      return;
    }

    setIsAnimating(true);
    let active = true;
    Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
      if (!active || animationsRef.current !== animations) return;
      applyFinalTransforms(reelRefs.current, targetDigits);
      initialAnimationPendingRef.current = false;
      setIsAnimating(false);
    });

    return () => {
      active = false;
      cancelAnimations(animations);
    };
  }, [amount, animate, reducedMotion, targetDigits]);

  useEffect(() => () => cancelAnimations(animationsRef.current), []);

  let digitIndex = 0;
  return (
    <span
      aria-label={label ? `${label}: ${formatted}` : formatted}
      className={`animated-money vnext-money${className ? ` ${className}` : ""}`}
      data-animating={isAnimating}
      data-tone={tone}
      data-value={amount}
    >
      <span className="animated-money__static" aria-hidden="true">{formatted}</span>
      <span className="animated-money__visual" aria-hidden="true">
        {[...formatted].map((character, index) => {
          if (!/\d/.test(character)) {
            const isSeparator = /[.,]/.test(character);
            return (
              <span className={`animated-money__character${isSeparator ? " animated-money__separator" : ""}`} key={`${index}-${character}`}>
                {character}
              </span>
            );
          }
          const currentDigitIndex = digitIndex;
          digitIndex += 1;
          return (
            <span className="animated-money__digit" key={index}>
              <span
                ref={(element) => { reelRefs.current[currentDigitIndex] = element; }}
                className="animated-money__reel"
                data-money-reel={currentDigitIndex}
                style={{ transform: transformForDigit(Number(character)) }}
              >
                {DIGITS.map((reelDigit) => <span className="animated-money__reel-digit" key={reelDigit}>{reelDigit}</span>)}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
