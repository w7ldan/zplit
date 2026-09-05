"use client";

import { useEffect, useRef, type ReactNode } from "react";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Owns the public landing input loop. Scenes only consume CSS variables, so
 * scroll and pointer work never becomes a stream of React renders.
 */
export function LandingStoryMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const target = root.current;
    if (!target) return;

    target.classList.add("spatial-landing--motion-ready");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
    if (reducedMotion) {
      target.classList.add("spatial-landing--reduced");
      return;
    }

    const scenes = [...target.querySelectorAll<HTMLElement>("[data-spatial-scene]")];
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    const update = () => {
      frame = 0;
      if (document.visibilityState === "hidden") return;
      const viewportHeight = Math.max(window.innerHeight, 1);
      const pageTravel = Math.max(target.scrollHeight - viewportHeight, 1);
      target.style.setProperty("--page-progress", String(clamp(window.scrollY / pageTravel, 0, 1)));
      target.style.setProperty("--pointer-x", String(pointerX));
      target.style.setProperty("--pointer-y", String(pointerY));

      for (const scene of scenes) {
        const bounds = scene.getBoundingClientRect();
        const travel = Math.max(viewportHeight + bounds.height * 0.45, 1);
        const progress = clamp((viewportHeight * 0.78 - bounds.top) / travel, 0, 1);
        const focus = clamp(1 - Math.abs((bounds.top + bounds.height * 0.5 - viewportHeight * 0.56) / (viewportHeight * 0.95)), 0, 1);
        scene.style.setProperty("--scene-progress", String(progress));
        scene.style.setProperty("--scene-focus", String(focus));
      }
    };

    const schedule = () => {
      if (frame || document.visibilityState === "hidden") return;
      frame = window.requestAnimationFrame(update);
    };
    const onScroll = () => schedule();
    const onResize = () => schedule();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") schedule();
      else if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const onPageShow = () => schedule();
    const onPointerMove = (event: PointerEvent) => {
      if (!finePointer) return;
      const bounds = target.getBoundingClientRect();
      pointerX = clamp((event.clientX - bounds.left) / Math.max(bounds.width, 1) * 2 - 1, -1, 1);
      pointerY = clamp((event.clientY - bounds.top) / Math.max(bounds.height, 1) * 2 - 1, -1, 1);
      schedule();
    };
    const onPointerLeave = () => {
      pointerX = 0;
      pointerY = 0;
      schedule();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (finePointer) {
      target.addEventListener("pointermove", onPointerMove, { passive: true });
      target.addEventListener("pointerleave", onPointerLeave, { passive: true });
    }
    schedule();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerleave", onPointerLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <main className="public-home spatial-landing" id="top" ref={root}>{children}</main>;
}
