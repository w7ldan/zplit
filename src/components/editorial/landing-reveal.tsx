"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

export const LEDGER_HANDOFF_TRAVEL_VH = 30;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function ledgerHandoffProgress(scrollY: number, start: number, travel: number) {
  return clamp((scrollY - start) / Math.max(travel, 1));
}

export function ledgerHandoffWindow(progress: number, start: number, end: number) {
  const local = clamp((progress - start) / (end - start));
  return local * local * (3 - 2 * local);
}

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

export function LandingStoryMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const runway = root.current?.querySelector<HTMLElement>("[data-ledger-handoff-runway]");
    if (!runway) return;
    const handoff = runway.querySelector<HTMLElement>("[data-ledger-handoff]");
    const heroLedger = root.current?.querySelector<HTMLElement>(".hero__ledger");
    const journeyFrame = root.current?.querySelector<HTMLElement>(".journey-frame");
    const wide = window.matchMedia?.("(min-width: 960px)");
    const tall = window.matchMedia?.("(min-height: 720px)");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const properties = ["--ledger-handoff-progress", "--ledger-handoff-offset", "--ledger-handoff-width", "--ledger-handoff-rows", "--ledger-handoff-balance", "--ledger-handoff-structure"];
    let frame: number | null = null;
    let start = 0;
    let travel = 1;
    let startWidth = 0;
    let endWidth = 0;
    let entryOffset = 0;
    let active = false;

    const clear = () => {
      delete runway.dataset.handoffActive;
      properties.forEach((property) => runway.style.removeProperty(property));
    };
    const update = () => {
      frame = null;
      if (!active) return;
      const progress = ledgerHandoffProgress(window.scrollY, start, travel);
      const width = ledgerHandoffWindow(progress, 0.1, 0.55);
      const structure = ledgerHandoffWindow(progress, 0.55, 0.95);
      runway.style.setProperty("--ledger-handoff-progress", String(progress));
      runway.style.setProperty("--ledger-handoff-offset", `${progress * travel + structure * entryOffset}px`);
      runway.style.setProperty("--ledger-handoff-width", startWidth && endWidth ? `${startWidth + width * (endWidth - startWidth)}px` : `${41.67 + width * 58.33}%`);
      runway.style.setProperty("--ledger-handoff-rows", String(ledgerHandoffWindow(progress, 0.25, 0.7)));
      runway.style.setProperty("--ledger-handoff-balance", String(ledgerHandoffWindow(progress, 0.35, 0.8)));
      runway.style.setProperty("--ledger-handoff-structure", String(structure));
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(update); };
    const measure = () => {
      active = Boolean(wide?.matches && tall?.matches && !reduced?.matches);
      if (!active) { clear(); return; }
      runway.dataset.handoffActive = "true";
      travel = Math.max(runway.offsetHeight, 1);
      start = runway.getBoundingClientRect().top + window.scrollY;
      startWidth = heroLedger?.getBoundingClientRect().width ?? 0;
      endWidth = journeyFrame?.getBoundingClientRect().width ?? 0;
      const handoffTop = Number.parseFloat(getComputedStyle(handoff ?? runway).top) || 0;
      entryOffset = journeyFrame ? journeyFrame.getBoundingClientRect().top + window.scrollY - (start + travel + handoffTop) : 0;
      update();
    };
    const onPageShow = () => measure();
    const listen = (query: MediaQueryList | undefined) => {
      query?.addEventListener?.("change", measure);
      return () => query?.removeEventListener?.("change", measure);
    };
    const removeWide = listen(wide);
    const removeTall = listen(tall);
    const removeReduced = listen(reduced);
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("pageshow", onPageShow);
    void document.fonts?.ready.then(measure);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pageshow", onPageShow);
      removeWide(); removeTall(); removeReduced();
      if (frame !== null) window.cancelAnimationFrame(frame);
      clear();
    };
  }, []);

  useEffect(() => {
    const targets = [...(root.current?.querySelectorAll<HTMLElement>("[data-story-motion]") ?? [])];
    targets.forEach((target) => target.classList.add("story-motion--ready"));
    const reveal = (target: HTMLElement) => target.classList.add("story-motion--visible");
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      targets.forEach(reveal);
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      reveal(entry.target as HTMLElement);
      observer.unobserve(entry.target);
    }), { threshold: 0.25 });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return <main className="public-home" id="top" ref={root}>{children}</main>;
}
