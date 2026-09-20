"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";

type OverviewRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  family?: "rise" | "expand" | "slide-left" | "slide-right" | "resolve";
};

export function OverviewReveal({ children, className, delay = 0, family = "rise" }: OverviewRevealProps) {
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = revealRef.current;
    if (!element) return;
    const reduceMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (reduceMotion?.matches) {
      element.dataset.reveal = "visible";
      return;
    }

    let observer: IntersectionObserver | null = null;
    const reveal = () => {
      element.dataset.reveal = "visible";
      observer?.disconnect();
    };

    if (element.getBoundingClientRect().top < window.innerHeight * 0.9) {
      reveal();
    } else if ("IntersectionObserver" in window) {
      element.dataset.reveal = "waiting";
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) reveal();
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
      );
      observer.observe(element);
    } else {
      reveal();
    }

    const updateMotionPreference = () => {
      if (reduceMotion?.matches) {
        observer?.disconnect();
        element.dataset.reveal = "visible";
      }
    };
    reduceMotion?.addEventListener("change", updateMotionPreference);
    return () => {
      observer?.disconnect();
      reduceMotion?.removeEventListener("change", updateMotionPreference);
    };
  }, []);

  const style = { "--overview-reveal-delay": `${delay}ms` } as CSSProperties;
  return <div ref={revealRef} className={`overview-reveal overview-reveal--${family}${className ? ` ${className}` : ""}`} style={style}>{children}</div>;
}
