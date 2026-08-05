"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type LandingRevealProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "p" | "span" | "li" | "h2";
  delay?: number;
  id?: string;
  "aria-label"?: string;
};

export function LandingReveal({ children, className = "", as = "div", delay = 0, id, "aria-label": ariaLabel }: LandingRevealProps) {
  const element = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    target.classList.add("landing-reveal--ready");
    const reveal = () => target.classList.add("landing-reveal--visible");

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      reveal();
      return;
    }
    const bounds = target.getBoundingClientRect();
    if (bounds.top < window.innerHeight && bounds.bottom > 0) {
      reveal();
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      reveal();
      observer.disconnect();
    }, { threshold: 0.1 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const Element = as as "div";
  return <Element ref={(node) => { element.current = node; }} id={id} aria-label={ariaLabel} className={`landing-reveal${className ? ` ${className}` : ""}`} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>{children}</Element>;
}
