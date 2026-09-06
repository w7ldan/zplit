"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Flip } from "gsap/Flip";
import { Observer } from "gsap/Observer";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { gsap } from "gsap";
import { formatRupiah } from "@/domain/rupiah";
import {
  clampPublicLandingIndex,
  firstPublicLandingIndexForSection,
  nextPublicLandingIndex,
  PUBLIC_LANDING_STATES,
  type PublicLandingState,
} from "./public-motion-state";

type PublicMotionProps = { children: ReactNode };
type SceneElement = HTMLElement & { _publicTrigger?: ScrollTrigger };

const FLOW_VALUES = [
  { label: "CAPTURED", expense: 360_000, assigned: 0, repayment: 0, balance: 360_000 },
  { label: "SHARES ASSIGNED", expense: 360_000, assigned: 210_000, repayment: 0, balance: 210_000 },
  { label: "REPAYMENT LOGGED", expense: 360_000, assigned: 210_000, repayment: 120_000, balance: 90_000 },
  { label: "BALANCE OPEN", expense: 360_000, assigned: 210_000, repayment: 120_000, balance: 90_000 },
] as const;

function setupMagneticLinks(root: HTMLElement) {
  const cleanups: Array<() => void> = [];
  root.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((element) => {
    const moveX = gsap.quickTo(element, "x", { duration: 0.36, ease: "power3.out" });
    const moveY = gsap.quickTo(element, "y", { duration: 0.36, ease: "power3.out" });
    const onMove = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      moveX((event.clientX - bounds.left - bounds.width / 2) * 0.14);
      moveY((event.clientY - bounds.top - bounds.height / 2) * 0.14);
    };
    const reset = () => {
      moveX(0);
      moveY(0);
    };
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
    root.dataset.pointerActive = "true";
    schedule();
  };
  const onLeave = () => {
    x = 0;
    y = 0;
    delete root.dataset.pointerActive;
    schedule();
  };
  root.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerleave", onLeave, { passive: true });
  return () => {
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerleave", onLeave);
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}

function setupLinkedHover(root: HTMLElement) {
  const setRelation = (relation: string | undefined) => {
    if (relation) root.dataset.linkedHover = relation;
    else delete root.dataset.linkedHover;
  };
  const onOver = (event: PointerEvent) => {
    const relation = (event.target as Element).closest<HTMLElement>("[data-related]")?.dataset.related;
    setRelation(relation);
  };
  const onOut = (event: PointerEvent) => {
    const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest<HTMLElement>("[data-related]") : null;
    setRelation(next?.dataset.related);
  };
  const onFocus = (event: FocusEvent) => setRelation((event.target as Element).closest<HTMLElement>("[data-related]")?.dataset.related);
  const onBlur = (event: FocusEvent) => {
    if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest("[data-related]")) setRelation(undefined);
  };
  root.addEventListener("pointerover", onOver, { passive: true });
  root.addEventListener("pointerout", onOut, { passive: true });
  root.addEventListener("focusin", onFocus);
  root.addEventListener("focusout", onBlur);
  return () => {
    root.removeEventListener("pointerover", onOver);
    root.removeEventListener("pointerout", onOut);
    root.removeEventListener("focusin", onFocus);
    root.removeEventListener("focusout", onBlur);
  };
}

function publicNumber(root: HTMLElement, name: string) {
  return root.querySelector<HTMLElement>(`[data-public-number="${name}"]`);
}

function setPublicNumber(element: HTMLElement | null, amount: number) {
  if (!element) return;
  element.dataset.publicValue = String(amount);
  element.textContent = formatRupiah(amount);
}

function rollPublicNumber(element: HTMLElement | null, amount: number, duration: number, immediate: boolean) {
  if (!element) return;
  const current = Number(element.dataset.publicValue ?? 0);
  if (immediate || current === amount) {
    setPublicNumber(element, amount);
    return;
  }
  const proxy = { value: current };
  gsap.to(proxy, {
    value: amount,
    duration,
    ease: "power2.out",
    onUpdate: () => setPublicNumber(element, Math.round(proxy.value)),
    onComplete: () => setPublicNumber(element, amount),
  });
}

function swapLabel(element: HTMLElement | null, label: string, immediate: boolean) {
  if (!element || element.textContent === label) return;
  if (immediate) {
    element.textContent = label;
    return;
  }
  gsap.killTweensOf(element);
  gsap.timeline()
    .to(element, { yPercent: -80, opacity: 0, duration: 0.16, ease: "power2.in" })
    .add(() => { element.textContent = label; })
    .fromTo(element, { yPercent: 80 }, { yPercent: 0, opacity: 1, duration: 0.24, ease: "power3.out" });
}

function animateRecordFlow(root: HTMLElement, step: number, immediate: boolean) {
  const values = FLOW_VALUES[step] ?? FLOW_VALUES[0];
  const flow = root.querySelector<HTMLElement>(".flow-interface");
  if (flow) flow.dataset.flowActiveStep = String(step);
  swapLabel(root.querySelector<HTMLElement>("[data-flow-state-label]"), values.label, immediate);
  const numbers = [
    ["flow-expense", values.expense],
    ["flow-assigned", values.assigned],
    ["flow-repayment", values.repayment],
    ["flow-balance", values.balance],
    ["flow-share-raka", step >= 1 ? 120_000 : 0],
    ["flow-share-sari", step >= 1 ? 90_000 : 0],
  ] as const;
  numbers.forEach(([name, amount]) => rollPublicNumber(publicNumber(root, name), amount, 0.64, immediate));

  const cards = [
    root.querySelector<HTMLElement>("[data-flow-expense]"),
    root.querySelector<HTMLElement>("[data-flow-shares]"),
    root.querySelector<HTMLElement>("[data-flow-repayment]"),
    root.querySelector<HTMLElement>("[data-flow-balance]"),
  ];
  cards.forEach((card, index) => {
    if (!card) return;
    const active = index === step;
    gsap.to(card, {
      y: active ? 0 : index < step ? -5 : 5,
      scale: active ? 1 : 0.985,
      opacity: active ? 1 : 0.74,
      duration: immediate ? 0 : 0.62,
      ease: "power3.out",
      overwrite: true,
    });
  });
  gsap.to(root.querySelector("[data-flow-progress]"), {
    scaleX: Math.max(0.06, step / 3),
    duration: immediate ? 0 : 0.62,
    ease: "power3.out",
    overwrite: true,
  });
  gsap.to(root.querySelector("[data-flow-resolved]"), {
    opacity: step >= 2 ? 1 : 0,
    duration: immediate ? 0 : 0.34,
    overwrite: true,
  });
}

function animateContexts(root: HTMLElement, step: number, immediate: boolean) {
  const states = [
    root.querySelector<HTMLElement>("[data-scope-personal]"),
    root.querySelector<HTMLElement>("[data-scope-group]"),
    root.querySelector<HTMLElement>("[data-scope-organization]"),
  ];
  states.forEach((state, index) => {
    if (!state) return;
    const active = index === step;
    gsap.to(state, {
      x: active ? 0 : index < step ? -34 : 34,
      scale: active ? 1 : 0.96,
      opacity: active ? 1 : 0.12,
      duration: immediate ? 0 : 0.6,
      ease: "power3.inOut",
      overwrite: true,
    });
  });
  gsap.to(root.querySelector("[data-scope-track]"), {
    scaleX: (step + 1) / 3,
    duration: immediate ? 0 : 0.62,
    ease: "power3.out",
    overwrite: true,
  });
  const index = root.querySelector<HTMLElement>("[data-scope-index]");
  if (index) index.textContent = `${String(step + 1).padStart(2, "0")} / 03`;
}

function animateCollaboration(root: HTMLElement, immediate: boolean) {
  const timeline = gsap.timeline({ defaults: { ease: "power3.out", overwrite: true } });
  timeline
    .fromTo(root.querySelector("[data-collab-ledger]"), { xPercent: -8, opacity: 0.3 }, { xPercent: 0, opacity: 1, duration: immediate ? 0 : 0.48 }, 0)
    .fromTo(root.querySelector("[data-collab-chat]"), { xPercent: 8, opacity: 0.3 }, { xPercent: 0, opacity: 1, duration: immediate ? 0 : 0.52 }, 0.08)
    .fromTo(root.querySelector("[data-collab-connector]"), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: immediate ? 0 : 0.3 }, 0.34)
    .to(root.querySelector("[data-collab-badge]"), { y: -7, duration: immediate ? 0 : 0.28 }, 0.42);
}

function animateRecords(root: HTMLElement, step: number, immediate: boolean) {
  const owner = root.querySelector<HTMLElement>("[data-private-panel=owner]");
  const shared = root.querySelector<HTMLElement>("[data-private-panel=shared]");
  const sharedView = step === 1;
  gsap.to(owner, { x: sharedView ? -8 : 0, opacity: sharedView ? 0.42 : 1, duration: immediate ? 0 : 0.56, ease: "power3.out", overwrite: true });
  gsap.to(shared, { x: sharedView ? 8 : 0, opacity: sharedView ? 1 : 0.42, duration: immediate ? 0 : 0.56, ease: "power3.out", overwrite: true });
  gsap.to(root.querySelector("[data-after-handoff-line]"), { scaleX: sharedView ? 1 : 0.25, duration: immediate ? 0 : 0.5, ease: "power3.out", overwrite: true });
  const rail = root.querySelector<HTMLElement>("[data-history-rail]");
  const market = root.querySelector<HTMLElement>("[data-history-slip=market]");
  const train = root.querySelector<HTMLElement>("[data-history-slip=train]");
  if (rail && market && train && !immediate) {
    const flipState = Flip.getState([market, train]);
    if (sharedView) rail.insertBefore(train, market);
    else rail.insertBefore(market, train);
    Flip.from(flipState, { duration: 0.58, ease: "power3.inOut", absolute: false, overwrite: true });
  } else if (rail && market && train) {
    if (sharedView) rail.insertBefore(train, market);
    else rail.insertBefore(market, train);
  }
  root.querySelectorAll<HTMLElement>("[data-history-slip]").forEach((record, index) => {
    record.classList.toggle("history-rail__record--active", index === 0);
  });
  rollPublicNumber(publicNumber(root, "history-market"), sharedView ? 90_000 : 360_000, 0.62, immediate);
  rollPublicNumber(publicNumber(root, "history-train"), sharedView ? 360_000 : 90_000, 0.62, immediate);
}

function animateLandingState(root: HTMLElement, state: PublicLandingState, immediate: boolean) {
  root.dataset.landingScene = state.scene;
  root.dataset.landingStep = String(state.step);
  root.querySelectorAll<HTMLElement>("[data-public-scene]").forEach((section) => {
    section.dataset.sceneActive = section.dataset.publicScene === state.scene ? "true" : "false";
  });
  root.querySelectorAll<HTMLElement>("[data-public-jump]").forEach((link) => {
    const active = Number(link.dataset.publicJump) === PUBLIC_LANDING_STATES.indexOf(state);
    if (active) link.setAttribute("aria-current", "step");
    else link.removeAttribute("aria-current");
  });

  if (state.scene === "record-flow") animateRecordFlow(root, state.step, immediate);
  if (state.scene === "contexts") animateContexts(root, state.step, immediate);
  if (state.scene === "collaboration") animateCollaboration(root, immediate);
  if (state.scene === "proof") {
    gsap.fromTo(root.querySelector("[data-proof-receipt]"), { clipPath: immediate ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: immediate ? 0 : 0.68, ease: "power3.out", overwrite: true });
  }
  if (state.scene === "records") animateRecords(root, state.step, immediate);
}

function sceneForState(root: HTMLElement, state: PublicLandingState) {
  return state.sectionId === "top"
    ? root
    : root.querySelector<HTMLElement>(`[data-public-scene="${state.scene}"]`);
}

function createDesktopLanding(root: HTMLElement) {
  let currentIndex = 0;
  let transitionLocked = false;
  let activeScrollTween: gsap.core.Tween | null = null;
  let cooldownUntil = 0;
  let settleTimer: number | null = null;
  let resizeTimer: number | null = null;
  let focusEscapeUntil = 0;
  let snapPoints: number[] = [];
  let observer: Observer | null = null;

  const rebuildSnapPoints = () => {
    snapPoints = PUBLIC_LANDING_STATES.map((state) => {
      if (state.sectionId === "top") return 0;
      const section = sceneForState(root, state);
      return section ? section.offsetTop + state.step * window.innerHeight : 0;
    });
  };
  const nearestIndex = (scrollY: number) => {
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    snapPoints.forEach((point, index) => {
      const nextDistance = Math.abs(point - scrollY);
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = index;
      }
    });
    return nearest;
  };
  const releaseTransition = () => {
    transitionLocked = false;
    activeScrollTween = null;
  };
  const goTo = (requestedIndex: number, reason: "gesture" | "keyboard" | "anchor" | "native", immediate = false) => {
    const index = clampPublicLandingIndex(requestedIndex);
    const now = performance.now();
    if (!immediate && (transitionLocked || now < cooldownUntil)) return;
    rebuildSnapPoints();
    const targetY = snapPoints[index] ?? 0;
    const changed = index !== currentIndex;
    currentIndex = index;
    animateLandingState(root, PUBLIC_LANDING_STATES[index]!, immediate || !changed);
    if (immediate || Math.abs(window.scrollY - targetY) < 2) {
      window.scrollTo(0, targetY);
      releaseTransition();
      return;
    }
    transitionLocked = true;
    cooldownUntil = now + (reason === "gesture" ? 720 : 280);
    activeScrollTween?.kill();
    activeScrollTween = gsap.to(window, {
      scrollTo: { y: targetY, autoKill: false },
      duration: reason === "gesture" ? 0.72 : 0.66,
      ease: "power3.inOut",
      overwrite: "auto",
      onComplete: releaseTransition,
      onInterrupt: releaseTransition,
    });
  };
  const step = (direction: -1 | 1) => {
    const next = nextPublicLandingIndex(currentIndex, direction);
    if (next === currentIndex) {
      observer?.disable();
      window.setTimeout(() => observer?.enable(), 120);
      return;
    }
    goTo(next, "gesture");
  };
  const isNativeControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("a,button,input,textarea,select,[contenteditable=true]"));
  const onKeyDown = (event: KeyboardEvent) => {
    if (isNativeControl(event.target)) return;
    const direction = event.key === "ArrowDown" || event.key === "PageDown" || (event.key === " " && !event.shiftKey)
      ? 1
      : event.key === "ArrowUp" || event.key === "PageUp" || (event.key === " " && event.shiftKey)
        ? -1
        : 0;
    if (event.key === "Home") {
      event.preventDefault();
      goTo(0, "keyboard");
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      goTo(PUBLIC_LANDING_STATES.length - 1, "keyboard");
      return;
    }
    if (direction !== 0) {
      event.preventDefault();
      step(direction as -1 | 1);
    }
  };
  const onScroll = () => {
    if (transitionLocked || performance.now() < focusEscapeUntil) return;
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      const next = nearestIndex(window.scrollY);
      if (next !== currentIndex) goTo(next, "native");
    }, 140);
  };
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof Element && root.contains(event.target)) {
      focusEscapeUntil = performance.now() + 900;
      const next = nearestIndex(window.scrollY);
      currentIndex = next;
      animateLandingState(root, PUBLIC_LANDING_STATES[next]!, true);
    }
  };
  const onJump = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("[data-public-jump]");
    if (!link) return;
    const index = Number(link.dataset.publicJump);
    if (!Number.isInteger(index)) return;
    event.preventDefault();
    goTo(index, "anchor");
  };
  const onAnchor = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='#']");
    if (!link || link.dataset.publicJump) return;
    const id = link.getAttribute("href")?.slice(1);
    if (!id) return;
    const index = firstPublicLandingIndexForSection(id);
    if (index < 0) return;
    event.preventDefault();
    goTo(index, "anchor");
  };
  const onResize = () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      ScrollTrigger.refresh();
      rebuildSnapPoints();
      goTo(nearestIndex(window.scrollY), "native", true);
    }, 100);
  };

  rebuildSnapPoints();
  root.addEventListener("click", onJump);
  root.addEventListener("click", onAnchor);
  root.addEventListener("focusin", onFocusIn);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });

  root.querySelectorAll<SceneElement>("[data-public-scene]").forEach((section) => {
    const stage = section.querySelector<HTMLElement>("[data-scene-stage]");
    if (!stage) return;
    section._publicTrigger = ScrollTrigger.create({
      trigger: section,
      start: "top top",
      end: () => `+=${Math.max(1, section.offsetHeight - window.innerHeight)}`,
      pin: stage,
      pinSpacing: false,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    });
  });
  ScrollTrigger.refresh();
  rebuildSnapPoints();
  goTo(nearestIndex(window.scrollY), "native", true);

  observer = Observer.create({
    id: "public-landing-stepper",
    target: window,
    type: "wheel",
    tolerance: 16,
    debounce: true,
    wheelSpeed: 1,
    preventDefault: true,
    ignore: "a,button,input,textarea,select,[contenteditable=true]",
    onDown: () => step(1),
    onUp: () => step(-1),
  });

  return () => {
    observer?.kill();
    observer = null;
    activeScrollTween?.kill();
    activeScrollTween = null;
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    root.removeEventListener("click", onJump);
    root.removeEventListener("click", onAnchor);
    root.removeEventListener("focusin", onFocusIn);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    root.querySelectorAll<SceneElement>("[data-public-scene]").forEach((section) => section._publicTrigger?.kill());
    releaseTransition();
  };
}

function setupMobileLanding(root: HTMLElement) {
  const triggers: ScrollTrigger[] = [];
  root.querySelectorAll<HTMLElement>("[data-public-scene]").forEach((section) => {
    const revealTargets = section.querySelectorAll<HTMLElement>(".public-scene__marker, .flow-card, .scope-state, .proof-record, .history-panel");
    triggers.push(ScrollTrigger.create({
      trigger: section,
      start: "top 82%",
      end: "bottom 18%",
      onEnter: () => gsap.fromTo(revealTargets, { y: 14, opacity: 0.45 }, { y: 0, opacity: 1, duration: 0.46, stagger: 0.035, ease: "power3.out", overwrite: true }),
      onEnterBack: () => gsap.to(revealTargets, { y: 0, opacity: 1, duration: 0.32, stagger: 0.02, ease: "power3.out", overwrite: true }),
    }));
  });
  return () => triggers.forEach((trigger) => trigger.kill());
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
    gsap.registerPlugin(ScrollTrigger, Observer, ScrollToPlugin, Flip);
    const reducedPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedPreference.matches) target.dataset.motion = "reduced";
    target.dataset.motionReady = "true";
    let media: gsap.MatchMedia | undefined;
    const context = gsap.context(() => {
      media = gsap.matchMedia();
      media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => createDesktopLanding(target));
      media.add("(max-width: 767px) and (prefers-reduced-motion: no-preference)", () => setupMobileLanding(target));
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const cleanupPointer = setupPointerField(target);
        const cleanupMagnetic = setupMagneticLinks(target);
        const cleanupLinkedHover = setupLinkedHover(target);
        return () => {
          cleanupPointer();
          cleanupMagnetic();
          cleanupLinkedHover();
        };
      });
    }, target);
    const onPreferenceChange = (event: MediaQueryListEvent) => {
      if (event.matches) target.dataset.motion = "reduced";
      else delete target.dataset.motion;
    };
    reducedPreference.addEventListener("change", onPreferenceChange);
    const onRefresh = () => ScrollTrigger.refresh();
    window.addEventListener("pageshow", onRefresh);
    return () => {
      window.removeEventListener("pageshow", onRefresh);
      reducedPreference.removeEventListener("change", onPreferenceChange);
      media?.revert();
      context.revert();
      gsap.killTweensOf(window, "scrollTo");
      delete target.dataset.motionReady;
    };
  }, []);

  return (
    <div className="public-home" id="top" ref={root}>
      <nav className="public-scene-index" aria-label="Landing sequence">
        {PUBLIC_LANDING_STATES.map((state, index) => (
          <a
            aria-label={`${String(index).padStart(2, "0")} ${state.label}`}
            data-public-jump={index}
            href={`#${state.sectionId}`}
            key={`${state.scene}-${state.step}`}
          >
            <span>{String(index).padStart(2, "0")}</span><small>{state.label}</small>
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}
