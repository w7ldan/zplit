"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

type PublicMotionProps = { children: ReactNode };
type SceneTimeline = (timeline: gsap.core.Timeline, section: HTMLElement) => void;

function setupMagneticLinks(root: HTMLElement) {
  const cleanups: Array<() => void> = [];
  root.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((element) => {
    const moveX = gsap.quickTo(element, "x", { duration: 0.45, ease: "power3.out" });
    const moveY = gsap.quickTo(element, "y", { duration: 0.45, ease: "power3.out" });
    const onMove = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      moveX((event.clientX - bounds.left - bounds.width / 2) * 0.12);
      moveY((event.clientY - bounds.top - bounds.height / 2) * 0.12);
    };
    const reset = () => { moveX(0); moveY(0); };
    element.addEventListener("pointermove", onMove, { passive: true });
    element.addEventListener("pointerleave", reset, { passive: true });
    cleanups.push(() => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", reset);
      gsap.killTweensOf(element, "x,y");
    });
  });
  return () => cleanups.forEach((cleanup) => cleanup());
}

function setupPointerField(root: HTMLElement) {
  if (!(window.matchMedia?.("(pointer: fine)").matches ?? false)) return () => {};
  let frame: number | null = null;
  let x = 0;
  let y = 0;
  const flush = () => {
    frame = null;
    root.style.setProperty("--public-pointer-x", x.toFixed(3));
    root.style.setProperty("--public-pointer-y", y.toFixed(3));
  };
  const schedule = () => {
    if (frame === null) frame = window.requestAnimationFrame(flush);
  };
  const onMove = (event: PointerEvent) => {
    x = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
    y = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    schedule();
  };
  const onLeave = () => { x = 0; y = 0; schedule(); };
  root.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerleave", onLeave, { passive: true });
  return () => {
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerleave", onLeave);
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}

function createPinnedScene(root: HTMLElement, selector: string, configure: SceneTimeline) {
  const section = root.querySelector<HTMLElement>(selector);
  const stage = section?.querySelector<HTMLElement>("[data-scene-stage]");
  if (!section || !stage) return;
  const timeline = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: "bottom bottom",
      pin: stage,
      scrub: 0.85,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });
  configure(timeline, section);
}

function setupHero(timeline: gsap.core.Timeline) {
  const copy = "[data-hero-copy]";
  timeline
    .to(copy, { yPercent: -14, opacity: 0.3, duration: 0.58, ease: "none" }, 0)
    .to("[data-hero-card]", { xPercent: -24, yPercent: 19, rotate: -4, scale: 0.82, duration: 0.78, ease: "none" }, 0)
    .to("[data-hero-orbit]", { rotation: 22, scale: 1.22, opacity: 0.48, duration: 0.78, ease: "none" }, 0)
    .to("[data-hero-bridge]", { scaleX: 1, opacity: 1, duration: 0.35, ease: "none" }, 0.56);
}

function setupRecordFlow(timeline: gsap.core.Timeline) {
  timeline
    .fromTo("[data-flow-expense]", { x: -46, opacity: 0 }, { x: 0, opacity: 1, duration: 0.22, ease: "none" }, 0)
    .fromTo("[data-flow-shares]", { clipPath: "inset(0 100% 0 0)", opacity: 0.25 }, { clipPath: "inset(0 0% 0 0)", opacity: 1, duration: 0.38, ease: "none" }, 0.16)
    .fromTo("[data-flow-share-row]", { x: -18, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.1, duration: 0.28, ease: "none" }, 0.24)
    .fromTo("[data-flow-repayment]", { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "none" }, 0.48)
    .fromTo("[data-flow-balance]", { scale: 0.82, opacity: 0, y: 20 }, { scale: 1, opacity: 1, y: 0, duration: 0.34, ease: "none" }, 0.68)
    .to("[data-flow-progress]", { scaleX: 1, duration: 0.9, ease: "none" }, 0)
    .to("[data-flow-resolved]", { opacity: 1, duration: 0.2, ease: "none" }, 0.76);
}

function setupContexts(timeline: gsap.core.Timeline) {
  timeline
    .fromTo("[data-scope-personal]", { opacity: 1, x: 0, scale: 1 }, { opacity: 0, x: -24, scale: 0.96, duration: 0.27, ease: "none" }, 0.29)
    .fromTo("[data-scope-group]", { opacity: 0, x: 28, scale: 0.96 }, { opacity: 1, x: 0, scale: 1, duration: 0.27, ease: "none" }, 0.29)
    .to("[data-scope-group]", { opacity: 0, x: -24, scale: 0.96, duration: 0.27, ease: "none" }, 0.63)
    .fromTo("[data-scope-organization]", { opacity: 0, x: 28, scale: 0.96 }, { opacity: 1, x: 0, scale: 1, duration: 0.27, ease: "none" }, 0.63)
    .to("[data-scope-track]", { scaleX: 1, duration: 0.88, ease: "none" }, 0);
}

function setupCollaboration(timeline: gsap.core.Timeline) {
  timeline
    .fromTo("[data-collab-ledger]", { xPercent: -11, opacity: 0.35 }, { xPercent: 0, opacity: 1, duration: 0.35, ease: "none" }, 0)
    .fromTo("[data-collab-chat]", { xPercent: 18, opacity: 0.2 }, { xPercent: 0, opacity: 1, duration: 0.42, ease: "none" }, 0.18)
    .fromTo("[data-collab-connector]", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.28, ease: "none" }, 0.48)
    .to("[data-collab-badge]", { y: -8, duration: 0.22, ease: "none" }, 0.68);
}

function setupProof(root: HTMLElement) {
  const section = root.querySelector<HTMLElement>("[data-public-scene=proof]");
  if (!section) return;
  gsap.fromTo(section.querySelector("[data-proof-receipt]"), { clipPath: "inset(0 100% 0 0)" }, {
    clipPath: "inset(0 0% 0 0)",
    duration: 0.8,
    ease: "power2.out",
    scrollTrigger: { trigger: section, start: "top 72%", end: "top 24%", scrub: 0.7, invalidateOnRefresh: true },
  });
}

function setupScrollScenes(root: HTMLElement) {
  createPinnedScene(root, "[data-public-scene=hero]", setupHero);
  createPinnedScene(root, "[data-public-scene=record-flow]", setupRecordFlow);
  createPinnedScene(root, "[data-public-scene=contexts]", setupContexts);
  createPinnedScene(root, "[data-public-scene=collaboration]", setupCollaboration);
  setupProof(root);
}

export function PublicMotion({ children }: PublicMotionProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = root.current;
    if (!target) return;
    if (typeof window.matchMedia !== "function") {
      target.dataset.motion = "static";
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion) {
      target.dataset.motion = "reduced";
      return;
    }
    target.dataset.motionReady = "true";
    let media: gsap.MatchMedia | undefined;
    const context = gsap.context(() => {
      media = gsap.matchMedia();
      media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => setupScrollScenes(target));
      media.add("(max-width: 767px) and (prefers-reduced-motion: no-preference)", () => setupScrollScenes(target));
    }, target);
    const cleanupPointer = setupPointerField(target);
    const cleanupMagnetic = setupMagneticLinks(target);
    const onRefresh = () => ScrollTrigger.refresh();
    window.addEventListener("pageshow", onRefresh);
    return () => {
      window.removeEventListener("pageshow", onRefresh);
      cleanupPointer();
      cleanupMagnetic();
      media?.revert();
      context.revert();
      delete target.dataset.motionReady;
    };
  }, []);

  return <div className="public-home" id="top" ref={root}>{children}</div>;
}
