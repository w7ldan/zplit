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
  firstPublicMobileSectionIndexForSection,
  firstPublicLandingIndexForSection,
  nearestPublicLandingIndex,
  nextPublicLandingIndex,
  PUBLIC_MOBILE_SECTIONS,
  PUBLIC_LANDING_STATES,
  PUBLIC_RECORD_FLOW_STATES,
  PUBLIC_RECORD_LIFECYCLE_STATES,
  PUBLIC_SCOPE_STATES,
  publicLandingAriaCurrent,
  publicLandingStep,
  publicLandingTimelineRatio,
  publicRecordLifecycleState,
  type PublicLandingState,
} from "./public-motion-state";

type PublicMotionProps = { children: ReactNode };
type SceneElement = HTMLElement & { _publicTrigger?: ScrollTrigger };
type AmbientController = (scene: PublicLandingState["scene"]) => void;
type PublicNumberElement = HTMLElement & { _publicNumberTween?: gsap.core.Tween };

const MOBILE_LANDING_MEDIA_QUERY = "(max-width: 767px), (orientation: landscape) and (max-width: 900px) and (max-height: 500px)";
const DESKTOP_LANDING_MEDIA_QUERY = [
  "(min-width: 768px) and (orientation: portrait)",
  "(min-width: 901px)",
  "(min-width: 768px) and (orientation: landscape) and (min-height: 501px)",
].join(", ");
const NO_PREFERENCE = "(prefers-reduced-motion: no-preference)";

function isMobileLandingViewport() {
  return window.matchMedia(MOBILE_LANDING_MEDIA_QUERY).matches;
}

export function publicLandingScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

const FLOW_VALUES = [
  { label: "CAPTURED", expense: 360_000, assigned: 0, repayment: 0, balance: 0 },
  { label: "SHARES ASSIGNED", expense: 360_000, assigned: 210_000, repayment: 0, balance: 0 },
  { label: "REPAYMENT LOGGED", expense: 360_000, assigned: 210_000, repayment: 120_000, balance: 0 },
  { label: "BALANCE OPEN", expense: 360_000, assigned: 210_000, repayment: 120_000, balance: 90_000 },
] as const;

const ODOMETER_NAMES = new Set([
  "hero-expense",
  "hero-repayment",
  "hero-balance",
  "flow-expense",
  "flow-assigned",
  "flow-repayment",
  "flow-balance",
  "proof-expense",
  "private-owner-balance",
  "private-shared-balance",
  "private-shared-line",
]);

function setupMagneticLinks(root: HTMLElement) {
  if (isMobileLandingViewport() || !(window.matchMedia?.("(pointer: fine)").matches ?? false)) return () => {};
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
  if (isMobileLandingViewport() || !(window.matchMedia?.("(pointer: fine)").matches ?? false)) return () => {};
  const fields: Array<[HTMLElement | null, number, number]> = [
    [root.querySelector<HTMLElement>(".public-hero__wash"), 0.5, 0.35],
    [root.querySelector<HTMLElement>(".hero-product-record"), 0.35, 0.25],
    [root.querySelector<HTMLElement>(".collaboration-demo"), 0.38, 0.3],
  ];
  const setters = fields
    .filter((field): field is [HTMLElement, number, number] => Boolean(field[0]))
    .map(([element, xFactor, yFactor]) => ({
      element,
      x: gsap.quickTo(element, "x", { duration: 0.5, ease: "power3.out" }),
      y: gsap.quickTo(element, "y", { duration: 0.5, ease: "power3.out" }),
      xFactor,
      yFactor,
    }));
  const onMove = (event: PointerEvent) => {
    const x = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
    const y = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    setters.forEach(({ x: moveX, y: moveY, xFactor, yFactor }) => {
      moveX(x * xFactor * 16);
      moveY(y * yFactor * 16);
    });
  };
  const onLeave = () => {
    setters.forEach(({ x: moveX, y: moveY }) => {
      moveX(0);
      moveY(0);
    });
  };
  root.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerleave", onLeave, { passive: true });
  return () => {
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerleave", onLeave);
    setters.forEach(({ element }) => gsap.killTweensOf(element, "x,y"));
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
  return root.querySelector<PublicNumberElement>(`[data-public-number="${name}"]`);
}

function odometerDigits(element: HTMLElement) {
  return Array.from(element.querySelectorAll<HTMLElement>(".public-odometer__reel"));
}

function buildOdometer(element: HTMLElement, formatted: string) {
  const visual = document.createElement("span");
  visual.className = "public-odometer";
  visual.setAttribute("aria-hidden", "true");
  for (const character of formatted) {
    if (/\d/.test(character)) {
      const slot = document.createElement("span");
      slot.className = "public-odometer__slot";
      const reel = document.createElement("span");
      reel.className = "public-odometer__reel";
      for (let digit = 0; digit < 10; digit += 1) {
        const face = document.createElement("span");
        face.textContent = String(digit);
        reel.append(face);
      }
      slot.append(reel);
      visual.append(slot);
    } else {
      const staticCharacter = document.createElement("span");
      staticCharacter.className = "public-odometer__static";
      staticCharacter.textContent = character;
      visual.append(staticCharacter);
    }
  }
  const accessible = document.createElement("span");
  accessible.className = "public-odometer__accessible";
  accessible.textContent = formatted;
  element.replaceChildren(visual, accessible);
  element.dataset.publicFormatted = formatted;
}

function setOdometerDigits(element: HTMLElement, formatted: string, immediate: boolean) {
  if (!element.querySelector(".public-odometer") || element.dataset.publicFormatted?.length !== formatted.length) {
    buildOdometer(element, formatted);
  }
  element.dataset.publicFormatted = formatted;
  const accessible = element.querySelector<HTMLElement>(".public-odometer__accessible");
  if (accessible) accessible.textContent = formatted;
  const reels = odometerDigits(element);
  let digitIndex = 0;
  for (const character of formatted) {
    if (!/\d/.test(character)) continue;
    const reel = reels[digitIndex];
    const destination = -Number(character) * 10;
    if (reel) {
      if (immediate) gsap.set(reel, { yPercent: destination });
      else gsap.to(reel, { yPercent: destination, duration: 0.48, ease: "power2.out", overwrite: true });
    }
    digitIndex += 1;
  }
}

function setPublicNumber(element: HTMLElement | null, amount: number, immediate = true) {
  if (!element) return;
  const name = element.dataset.publicNumber;
  const formatted = formatRupiah(amount);
  element.dataset.publicValue = String(amount);
  element.setAttribute("aria-label", formatted);
  if (name && ODOMETER_NAMES.has(name)) {
    setOdometerDigits(element, formatted, immediate);
    return;
  }
  element.textContent = formatted;
}

function stopPublicNumberTween(element: PublicNumberElement) {
  element._publicNumberTween?.kill();
  delete element._publicNumberTween;
}

function cleanupPublicNumbers(root: HTMLElement) {
  root.querySelectorAll<PublicNumberElement>("[data-public-number]").forEach(stopPublicNumberTween);
  gsap.killTweensOf(root.querySelectorAll(".public-odometer__reel"));
}

function clearPublicNumber(element: PublicNumberElement | null, amount: number) {
  if (!element) return;
  stopPublicNumberTween(element);
  gsap.killTweensOf(element.querySelectorAll(".public-odometer__reel"));
  element.replaceChildren();
  element.dataset.publicValue = String(amount);
  delete element.dataset.publicFormatted;
  element.removeAttribute("aria-label");
}

function rollPublicNumber(element: PublicNumberElement | null, amount: number, duration: number, immediate: boolean) {
  if (!element) return;
  stopPublicNumberTween(element);
  const current = Number(element.dataset.publicValue ?? 0);
  if (immediate || current === amount) {
    setPublicNumber(element, amount, true);
    return;
  }
  if (element.dataset.publicNumber && ODOMETER_NAMES.has(element.dataset.publicNumber)) {
    if (!element.querySelector(".public-odometer")) buildOdometer(element, formatRupiah(current));
    setOdometerDigits(element, formatRupiah(amount), false);
    element.dataset.publicValue = String(amount);
    element.setAttribute("aria-label", formatRupiah(amount));
    return;
  }
  const proxy = { value: current };
  let tween: gsap.core.Tween | null = null;
  tween = gsap.to(proxy, {
    value: amount,
    duration,
    ease: "power2.out",
    onUpdate: () => {
      if (element._publicNumberTween === tween) setPublicNumber(element, Math.round(proxy.value));
    },
    onComplete: () => {
      if (element._publicNumberTween !== tween) return;
      setPublicNumber(element, amount);
      delete element._publicNumberTween;
    },
  });
  element._publicNumberTween = tween;
}

function swapLabel(element: HTMLElement | null, label: string, immediate: boolean) {
  if (!element || element.textContent === label) return;
  if (immediate) {
    element.textContent = label;
    return;
  }
  gsap.killTweensOf(element);
  gsap.timeline()
    .to(element, { yPercent: -80, opacity: 0, duration: 0.12, ease: "power3.out" })
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

function updateFlowCards(root: HTMLElement, cards: HTMLElement[], flow: HTMLElement | null, step: number) {
  flow?.setAttribute("data-flow-active-step", String(step));
  cards.forEach((card, index) => {
    card.setAttribute("data-expanded", String(index === step));
    card.dataset.flowRole = index < step ? "past" : index === step ? "present" : "future";
  });
  root.querySelectorAll(".flow-steps li").forEach((item, index) => {
    if (index === step) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
}

function updateFlowNumbers(root: HTMLElement, step: number, immediate: boolean, values: typeof FLOW_VALUES[number]) {
  const numbers = [
    ["flow-expense", values.expense, true],
    ["flow-assigned", values.assigned, step >= 1],
    ["flow-repayment", values.repayment, step >= 2],
    ["flow-balance", values.balance, step >= 3],
    ["flow-share-raka", step >= 1 ? 120_000 : 0, step >= 1],
    ["flow-share-sari", step >= 1 ? 90_000 : 0, step >= 1],
  ] as const;
  numbers.forEach(([name, amount, visible]) => {
    if (visible) rollPublicNumber(publicNumber(root, name), amount, 0.54, immediate);
    else clearPublicNumber(publicNumber(root, name), amount);
  });
}

function updateFlowSummaries(root: HTMLElement, cards: HTMLElement[], step: number) {
  const summaries = [
    "Source amount recorded",
    step < 1 ? "2 people · waiting" : "Rp210.000 assigned",
    step < 2 ? "Not recorded" : "Rp120.000 recorded",
    step < 1 ? "Pending shares" : step < 2 ? "Pending repayment" : step < 3 ? "Open share" : "Rp90.000 remains open",
  ];
  cards.forEach((card, index) => {
    const summary = card.querySelector<HTMLElement>("[data-flow-summary]");
    if (summary) summary.textContent = summaries[index] ?? "";
  });
  const resolved = root.querySelector<HTMLElement>("[data-flow-resolved]");
  if (resolved) resolved.textContent = step >= 2 ? "Raka settled; Sari remains open." : "";
}

function animateRecordFlow(root: HTMLElement, step: number, immediate: boolean) {
  const cards = flowCards(root);
  Flip.killFlipsOf(cards);
  const layout = Flip.getState(cards);
  const flow = root.querySelector<HTMLElement>(".flow-interface");
  const previousStep = Number(flow?.dataset.flowActiveStep ?? step);
  const direction = step === previousStep ? 0 : step > previousStep ? 1 : -1;
  const values = FLOW_VALUES[step] ?? FLOW_VALUES[0];
  updateFlowCards(root, cards, flow, step);
  swapLabel(root.querySelector<HTMLElement>("[data-flow-state-label]"), values.label, immediate);
  updateFlowNumbers(root, step, immediate, values);
  updateFlowSummaries(root, cards, step);
  root.querySelectorAll<HTMLElement>("[data-flow-share-row]").forEach((row) => row.setAttribute("aria-hidden", String(step !== 1)));
  const revealFrom = direction < 0 ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
  gsap.fromTo(cards[step]?.querySelectorAll("[data-public-number]") ?? [],
    { y: direction < 0 ? -10 : 10, clipPath: revealFrom },
    { y: 0, clipPath: "inset(0 0 0% 0)", duration: immediate ? 0 : 0.4, delay: immediate ? 0 : 0.12, ease: "power3.out", stagger: immediate ? 0 : 0.04, overwrite: true });
  if (!immediate) Flip.from(layout, { duration: 0.56, ease: "power3.inOut", absolute: false, nested: true, scale: false, overwrite: true });
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
  swapLabel(root.querySelector<HTMLElement>("[data-scope-active-label]"), PUBLIC_SCOPE_STATES[step]?.toUpperCase() ?? "PERSONAL", immediate);
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
    .fromTo(root.querySelector("[data-collab-connector]"), { y: 4, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.26 }, 0.35)
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
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-lifecycle-panel]"));
  Flip.killFlipsOf(panels);
  const layout = Flip.getState(panels);
  const state = publicRecordLifecycleState(step);
  root.querySelector<HTMLElement>(".record-lifecycle")?.setAttribute("data-lifecycle-state", state);
  root.querySelector<HTMLElement>(".private-demo")?.setAttribute("data-private-view", state);
  panels.forEach((panel) => {
    const active = panel.dataset.lifecyclePanel === state;
    panel.dataset.lifecycleActive = String(active);
    panel.setAttribute("aria-hidden", String(!active));
    panel.inert = !active;
  });
  root.querySelectorAll<HTMLElement>("[data-lifecycle-node]").forEach((node) => node.classList.toggle("is-active", node.dataset.lifecycleNode === state));
  if (!immediate) Flip.from(layout, { duration: 0.54, ease: "power3.inOut", scale: false, nested: true, overwrite: true });
}

function animateHero(root: HTMLElement, immediate: boolean) {
  const bridge = root.querySelector<HTMLElement>("[data-hero-bridge]");
  if (!bridge) return;
  if (immediate) {
    gsap.set(bridge, { x: 0, autoAlpha: 1 });
    return;
  }
  gsap.fromTo(bridge, { x: -4, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.22, ease: "power3.out", overwrite: true });
}

function animateTimeline(root: HTMLElement, index: number, immediate: boolean) {
  const ratio = publicLandingTimelineRatio(index);
  const progress = root.querySelector<HTMLElement>("[data-public-timeline-progress]");
  const marker = root.querySelector<HTMLElement>("[data-public-timeline-marker]");
  if (progress) gsap.to(progress, { scaleX: ratio, duration: immediate ? 0 : 0.42, ease: "power2.out", overwrite: true });
  if (marker) {
    const trackWidth = progress?.parentElement?.getBoundingClientRect().width ?? 0;
    gsap.to(marker, { x: trackWidth * ratio, duration: immediate ? 0 : 0.46, ease: "power3.out", overwrite: true });
  }
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

function animateMobileTimeline(root: HTMLElement, index: number, immediate: boolean) {
  const ratio = publicLandingTimelineRatio(index, PUBLIC_MOBILE_SECTIONS.length);
  const progress = root.querySelector<HTMLElement>("[data-public-timeline-progress]");
  const marker = root.querySelector<HTMLElement>("[data-public-timeline-marker]");
  if (progress) gsap.to(progress, { scaleX: ratio, duration: immediate ? 0 : 0.42, ease: "power2.out", overwrite: true });
  if (marker) {
    const trackWidth = progress?.parentElement?.getBoundingClientRect().width ?? 0;
    gsap.to(marker, { x: trackWidth * ratio, duration: immediate ? 0 : 0.46, ease: "power3.out", overwrite: true });
  }
  const section = PUBLIC_MOBILE_SECTIONS[index] ?? PUBLIC_MOBILE_SECTIONS[0]!;
  swapLabel(root.querySelector<HTMLElement>("[data-public-timeline-label]"), section.label, immediate);
  swapLabel(root.querySelector<HTMLElement>("[data-public-timeline-number]"), String(index).padStart(2, "0"), immediate);
  root.querySelectorAll<HTMLElement>("[data-mobile-public-jump]").forEach((link) => {
    const nodeIndex = Number(link.dataset.mobilePublicJump);
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
  if (state.scene === "hero") animateHero(root, immediate);
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

function setupAmbientMotion(root: HTMLElement, enabled = true) {
  if (!enabled) return { activate: () => {}, cleanup: () => {} };
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
      if ((reason === "gesture" && index === targetIndex) || reason === "native" || (!immediate && index === targetIndex)) return false;
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
    if (transitionLocked) {
      const movingDirection = Math.sign(targetIndex - settledIndex);
      if (movingDirection !== direction) {
        noteWheelActivity();
        requestState(settledIndex, "gesture");
      } else noteWheelActivity();
      return;
    }
    const step = publicLandingStep(settledIndex, direction);
    if (!step.changed) return;
    if (wheelLatched) {
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
      requestState(0, "keyboard", true);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      requestState(PUBLIC_LANDING_STATES.length - 1, "keyboard", true);
      return;
    }
    if (direction !== 0) {
      event.preventDefault();
      requestState(nextPublicLandingIndex(settledIndex, direction as -1 | 1), "keyboard", true);
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
    cleanupPublicNumbers(root);
    ambient.cleanup();
  };
}

function setupMobileLanding(root: HTMLElement, immediate = false, enableAmbient = true) {
  const sections = PUBLIC_MOBILE_SECTIONS.map((section) => root.querySelector<HTMLElement>(`[data-public-scene="${section.scene}"]`)).filter((section): section is HTMLElement => Boolean(section));
  let activeIndex = -1;
  let frame: number | null = null;
  const recordStep = Number(root.querySelector<HTMLElement>(".flow-interface")?.dataset.flowActiveStep);
  const scopeStep = Number(root.dataset.scopeStep);
  const lifecycleState = root.querySelector<HTMLElement>(".record-lifecycle")?.dataset.lifecycleState;
  let recordMobileState = PUBLIC_RECORD_FLOW_STATES[recordStep] ?? PUBLIC_RECORD_FLOW_STATES[0]!;
  let scopeMobileState = PUBLIC_SCOPE_STATES[scopeStep] ?? PUBLIC_SCOPE_STATES[0]!;
  let recordsMobileState = PUBLIC_RECORD_LIFECYCLE_STATES.find((state) => state === lifecycleState) ?? PUBLIC_RECORD_LIFECYCLE_STATES[0]!;
  const ambient = setupAmbientMotion(root, enableAmbient);

  const setLocalControlState = (group: string, state: string) => {
    root.querySelectorAll<HTMLButtonElement>(`[data-mobile-local="${group}"]`).forEach((button) => {
      const active = button.dataset.mobileLocalState === state;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    });
  };

  const sectionAtViewportAnchor = () => {
    const anchor = window.innerHeight * 0.42;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    sections.forEach((section, index) => {
      const bounds = section.getBoundingClientRect();
      const nextDistance = bounds.top <= anchor && bounds.bottom >= anchor
        ? 0
        : Math.min(Math.abs(bounds.top - anchor), Math.abs(bounds.bottom - anchor));
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = index;
      }
    });
    return nearest;
  };

  const syncSection = (requestedIndex: number, syncImmediately: boolean) => {
    const nextIndex = Math.min(Math.max(requestedIndex, 0), PUBLIC_MOBILE_SECTIONS.length - 1);
    if (!sections[nextIndex]) return;
    if (!syncImmediately && nextIndex === activeIndex) return;
    activeIndex = nextIndex;
    const section = PUBLIC_MOBILE_SECTIONS[nextIndex]!;
    root.dataset.landingScene = section.scene;
    root.dataset.landingStep = "0";
    sections.forEach((candidate, index) => { candidate.dataset.sceneActive = index === nextIndex ? "true" : "false"; });
    animateMobileTimeline(root, nextIndex, syncImmediately);
    if (section.scene === "hero") {
      ambient.activate("hero");
      animateHero(root, syncImmediately);
    }
    if (section.scene === "collaboration") animateCollaboration(root, syncImmediately);
    if (section.scene === "proof") animateProof(root, syncImmediately);
  };

  const syncFromScroll = (syncImmediately = false) => syncSection(sectionAtViewportAnchor(), syncImmediately);
  const scheduleSync = (syncImmediately = false) => {
    if (syncImmediately) {
      syncFromScroll(true);
      return;
    }
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      syncFromScroll();
    });
  };
  const scrollToSection = (sectionId: string) => {
    const target = sectionId === "top" ? root : root.querySelector<HTMLElement>(`[data-public-scene="${sectionId}"]`);
    if (!target) return;
    window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY), behavior: publicLandingScrollBehavior(immediate) });
  };

  const setRecordState = (state: string) => {
    const index = PUBLIC_RECORD_FLOW_STATES.findIndex((candidate) => candidate === state);
    if (index < 0) return;
    const previousIndex = PUBLIC_RECORD_FLOW_STATES.indexOf(recordMobileState);
    recordMobileState = PUBLIC_RECORD_FLOW_STATES[index]!;
    setLocalControlState("record", recordMobileState);
    animateRecordFlow(root, index, immediate);
    if (previousIndex !== index) root.dataset.landingStep = String(index);
  };
  const setScopeState = (state: string) => {
    const index = PUBLIC_SCOPE_STATES.findIndex((candidate) => candidate === state);
    if (index < 0) return;
    const previousIndex = PUBLIC_SCOPE_STATES.indexOf(scopeMobileState);
    scopeMobileState = PUBLIC_SCOPE_STATES[index]!;
    setLocalControlState("scope", scopeMobileState);
    animateContexts(root, index, immediate, index === previousIndex ? 0 : index > previousIndex ? 1 : -1);
  };
  const setRecordsState = (state: string) => {
    const index = PUBLIC_RECORD_LIFECYCLE_STATES.findIndex((candidate) => candidate === state);
    if (index < 0) return;
    recordsMobileState = PUBLIC_RECORD_LIFECYCLE_STATES[index]!;
    setLocalControlState("records", recordsMobileState);
    animateRecords(root, index, immediate);
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const localControl = target?.closest<HTMLButtonElement>("[data-mobile-local]");
    if (localControl) {
      event.preventDefault();
      const group = localControl.dataset.mobileLocal;
      const state = localControl.dataset.mobileLocalState;
      if (group === "record" && state) setRecordState(state);
      if (group === "scope" && state) setScopeState(state);
      if (group === "records" && state) setRecordsState(state);
      return;
    }
    const jump = target?.closest<HTMLAnchorElement>("[data-mobile-public-jump]");
    if (jump) {
      const index = Number(jump.dataset.mobilePublicJump);
      const section = PUBLIC_MOBILE_SECTIONS[index];
      if (!section) return;
      event.preventDefault();
      scrollToSection(section.sectionId);
      return;
    }
    const anchor = target?.closest<HTMLAnchorElement>("a[href^='#']");
    if (!anchor || anchor.dataset.mobilePublicJump) return;
    const sectionId = anchor.getAttribute("href")?.slice(1);
    if (!sectionId || firstPublicMobileSectionIndexForSection(sectionId) < 0) return;
    event.preventDefault();
    scrollToSection(sectionId);
  };
  const onScroll = () => scheduleSync();
  const onResize = () => scheduleSync(true);

  animateRecordFlow(root, PUBLIC_RECORD_FLOW_STATES.indexOf(recordMobileState), true);
  animateContexts(root, PUBLIC_SCOPE_STATES.indexOf(scopeMobileState), true, 0);
  animateRecords(root, PUBLIC_RECORD_LIFECYCLE_STATES.indexOf(recordsMobileState), true);
  setLocalControlState("record", recordMobileState);
  setLocalControlState("scope", scopeMobileState);
  setLocalControlState("records", recordsMobileState);
  root.addEventListener("click", onClick);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", onResize, { passive: true });
  syncFromScroll(true);
  return () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    root.removeEventListener("click", onClick);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    root.querySelectorAll<HTMLElement>("*").forEach((element) => gsap.killTweensOf(element));
    cleanupPublicNumbers(root);
    ambient.cleanup();
  };
}

function setupReducedLanding(root: HTMLElement) {
  if (isMobileLandingViewport()) return setupMobileLanding(root, true, false);
  animateHero(root, true);
  root.querySelectorAll<HTMLElement>(".scope-state").forEach((state) => {
    state.removeAttribute("aria-hidden");
    state.inert = false;
    state.style.pointerEvents = "auto";
  });
  const targetForState = (index: number) => {
    const state = PUBLIC_LANDING_STATES[index] ?? PUBLIC_LANDING_STATES[0]!;
    if (state.sectionId === "top") return root;
    const section = root.querySelector<HTMLElement>(`[data-public-scene="${state.scene}"]`);
    if (!section) return null;
    if (state.scene === "record-flow") {
      return [
        section.querySelector<HTMLElement>("[data-flow-expense]"),
        section.querySelector<HTMLElement>("[data-flow-shares]"),
        section.querySelector<HTMLElement>("[data-flow-repayment]"),
        section.querySelector<HTMLElement>("[data-flow-balance]"),
      ][state.step] ?? section;
    }
    if (state.scene === "contexts") {
      return [
        section.querySelector<HTMLElement>("[data-scope-personal]"),
        section.querySelector<HTMLElement>("[data-scope-group]"),
        section.querySelector<HTMLElement>("[data-scope-organization]"),
      ][state.step] ?? section;
    }
    if (state.scene === "records") {
      const lifecycleState = publicRecordLifecycleState(state.step);
      return section.querySelector<HTMLElement>(`[data-lifecycle-panel="${lifecycleState}"]`) ?? section;
    }
    return section;
  };
  const statePositions = () => {
    const headerHeight = root.querySelector<HTMLElement>(".header-shell")?.getBoundingClientRect().height ?? 0;
    return PUBLIC_LANDING_STATES.map((_, index) => {
      const target = targetForState(index);
      return Math.max(0, (target?.getBoundingClientRect().top ?? 0) + window.scrollY - headerHeight);
    });
  };
  let activeIndex = 0;
  const update = () => {
    const index = nearestPublicLandingIndex(window.scrollY, statePositions());
    const state = PUBLIC_LANDING_STATES[index] ?? PUBLIC_LANDING_STATES[0]!;
    if (index !== activeIndex) {
      activeIndex = index;
      root.dataset.landingScene = state.scene;
      root.dataset.landingStep = String(state.step);
      animateTimeline(root, index, true);
      if (state.scene === "hero") animateHero(root, true);
      if (state.scene === "record-flow") animateRecordFlow(root, state.step, true);
      if (state.scene === "records") animateRecords(root, state.step, true);
    } else {
      animateTimeline(root, index, true);
      if (state.scene === "hero") animateHero(root, true);
    }
  };
  const onJump = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("[data-public-jump]") : null;
    if (!link) return;
    const index = Number(link.dataset.publicJump);
    if (!Number.isInteger(index)) return;
    event.preventDefault();
    const target = statePositions()[index];
    if (target !== undefined) window.scrollTo({ top: target, behavior: "auto" });
  };
  const onAnchor = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
    if (!link || link.dataset.publicJump) return;
    const id = link.getAttribute("href")?.slice(1);
    const index = id ? firstPublicLandingIndexForSection(id) : -1;
    if (index < 0) return;
    event.preventDefault();
    const target = statePositions()[index];
    if (target !== undefined) window.scrollTo({ top: target, behavior: "auto" });
  };
  root.addEventListener("click", onJump);
  root.addEventListener("click", onAnchor);
  window.addEventListener("scroll", update, { passive: true });
  update();
  return () => {
    root.removeEventListener("click", onJump);
    root.removeEventListener("click", onAnchor);
    window.removeEventListener("scroll", update);
  };
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
      media.add(DESKTOP_LANDING_MEDIA_QUERY.split(", ").map((query) => `${query} and ${NO_PREFERENCE}`).join(", "), () => createDesktopLanding(target));
      media.add(MOBILE_LANDING_MEDIA_QUERY.split(", ").map((query) => `${query} and ${NO_PREFERENCE}`).join(", "), () => setupMobileLanding(target));
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
      Flip.killFlipsOf(target.querySelectorAll(".flow-card, .flow-balance, [data-lifecycle-panel]"));
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
        <div className="public-scene-index__nodes" data-public-timeline-desktop>
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
        <div className="public-scene-index__nodes" data-public-timeline-mobile>
          {PUBLIC_MOBILE_SECTIONS.map((section, index) => (
            <a
              aria-current={publicLandingAriaCurrent(index === 0)}
              aria-label={`${String(index).padStart(2, "0")} ${section.label}`}
              data-mobile-public-jump={index}
              data-mobile-timeline-node
              href={`#${section.sectionId}`}
              key={section.scene}
              style={{ left: `${publicLandingTimelineRatio(index, PUBLIC_MOBILE_SECTIONS.length) * 100}%` }}
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
