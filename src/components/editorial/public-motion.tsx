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
type AmbientController = (scene: PublicLandingState["scene"]) => void;

const FLOW_VALUES = [
  { label: "CAPTURED", expense: 360_000, assigned: 0, repayment: 0, balance: 360_000 },
  { label: "SHARES ASSIGNED", expense: 360_000, assigned: 210_000, repayment: 0, balance: 210_000 },
  { label: "REPAYMENT LOGGED", expense: 360_000, assigned: 210_000, repayment: 120_000, balance: 90_000 },
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
  "history-market",
  "history-train",
]);

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

function publicNumber(root: HTMLElement, name: string) {
  return root.querySelector<HTMLElement>(`[data-public-number="${name}"]`);
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
    immediate = true;
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

function setPublicNumber(element: HTMLElement | null, amount: number) {
  if (!element) return;
  const name = element.dataset.publicNumber;
  const formatted = formatRupiah(amount);
  element.dataset.publicValue = String(amount);
  element.setAttribute("aria-label", formatted);
  if (name && ODOMETER_NAMES.has(name)) {
    setOdometerDigits(element, formatted, true);
    return;
  }
  element.textContent = formatted;
}

function rollPublicNumber(element: HTMLElement | null, amount: number, duration: number, immediate: boolean) {
  if (!element) return;
  const current = Number(element.dataset.publicValue ?? 0);
  if (immediate || current === amount) {
    setPublicNumber(element, amount);
    return;
  }
  if (element.dataset.publicNumber && ODOMETER_NAMES.has(element.dataset.publicNumber)) {
    const currentFormatted = formatRupiah(current);
    if (!element.querySelector(".public-odometer")) buildOdometer(element, currentFormatted);
    setOdometerDigits(element, formatRupiah(amount), false);
    element.dataset.publicValue = String(amount);
    element.setAttribute("aria-label", formatRupiah(amount));
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
    .to(element, { yPercent: -80, opacity: 0, duration: 0.12, ease: "power2.in" })
    .add(() => { element.textContent = label; })
    .fromTo(element, { yPercent: 80 }, { yPercent: 0, opacity: 1, duration: 0.22, ease: "power3.out" });
}

function animateFlowNumbers(root: HTMLElement, values: typeof FLOW_VALUES[number], step: number, immediate: boolean) {
  const numbers = [
    ["flow-expense", values.expense],
    ["flow-assigned", values.assigned],
    ["flow-repayment", values.repayment],
    ["flow-balance", values.balance],
    ["flow-share-raka", step >= 1 ? 120_000 : 0],
    ["flow-share-sari", step >= 1 ? 90_000 : 0],
  ] as const;
  numbers.forEach(([name, amount]) => rollPublicNumber(publicNumber(root, name), amount, 0.54, immediate));
}

function flowCards(root: HTMLElement) {
  return [
    root.querySelector<HTMLElement>("[data-flow-expense]"),
    root.querySelector<HTMLElement>("[data-flow-shares]"),
    root.querySelector<HTMLElement>("[data-flow-repayment]"),
    root.querySelector<HTMLElement>("[data-flow-balance]"),
  ].filter((card): card is HTMLElement => Boolean(card));
}

function animateFlowCards(timeline: gsap.core.Timeline, cards: HTMLElement[], step: number, previousStep: number, direction: -1 | 0 | 1, immediate: boolean) {
  cards.forEach((card, index) => {
    const active = index === step;
    timeline.to(card, {
      y: active ? 0 : index < step ? -5 : 7,
      scale: active ? 1 : 0.985,
      autoAlpha: active ? 1 : index < step ? 0.58 : 0.28,
      duration: immediate ? 0 : 0.46,
    }, 0);
  });
  if (!immediate && step !== previousStep) {
    const incoming = cards[step];
    if (incoming) {
      timeline.fromTo(incoming, {
        x: direction > 0 ? 30 : -30,
        clipPath: direction > 0 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)",
      }, { x: 0, clipPath: "inset(0 0% 0 0%)", duration: 0.42 }, 0);
    }
  }
}

function animateFlowRows(timeline: gsap.core.Timeline, rows: HTMLElement[], step: number, previousStep: number, immediate: boolean) {
  if (step >= 1 && previousStep < 1 && rows.length > 0) {
    timeline.fromTo(rows, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.055 }, 0.13);
  } else if (step < 1 && rows.length > 0) {
    timeline.to(rows, { autoAlpha: 0, y: -7, duration: immediate ? 0 : 0.2, stagger: 0.025 }, 0.04);
  } else {
    timeline.to(rows, { autoAlpha: step >= 1 ? 1 : 0, y: 0, duration: immediate ? 0 : 0.2 }, 0.08);
  }
}

function animateFlowIndicators(root: HTMLElement, timeline: gsap.core.Timeline, step: number, immediate: boolean) {
  timeline.to(root.querySelector("[data-flow-progress]"), { scaleX: Math.max(0.06, step / 3), duration: immediate ? 0 : 0.48 }, 0);
  timeline.to(root.querySelector("[data-flow-resolved]"), { autoAlpha: step >= 2 ? 1 : 0, y: step >= 2 ? 0 : 4, duration: immediate ? 0 : 0.24 }, 0.2);
  timeline.to(root.querySelector("[data-flow-ambient-rule]"), { scaleX: step >= 2 ? 1 : 0.35, duration: immediate ? 0 : 0.34 }, 0.08);
}

function animateRecordFlow(root: HTMLElement, step: number, immediate: boolean, direction: -1 | 0 | 1) {
  const values = FLOW_VALUES[step] ?? FLOW_VALUES[0];
  const flow = root.querySelector<HTMLElement>(".flow-interface");
  const previousStep = Number(flow?.dataset.flowActiveStep ?? step);
  flow?.setAttribute("data-flow-active-step", String(step));
  swapLabel(root.querySelector<HTMLElement>("[data-flow-state-label]"), values.label, immediate);
  animateFlowNumbers(root, values, step, immediate);
  const timeline = gsap.timeline({ defaults: { ease: "power3.out", overwrite: true } });
  animateFlowCards(timeline, flowCards(root), step, previousStep, direction, immediate);
  animateFlowRows(timeline, Array.from(root.querySelectorAll<HTMLElement>("[data-flow-share-row]")), step, previousStep, immediate);
  animateFlowIndicators(root, timeline, step, immediate);
}

function animateContexts(root: HTMLElement, step: number, immediate: boolean, direction: -1 | 0 | 1) {
  const states = [
    root.querySelector<HTMLElement>("[data-scope-personal]"),
    root.querySelector<HTMLElement>("[data-scope-group]"),
    root.querySelector<HTMLElement>("[data-scope-organization]"),
  ].filter((state): state is HTMLElement => Boolean(state));
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
    setAccessibility(outgoing, false);
    setAccessibility(incoming, true);
    gsap.set(incoming, { zIndex: 2 });
    const enteringParts = incoming.querySelectorAll<HTMLElement>("header, .scope-state__title, .scope-state__body > :last-child, footer");
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
      .fromTo(enteringParts, { y: 13, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.28, stagger: 0.045 }, 0.18)
      .add(() => {
        states.forEach((state, index) => {
          const active = index === step;
          if (!active) gsap.set(state, { autoAlpha: 0, x: 0, scale: 1, clipPath: "inset(0 0% 0 0%)", zIndex: 0 });
          setAccessibility(state, active);
        });
      });
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
    .fromTo(ledger, { xPercent: -10 }, { xPercent: 0, autoAlpha: 1, duration: 0.42 }, 0)
    .fromTo(chat, { xPercent: 10 }, { xPercent: 0, autoAlpha: 1, duration: 0.46 }, 0.06)
    .fromTo(rows, { x: -18, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.28, stagger: 0.07 }, 0.2)
    .fromTo(messages, { x: 18, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.28, stagger: 0.09 }, 0.25)
    .fromTo(root.querySelector("[data-collab-connector]"), { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26 }, 0.35)
    .fromTo(root.querySelector("[data-collab-badge]"), { y: 7, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.24 }, 0.47);
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
    .set(receipt, { autoAlpha: 0, clipPath: "inset(0 100% 0 0)" })
    .fromTo(link, { scaleX: 0 }, { scaleX: 1, duration: 0.22 }, 0.08)
    .to(receipt, { autoAlpha: 1, clipPath: "inset(0 0% 0 0%)", duration: 0.5 }, 0.16)
    .fromTo(stamp, { y: -10, rotation: -18, scale: 0.8 }, { y: 0, rotation: -7, scale: 1, duration: 0.3 }, 0.38);
}

function animatePrivatePanels(root: HTMLElement, sharedView: boolean, immediate: boolean) {
  const owner = root.querySelector<HTMLElement>("[data-private-panel=owner]");
  const shared = root.querySelector<HTMLElement>("[data-private-panel=shared]");
  const duration = immediate ? 0 : 0.48;
  gsap.timeline({ defaults: { ease: "power3.out", overwrite: true } })
    .to(owner, { x: sharedView ? -12 : 0, y: sharedView ? 3 : 0, autoAlpha: sharedView ? 0.42 : 1, duration }, 0)
    .to(shared, { x: sharedView ? 12 : 0, y: sharedView ? 0 : 3, autoAlpha: sharedView ? 1 : 0.42, duration }, 0)
    .to(root.querySelector("[data-after-handoff-line]"), { scaleX: sharedView ? 1 : 0.25, duration: immediate ? 0 : 0.42 }, 0.05)
    .to(root.querySelector("[data-history-rule]"), { scaleX: sharedView ? 1 : 0.35, duration: immediate ? 0 : 0.42 }, 0.12)
    .to(root.querySelector("[data-history-inbox-status]"), { rotationX: sharedView ? 360 : 0, duration: immediate ? 0 : 0.42 }, 0.08);
}

function reorderHistory(root: HTMLElement, sharedView: boolean, immediate: boolean) {
  const rail = root.querySelector<HTMLElement>("[data-history-rail]");
  const market = root.querySelector<HTMLElement>("[data-history-slip=market]");
  const train = root.querySelector<HTMLElement>("[data-history-slip=train]");
  if (!rail || !market || !train) return;
  if (immediate) {
    if (sharedView) rail.insertBefore(train, market);
    else rail.insertBefore(market, train);
    return;
  }
  const flipState = Flip.getState([market, train]);
  if (sharedView) rail.insertBefore(train, market);
  else rail.insertBefore(market, train);
  Flip.from(flipState, { duration: 0.52, ease: "power3.inOut", absolute: false, overwrite: true });
}

function updateHistoryState(root: HTMLElement, sharedView: boolean, immediate: boolean) {
  root.querySelectorAll<HTMLElement>("[data-history-slip]").forEach((record, index) => {
    record.classList.toggle("history-rail__record--active", index === 0);
  });
  const counter = root.querySelector<HTMLElement>("[data-history-counter]");
  if (counter) counter.textContent = sharedView ? "01 / 02" : "02 / 02";
  swapLabel(root.querySelector<HTMLElement>("[data-after-handoff-state]"), sharedView ? "SHARED" : "OWNER", immediate);
  rollPublicNumber(publicNumber(root, "history-market"), sharedView ? 90_000 : 360_000, 0.5, immediate);
  rollPublicNumber(publicNumber(root, "history-train"), sharedView ? 360_000 : 90_000, 0.5, immediate);
}

function animateRecords(root: HTMLElement, step: number, immediate: boolean) {
  const sharedView = step === 1;
  root.querySelector<HTMLElement>(".private-demo")?.setAttribute("data-private-view", sharedView ? "shared" : "owner");
  animatePrivatePanels(root, sharedView, immediate);
  reorderHistory(root, sharedView, immediate);
  updateHistoryState(root, sharedView, immediate);
}

function animateTimeline(root: HTMLElement, index: number, immediate: boolean) {
  const ratio = index / Math.max(PUBLIC_LANDING_STATES.length - 1, 1);
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
    link.toggleAttribute("aria-current", active);
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
  if (state.scene === "record-flow") animateRecordFlow(root, state.step, immediate, direction);
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
    if (scene === "record-flow") {
      const rule = root.querySelector<HTMLElement>("[data-flow-ambient-rule]");
      if (rule) tweens.push(gsap.fromTo(rule, { xPercent: -100 }, { xPercent: 100, duration: 4.8, repeat: -1, ease: "none" }));
    }
    if (scene === "collaboration") {
      const scan = root.querySelector<HTMLElement>("[data-collab-scan]");
      if (scan) tweens.push(gsap.fromTo(scan, { xPercent: -100 }, { xPercent: 100, duration: 4.2, repeat: -1, ease: "none" }));
    }
    if (scene === "records") {
      const rule = root.querySelector<HTMLElement>("[data-history-rule]");
      if (rule) tweens.push(gsap.fromTo(rule, { xPercent: -100 }, { xPercent: 100, duration: 5.6, repeat: -1, ease: "none" }));
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
  let currentIndex = 0;
  let transitionLocked = false;
  let activeScrollTween: gsap.core.Tween | null = null;
  let settleTimer: number | null = null;
  let resizeTimer: number | null = null;
  let focusEscapeUntil = 0;
  let snapPoints: number[] = [];
  let observer: Observer | null = null;
  let wheelLatched = false;
  let lastWheelAt = 0;
  const wheelQuietMs = 140;
  const ambient = setupAmbientMotion(root);

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
    if (performance.now() - lastWheelAt >= wheelQuietMs) wheelLatched = false;
  };
  const goTo = (requestedIndex: number, reason: "gesture" | "keyboard" | "anchor" | "native", immediate = false) => {
    const index = clampPublicLandingIndex(requestedIndex);
    if (!immediate && transitionLocked) {
      if (reason === "gesture") return;
      activeScrollTween?.kill();
      transitionLocked = false;
    }
    rebuildSnapPoints();
    const targetY = snapPoints[index] ?? 0;
    const previousIndex = currentIndex;
    const changed = index !== previousIndex;
    const direction = changed ? (index > previousIndex ? 1 : -1) as -1 | 1 : 0;
    currentIndex = index;
    if (reason !== "gesture") wheelLatched = false;
    animateLandingState(root, PUBLIC_LANDING_STATES[index]!, immediate || !changed, direction, ambient.activate);
    if (immediate || Math.abs(window.scrollY - targetY) < 2) {
      window.scrollTo(0, targetY);
      releaseTransition();
      return;
    }
    transitionLocked = true;
    activeScrollTween?.kill();
    activeScrollTween = gsap.to(window, {
      scrollTo: { y: targetY, autoKill: false },
      duration: reason === "gesture" ? 0.54 : 0.58,
      ease: "power2.out",
      overwrite: "auto",
      onComplete: releaseTransition,
      onInterrupt: releaseTransition,
    });
  };
  const step = (direction: -1 | 1) => {
    const next = nextPublicLandingIndex(currentIndex, direction);
    if (next !== currentIndex) goTo(next, "gesture");
  };
  const handleWheelStep = (direction: -1 | 1) => {
    if (wheelLatched) return;
    wheelLatched = true;
    step(direction);
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
      goTo(nextPublicLandingIndex(currentIndex, direction as -1 | 1), "keyboard");
    }
  };
  const onScroll = () => {
    if (transitionLocked || performance.now() < focusEscapeUntil) return;
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      const next = nearestIndex(window.scrollY);
      if (next !== currentIndex) goTo(next, "native");
    }, 70);
  };
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof Element && root.contains(event.target)) {
      focusEscapeUntil = performance.now() + 240;
      const next = nearestIndex(window.scrollY);
      currentIndex = next;
      animateLandingState(root, PUBLIC_LANDING_STATES[next]!, true, 0, ambient.activate);
    }
  };
  const onJump = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("[data-public-jump]") : null;
    if (!link) return;
    const index = Number(link.dataset.publicJump);
    if (!Number.isInteger(index)) return;
    event.preventDefault();
    goTo(index, "anchor");
  };
  const onAnchor = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
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
  const initialIndex = nearestIndex(window.scrollY);
  currentIndex = initialIndex;
  animateLandingState(root, PUBLIC_LANDING_STATES[initialIndex]!, true, 0, ambient.activate);

  observer = Observer.create({
    id: "public-landing-stepper",
    target: window,
    type: "wheel",
    tolerance: 5,
    debounce: false,
    wheelSpeed: 1,
    preventDefault: true,
    ignore: "a,button,input,textarea,select,[contenteditable=true]",
    onWheel: () => { lastWheelAt = performance.now(); },
    onStopDelay: wheelQuietMs,
    onStop: () => {
      if (!transitionLocked && performance.now() - lastWheelAt >= wheelQuietMs) wheelLatched = false;
    },
    onDown: () => handleWheelStep(1),
    onUp: () => handleWheelStep(-1),
    onDisable: () => { wheelLatched = false; },
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
    ambient.cleanup();
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

function setupReducedLanding(root: HTMLElement) {
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
              aria-current={index === 0 ? "step" : undefined}
              aria-label={`${String(index).padStart(2, "0")} ${state.label}`}
              data-public-jump={index}
              data-public-timeline-node
              href={`#${state.sectionId}`}
              key={`${state.scene}-${state.step}`}
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
