"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Flip } from "gsap/Flip";
import { Observer } from "gsap/Observer";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { gsap } from "gsap";
import {
  clampPublicLandingIndex,
  firstPublicLandingIndexForSection,
  nearestPublicLandingIndex,
  nextPublicLandingIndex,
  PUBLIC_LANDING_STATES,
  publicLandingAriaCurrent,
  publicLandingStep,
  publicLandingTimelineRatio,
  type PublicLandingState,
} from "./public-motion-state";

type PublicMotionProps = { children: ReactNode };
type SceneElement = HTMLElement & { _publicTrigger?: ScrollTrigger };
type AmbientController = (scene: PublicLandingState["scene"]) => void;

const FLOW_LABELS = ["EXPENSE", "SHARES", "REPAYMENT", "BALANCE"] as const;

function setupMagneticLinks(root: HTMLElement) {
  const cleanups: Array<() => void> = [];
  root.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((element) => {
    const moveX = gsap.quickTo(element, "x", { duration: 0.3, ease: "power3.out" });
    const moveY = gsap.quickTo(element, "y", { duration: 0.3, ease: "power3.out" });
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

function swapLabel(element: HTMLElement | null, label: string, immediate: boolean) {
  if (!element || element.textContent === label) return;
  if (immediate) {
    element.textContent = label;
    return;
  }
  gsap.killTweensOf(element);
  gsap.timeline()
    .to(element, { yPercent: -80, opacity: 0, duration: 0.12, ease: "power2.in" })
    .add(() => { element.textContent = label; })
    .fromTo(element, { yPercent: 80 }, { yPercent: 0, opacity: 1, duration: 0.22, ease: "power3.out" });
}

function flowCards(root: HTMLElement) {
  return [
    root.querySelector<HTMLElement>("[data-flow-expense]"),
    root.querySelector<HTMLElement>("[data-flow-shares]"),
    root.querySelector<HTMLElement>("[data-flow-repayment]"),
    root.querySelector<HTMLElement>("[data-flow-balance]"),
  ].filter((card): card is HTMLElement => Boolean(card));
}

function animateRecordFlow(root: HTMLElement, step: number, immediate: boolean) {
  const cards = flowCards(root);
  Flip.killFlipsOf(cards);
  const layout = Flip.getState(cards);
  const previousStep = Number(root.querySelector<HTMLElement>(".flow-interface")?.dataset.flowActiveStep ?? step);
  const direction = step === previousStep ? 0 : step > previousStep ? 1 : -1;
  root.querySelector<HTMLElement>(".flow-interface")?.setAttribute("data-flow-active-step", String(step));
  cards.forEach((card, index) => card.setAttribute("data-expanded", String(index === step)));
  root.querySelectorAll(".flow-steps li").forEach((item, index) => {
    if (index === step) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  swapLabel(root.querySelector<HTMLElement>("[data-flow-state-label]"), FLOW_LABELS[step] ?? "EXPENSE", immediate);
  const revealFrom = direction < 0 ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
  gsap.fromTo(cards[step]?.querySelectorAll("[data-public-number]") ?? [],
    { y: direction < 0 ? -10 : 10, clipPath: revealFrom },
    { y: 0, clipPath: "inset(0 0 0% 0)", duration: immediate ? 0 : 0.4, delay: immediate ? 0 : 0.12, ease: "power3.out", stagger: immediate ? 0 : 0.04, overwrite: true });
  if (!immediate) Flip.from(layout, { duration: 0.56, ease: "power3.inOut", absolute: false, nested: true, scale: false });
  gsap.to(root.querySelector("[data-flow-progress]"), { scaleX: (step + 1) / 4, duration: immediate ? 0 : 0.45, overwrite: true });
  gsap.fromTo(cards[step]?.querySelectorAll(".flow-share-row i") ?? [], { scaleX: 0 }, { scaleX: 1, duration: immediate ? 0 : 0.4, stagger: 0.07, overwrite: true });
}

function animateContexts(root: HTMLElement, step: number, immediate: boolean, direction: -1 | 0 | 1) {
  const states = [
    root.querySelector<HTMLElement>("[data-scope-personal]"),
    root.querySelector<HTMLElement>("[data-scope-group]"),
    root.querySelector<HTMLElement>("[data-scope-organization]"),
  ].filter((state): state is HTMLElement => Boolean(state));
  gsap.killTweensOf(states.flatMap((state) => [state, ...state.querySelectorAll("*")]));
  const previousStep = Number(root.dataset.scopeStep ?? step);
  const incoming = states[step];
  const outgoing = states[previousStep];
  const setAccessibility = (state: HTMLElement, active: boolean) => {
    state.setAttribute("aria-hidden", active ? "false" : "true");
    state.inert = !active;
    state.style.pointerEvents = active ? "auto" : "none";
  };

  if (immediate || !incoming || !outgoing || previousStep === step) {
    states.forEach((state, index) => {
      const active = index === step;
      gsap.set(state, { autoAlpha: active ? 1 : 0, x: 0, scale: 1, clipPath: "inset(0 0% 0 0%)", zIndex: active ? 2 : 0 });
      setAccessibility(state, active);
    });
  } else {
    states.forEach((state, index) => {
      setAccessibility(state, index === step);
      if (state !== incoming && state !== outgoing) gsap.set(state, { autoAlpha: 0 });
    });
    gsap.set(incoming, { zIndex: 2 });
    const enteringParts = incoming.querySelectorAll<HTMLElement>(".scope-anchor, .scope-relations, .scope-access, .scope-peer-rule");
    const timeline = gsap.timeline({ defaults: { ease: "power3.out", overwrite: true } });
    timeline
      .to(outgoing, {
        x: direction > 0 ? -24 : 24,
        clipPath: direction > 0 ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)",
        autoAlpha: 0,
        duration: 0.28,
      }, 0.18)
      .fromTo(incoming, {
        x: direction > 0 ? 34 : -34,
        clipPath: direction > 0 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)",
        autoAlpha: 0,
      }, {
        x: 0,
        clipPath: "inset(0 0% 0 0%)",
        autoAlpha: 1,
        duration: 0.5,
      }, 0)
      .fromTo(enteringParts, { scaleX: 0.82, transformOrigin: "left", clipPath: "inset(0 100% 0 0)" }, { scaleX: 1, clipPath: "inset(0 0% 0 0)", duration: 0.32, stagger: 0.045 }, 0.18);
  }
  root.dataset.scopeStep = String(step);
  gsap.to(root.querySelector("[data-scope-track]"), {
    scaleX: (step + 1) / 3,
    duration: immediate ? 0 : 0.46,
    ease: "power3.out",
    overwrite: true,
  });
  swapLabel(root.querySelector<HTMLElement>("[data-scope-active-label]"), ["PERSONAL", "GROUPS", "ORGANIZATIONS"][step] ?? "PERSONAL", immediate);
  const index = root.querySelector<HTMLElement>("[data-scope-index]");
  if (index) index.textContent = `${String(step + 1).padStart(2, "0")} / 03`;
}

function animateCollaboration(root: HTMLElement, immediate: boolean) {
  const ledger = root.querySelector<HTMLElement>("[data-collab-ledger]");
  const chat = root.querySelector<HTMLElement>("[data-collab-chat]");
  const rows = root.querySelectorAll<HTMLElement>(".collab-ledger-row");
  const messages = root.querySelectorAll<HTMLElement>(".collab-message");
  if (immediate) {
    gsap.set([ledger, chat, ...rows, ...messages, root.querySelector("[data-collab-connector]"), root.querySelector("[data-collab-badge]")], { x: 0, y: 0, xPercent: 0, scale: 1, autoAlpha: 1 });
    return;
  }
  const timeline = gsap.timeline({ defaults: { ease: "power3.out", overwrite: true } });
  timeline
    .set([ledger, chat], { autoAlpha: 0 })
    .fromTo(ledger, { xPercent: 6 }, { xPercent: 0, autoAlpha: 1, duration: 0.42 }, 0.42)
    .fromTo(chat, { xPercent: -6 }, { xPercent: 0, autoAlpha: 1, duration: 0.36 }, 0)
    .fromTo(rows, { x: -18, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.28, stagger: 0.07 }, 0.5)
    .fromTo(messages, { x: 18, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.28, stagger: 0.09 }, 0.08)
    .fromTo(root.querySelector("[data-collab-connector]"), { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26 }, 0.35)
    .fromTo(root.querySelector("[data-collab-badge]"), { y: 7, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.24 }, 0.75);
}

function animateProof(root: HTMLElement, immediate: boolean) {
  const receipt = root.querySelector<HTMLElement>("[data-proof-receipt]");
  const link = root.querySelector<HTMLElement>("[data-proof-receipt-link]");
  const stamp = root.querySelector<HTMLElement>(".proof-receipt__stamp");
  if (immediate) {
    gsap.set(receipt, { x: 0, y: 0, autoAlpha: 1, clipPath: "inset(0 0% 0 0%)", scaleX: 1 });
    gsap.set(link, { x: 0, y: 0, autoAlpha: 1, clipPath: "inset(0 0% 0 0%)", scaleX: 1 });
    gsap.set(stamp, { x: 0, y: 0, rotation: -7, autoAlpha: 1, scale: 1 });
    return;
  }
  gsap.timeline({ defaults: { ease: "power3.out", overwrite: true } })
    .set(receipt, { autoAlpha: 0, y: -45, clipPath: "inset(0 0 100% 0)" })
    .fromTo(link, { scaleX: 0 }, { scaleX: 1, duration: 0.22 }, 0.08)
    .to(receipt, { y: 0, autoAlpha: 1, clipPath: "inset(0 0% 0 0%)", duration: 0.5 }, 0.16)
    .fromTo(root.querySelectorAll(".proof-receipt__items > div"), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.2, stagger: 0.04 }, 0.35)
    .fromTo(stamp, { y: -10, rotation: -18, scale: 0.8 }, { y: 0, rotation: -7, scale: 1, duration: 0.3 }, 0.38);
}

function animateRecords(root: HTMLElement, step: number, immediate: boolean) {
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-private-panel]"));
  Flip.killFlipsOf(panels);
  const layout = Flip.getState(panels);
  root.querySelector<HTMLElement>(".private-demo")?.setAttribute("data-private-view", step === 1 ? "shared" : "owner");
  if (!immediate) Flip.from(layout, { duration: 0.48, ease: "power3.inOut", scale: false });
}

function animateTimeline(root: HTMLElement, index: number, immediate: boolean) {
  const ratio = publicLandingTimelineRatio(index);
  const progress = root.querySelector<HTMLElement>("[data-public-timeline-progress]");
  const marker = root.querySelector<HTMLElement>("[data-public-timeline-marker]");
  gsap.to(progress, { scaleX: ratio, duration: immediate ? 0 : 0.42, ease: "power2.out", overwrite: true });
  gsap.to(marker, { left: `${ratio * 100}%`, duration: immediate ? 0 : 0.46, ease: "power3.out", overwrite: true });
  const label = root.querySelector<HTMLElement>("[data-public-timeline-label]");
  const number = root.querySelector<HTMLElement>("[data-public-timeline-number]");
  swapLabel(label, PUBLIC_LANDING_STATES[index]?.label ?? "Intro", immediate);
  swapLabel(number, String(index).padStart(2, "0"), immediate);
  root.querySelectorAll<HTMLElement>("[data-public-jump]").forEach((link) => {
    const nodeIndex = Number(link.dataset.publicJump);
    const active = nodeIndex === index;
    if (publicLandingAriaCurrent(active)) link.setAttribute("aria-current", "step");
    else link.removeAttribute("aria-current");
    link.classList.toggle("public-scene-index__node--complete", nodeIndex < index);
  });
}

function animateLandingState(root: HTMLElement, state: PublicLandingState, immediate: boolean, direction: -1 | 0 | 1, ambient?: AmbientController) {
  const stateIndex = PUBLIC_LANDING_STATES.indexOf(state);
  root.dataset.landingScene = state.scene;
  root.dataset.landingStep = String(state.step);
  root.querySelectorAll<HTMLElement>("[data-public-scene]").forEach((section) => {
    section.dataset.sceneActive = section.dataset.publicScene === state.scene ? "true" : "false";
  });
  animateTimeline(root, stateIndex, immediate);
  if (state.scene === "record-flow") animateRecordFlow(root, state.step, immediate);
  if (state.scene === "contexts") animateContexts(root, state.step, immediate, direction);
  if (state.scene === "collaboration") animateCollaboration(root, immediate);
  if (state.scene === "proof") animateProof(root, immediate);
  if (state.scene === "records") animateRecords(root, state.step, immediate);
  ambient?.(state.scene);
}

function sceneForState(root: HTMLElement, state: PublicLandingState) {
  return state.sectionId === "top"
    ? root
    : root.querySelector<HTMLElement>(`[data-public-scene="${state.scene}"]`);
}

function setupAmbientMotion(root: HTMLElement) {
  let activeScene: PublicLandingState["scene"] | null = null;
  let tweens: gsap.core.Tween[] = [];
  const kill = () => {
    tweens.forEach((tween) => tween.kill());
    tweens = [];
  };
  const activate = (scene: PublicLandingState["scene"]) => {
    activeScene = scene;
    kill();
    if (document.visibilityState === "hidden") return;
    if (scene === "hero") {
      const orbit = root.querySelector<HTMLElement>("[data-hero-orbit]");
      if (orbit) tweens.push(gsap.to(orbit, { rotation: 5, duration: 12, repeat: -1, yoyo: true, ease: "sine.inOut" }));
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") kill();
    else if (activeScene) activate(activeScene);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  return { activate, cleanup: () => { kill(); document.removeEventListener("visibilitychange", onVisibilityChange); } };
}

function createDesktopLanding(root: HTMLElement) {
  let settledIndex = 0;
  let targetIndex = 0;
  let transitionLocked = false;
  let activeScrollTween: gsap.core.Tween | null = null;
  let settleTimer: number | null = null;
  let resizeTimer: number | null = null;
  let wheelRearmTimer: number | null = null;
  let snapPoints: number[] = [];
  let observer: Observer | null = null;
  let wheelLatched = false;
  let lastWheelAt = 0;
  const wheelQuietMilliseconds = 140;
  const scrollReconcileMilliseconds = 70;
  const ambient = setupAmbientMotion(root);

  const rebuildSnapPoints = () => {
    snapPoints = PUBLIC_LANDING_STATES.map((state) => {
      if (state.sectionId === "top") return 0;
      const section = sceneForState(root, state);
      return section ? section.offsetTop + state.step * window.innerHeight : 0;
    });
  };
  const nearestIndex = () => nearestPublicLandingIndex(window.scrollY, snapPoints);
  const clearWheelRearmTimer = () => {
    if (wheelRearmTimer !== null) window.clearTimeout(wheelRearmTimer);
    wheelRearmTimer = null;
  };
  const rearmWheelIfQuiet = () => {
    wheelRearmTimer = null;
    if (!wheelLatched || transitionLocked) return;
    if (performance.now() - lastWheelAt >= wheelQuietMilliseconds) {
      wheelLatched = false;
      return;
    }
    wheelRearmTimer = window.setTimeout(rearmWheelIfQuiet, wheelQuietMilliseconds);
  };
  const noteWheelActivity = () => {
    lastWheelAt = performance.now();
    if (!wheelLatched) return;
    clearWheelRearmTimer();
    wheelRearmTimer = window.setTimeout(rearmWheelIfQuiet, wheelQuietMilliseconds);
  };
  const resetWheelLatch = () => {
    clearWheelRearmTimer();
    wheelLatched = false;
    lastWheelAt = 0;
  };
  const clearTransitionState = () => {
    activeScrollTween = null;
    transitionLocked = false;
  };
  const cancelTransition = () => {
    const tween = activeScrollTween;
    clearTransitionState();
    tween?.kill();
  };
  const settleTransition = (index: number, targetY: number, tween?: gsap.core.Tween) => {
    if (tween && activeScrollTween !== tween) return;
    clearTransitionState();
    settledIndex = index;
    targetIndex = index;
    window.scrollTo(0, targetY);
    rearmWheelIfQuiet();
  };
  const requestState = (requestedIndex: number, reason: "gesture" | "keyboard" | "anchor" | "native", immediate = false) => {
    const index = clampPublicLandingIndex(requestedIndex);
    if (transitionLocked) {
      if (reason === "gesture" || reason === "native" || (!immediate && index === targetIndex)) return false;
      cancelTransition();
    }
    rebuildSnapPoints();
    const targetY = snapPoints[index] ?? 0;
    if (!immediate && index === targetIndex && Math.abs(window.scrollY - targetY) < 2) {
      settledIndex = index;
      return false;
    }
    const previousIndex = targetIndex;
    const changed = index !== previousIndex;
    const direction = changed ? (index > previousIndex ? 1 : -1) as -1 | 1 : 0;
    targetIndex = index;
    if (reason !== "gesture") resetWheelLatch();
    animateLandingState(root, PUBLIC_LANDING_STATES[index]!, immediate || !changed, direction, ambient.activate);
    if (immediate || Math.abs(window.scrollY - targetY) < 2) {
      settleTransition(index, targetY);
      return true;
    }
    transitionLocked = true;
    const tweenRef: { current: gsap.core.Tween | null } = { current: null };
    const tween = gsap.to(window, {
      scrollTo: { y: targetY, autoKill: false },
      duration: reason === "gesture" ? 0.54 : 0.58,
      ease: "power2.out",
      overwrite: "auto",
      onComplete: () => settleTransition(index, targetY, tweenRef.current ?? undefined),
      onInterrupt: () => {
        if (activeScrollTween !== tweenRef.current) return;
        clearTransitionState();
        targetIndex = settledIndex;
        animateLandingState(root, PUBLIC_LANDING_STATES[settledIndex]!, true, 0, ambient.activate);
        scheduleNativeReconciliation();
        rearmWheelIfQuiet();
      },
    });
    tweenRef.current = tween;
    activeScrollTween = tween;
    return true;
  };
  const scheduleNativeReconciliation = () => {
    if (transitionLocked) return;
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      if (transitionLocked) return;
      rebuildSnapPoints();
      requestState(nearestIndex(), "native");
    }, scrollReconcileMilliseconds);
  };
  const handleWheelStep = (direction: -1 | 1) => {
    const step = publicLandingStep(settledIndex, direction);
    if (!step.changed) return;
    if (transitionLocked || wheelLatched) {
      noteWheelActivity();
      return;
    }
    wheelLatched = true;
    noteWheelActivity();
    requestState(step.nextIndex, "gesture");
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
      requestState(0, "keyboard");
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      requestState(PUBLIC_LANDING_STATES.length - 1, "keyboard");
      return;
    }
    if (direction !== 0) {
      event.preventDefault();
      requestState(nextPublicLandingIndex(settledIndex, direction as -1 | 1), "keyboard");
    }
  };
  const onScroll = () => {
    scheduleNativeReconciliation();
  };
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof Element && root.contains(event.target)) {
      scheduleNativeReconciliation();
    }
  };
  const onJump = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("[data-public-jump]") : null;
    if (!link) return;
    const index = Number(link.dataset.publicJump);
    if (!Number.isInteger(index)) return;
    event.preventDefault();
    requestState(index, "anchor");
  };
  const onAnchor = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
    if (!link || link.dataset.publicJump) return;
    const id = link.getAttribute("href")?.slice(1);
    if (!id) return;
    const index = firstPublicLandingIndexForSection(id);
    if (index < 0) return;
    event.preventDefault();
    requestState(index, "anchor");
  };
  const onResize = () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      cancelTransition();
      ScrollTrigger.refresh();
      rebuildSnapPoints();
      requestState(nearestIndex(), "native", true);
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
  const initialIndex = nearestIndex();
  settledIndex = initialIndex;
  targetIndex = initialIndex;
  animateLandingState(root, PUBLIC_LANDING_STATES[initialIndex]!, true, 0, ambient.activate);

  observer = Observer.create({
    id: "public-landing-stepper",
    target: window,
    type: "wheel",
    tolerance: 5,
    debounce: false,
    wheelSpeed: 1,
    preventDefault: true,
    onWheel: noteWheelActivity,
    onDown: () => handleWheelStep(1),
    onUp: () => handleWheelStep(-1),
    onDisable: resetWheelLatch,
  });

  return () => {
    observer?.kill();
    observer = null;
    cancelTransition();
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resetWheelLatch();
    root.removeEventListener("click", onJump);
    root.removeEventListener("click", onAnchor);
    root.removeEventListener("focusin", onFocusIn);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    root.querySelectorAll<SceneElement>("[data-public-scene]").forEach((section) => section._publicTrigger?.kill());
    ambient.cleanup();
  };
}

function setupMobileLanding(root: HTMLElement) {
  const triggers: ScrollTrigger[] = [];
  root.querySelectorAll<HTMLElement>("[data-public-scene]").forEach((section) => {
    const states = PUBLIC_LANDING_STATES.filter((state) => state.scene === section.dataset.publicScene);
    let previousStep = -1;
    const illustration = section.querySelector<HTMLElement>(".flow-interface, .scope-viewport, .collaboration-demo, .proof-record, .record-lifecycle") ?? section;
    triggers.push(ScrollTrigger.create({
      trigger: illustration,
      start: "top 85%",
      end: "top 15%",
      onUpdate: (trigger) => {
        if (!trigger.isActive) return;
        const step = Math.min(states.length - 1, Math.floor(trigger.progress * states.length));
        const state = states[step];
        if (!state || step === previousStep) return;
        const direction = step > previousStep ? 1 : -1;
        previousStep = step;
        animateLandingState(root, state, false, direction);
      },
    }));
  });
  return () => triggers.forEach((trigger) => trigger.kill());
}

function setupReducedLanding(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".scope-state").forEach((state) => {
    state.removeAttribute("aria-hidden");
    state.inert = false;
    state.style.pointerEvents = "auto";
  });
  const update = () => {
    const section = Array.from(root.querySelectorAll<HTMLElement>("[data-public-scene]")).reverse().find((candidate) => candidate.getBoundingClientRect().top <= window.innerHeight * 0.42);
    const index = section ? Math.max(0, firstPublicLandingIndexForSection(section.id || section.dataset.publicScene || "")) : 0;
    animateTimeline(root, index, true);
  };
  window.addEventListener("scroll", update, { passive: true });
  update();
  return () => window.removeEventListener("scroll", update);
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
      media.add("(prefers-reduced-motion: reduce)", () => setupReducedLanding(target));
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
      Flip.killFlipsOf(target.querySelectorAll(".flow-card, .flow-balance, [data-private-panel]"));
      media?.revert();
      context.revert();
      gsap.killTweensOf(window, "scrollTo");
      delete target.dataset.motionReady;
    };
  }, []);

  return (
    <div className="public-home" id="top" ref={root}>
      <nav className="public-scene-index" aria-label="Landing sequence">
        <div className="public-scene-index__label" aria-live="polite"><span data-public-timeline-number>00</span><span aria-hidden="true"> / </span><span data-public-timeline-label>Intro</span></div>
        <div className="public-scene-index__track" aria-hidden="true"><span data-public-timeline-progress /><i data-public-timeline-marker /></div>
        <div className="public-scene-index__nodes">
          {PUBLIC_LANDING_STATES.map((state, index) => (
            <a
              aria-current={publicLandingAriaCurrent(index === 0)}
              aria-label={`${String(index).padStart(2, "0")} ${state.label}`}
              data-public-jump={index}
              data-public-timeline-node
              href={`#${state.sectionId}`}
              key={`${state.scene}-${state.step}`}
              style={{ left: `${publicLandingTimelineRatio(index) * 100}%` }}
            >
              <span>{String(index).padStart(2, "0")}</span>
            </a>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
