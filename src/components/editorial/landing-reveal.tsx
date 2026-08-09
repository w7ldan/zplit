"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

export const LEDGER_HANDOFF_TRAVEL_VH = 30;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function ledgerHandoffProgress(scrollY: number, start: number, travel: number) {
  return clamp((scrollY - start) / Math.max(travel, 1));
}

export function ledgerHandoffTravel(viewportHeight: number) {
  return viewportHeight * (LEDGER_HANDOFF_TRAVEL_VH / 100);
}

export function ledgerHandoffWindow(progress: number, start: number, end: number) {
  const local = clamp((progress - start) / (end - start));
  return local * local * (3 - 2 * local);
}

type LedgerEndpoint = Pick<DOMRect, "left" | "top" | "width">;

export function ledgerHandoffGeometry(hero: LedgerEndpoint, journey: LedgerEndpoint, runway: Pick<DOMRect, "left" | "top">, progress: number) {
  const position = ledgerHandoffWindow(progress, 0, 1);
  const width = ledgerHandoffWindow(progress, 0.1, 0.55);
  const startX = hero.left - runway.left;
  const startY = hero.top - runway.top;
  return {
    x: startX + position * (journey.left - runway.left - startX),
    y: startY + position * (journey.top - runway.top - startY),
    width: hero.width + width * (journey.width - hero.width),
  };
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
    const heroLedger = root.current?.querySelector<HTMLElement>(".hero__ledger");
    const journeyFrame = root.current?.querySelector<HTMLElement>(".journey-frame");
    const wide = window.matchMedia?.("(min-width: 960px)");
    const tall = window.matchMedia?.("(min-height: 720px)");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const properties = ["--ledger-handoff-progress", "--ledger-handoff-x", "--ledger-handoff-y", "--ledger-handoff-width", "--ledger-handoff-rows", "--ledger-handoff-balance", "--ledger-handoff-structure"];
    let frame: number | null = null;
    let start = 0;
    let travel = 1;
    let heroRect: LedgerEndpoint | null = null;
    let journeyRect: LedgerEndpoint | null = null;
    let runwayRect: Pick<DOMRect, "left" | "top"> | null = null;
    let active = false;

    const clear = () => {
      delete runway.dataset.handoffActive;
      properties.forEach((property) => runway.style.removeProperty(property));
    };
    const update = () => {
      frame = null;
      if (!active) return;
      const progress = ledgerHandoffProgress(window.scrollY, start, travel);
      const structure = ledgerHandoffWindow(progress, 0.55, 0.95);
      const geometry = heroRect && journeyRect && runwayRect ? ledgerHandoffGeometry(heroRect, journeyRect, runwayRect, progress) : null;
      runway.style.setProperty("--ledger-handoff-progress", String(progress));
      if (geometry) {
        runway.style.setProperty("--ledger-handoff-x", `${geometry.x}px`);
        runway.style.setProperty("--ledger-handoff-y", `${geometry.y}px`);
        runway.style.setProperty("--ledger-handoff-width", `${geometry.width}px`);
      }
      runway.style.setProperty("--ledger-handoff-rows", String(ledgerHandoffWindow(progress, 0.25, 0.7)));
      runway.style.setProperty("--ledger-handoff-balance", String(ledgerHandoffWindow(progress, 0.35, 0.8)));
      runway.style.setProperty("--ledger-handoff-structure", String(structure));
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(update); };
    const measure = () => {
      active = Boolean(wide?.matches && tall?.matches && !reduced?.matches);
      if (!active) { clear(); return; }
      runway.dataset.handoffActive = "true";
      heroRect = heroLedger?.getBoundingClientRect() ?? null;
      journeyRect = journeyFrame?.getBoundingClientRect() ?? null;
      runwayRect = runway.getBoundingClientRect();
      travel = ledgerHandoffTravel(window.innerHeight);
      start = runwayRect.top + window.scrollY;
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

  useLayoutEffect(() => {
    const finale = root.current?.querySelector<HTMLElement>('[data-story-motion="finale"]');
    if (!finale) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const properties = ["--payoff-row-progress", "--payoff-cta-progress"];
    let frame: number | null = null;
    let start = 0;
    let travel = 1;

    const clear = () => {
      finale.classList.remove("payoff-motion--ready");
      properties.forEach((property) => finale.style.removeProperty(property));
    };
    const update = () => {
      frame = null;
      if (reduced?.matches) return;
      const progress = ledgerHandoffProgress(window.scrollY, start, travel);
      finale.style.setProperty("--payoff-row-progress", String(ledgerHandoffWindow(progress, 0.25, 0.7)));
      finale.style.setProperty("--payoff-cta-progress", String(ledgerHandoffWindow(progress, 0.68, 0.95)));
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(update); };
    const measure = () => {
      if (reduced?.matches) { clear(); return; }
      finale.classList.add("payoff-motion--ready");
      const top = finale.getBoundingClientRect().top + window.scrollY;
      travel = Math.max(window.innerHeight * 0.65, 1);
      start = top - travel;
      update();
    };
    const onPageShow = () => measure();
    reduced?.addEventListener?.("change", measure);
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("pageshow", onPageShow);
    void document.fonts?.ready.then(measure);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pageshow", onPageShow);
      reduced?.removeEventListener?.("change", measure);
      if (frame !== null) window.cancelAnimationFrame(frame);
      clear();
    };
  }, []);

  useEffect(() => {
    const targets = [...(root.current?.querySelectorAll<HTMLElement>('[data-story-motion]:not([data-story-motion="finale"])') ?? [])];
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
