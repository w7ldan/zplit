"use client";

import { useState, useEffect } from "react";

export const DETACHED_HEADER_THRESHOLD = 32;

export function useDetachedHeader(threshold = DETACHED_HEADER_THRESHOLD) {
  const [detached, setDetached] = useState(() => typeof window !== "undefined" && window.scrollY >= threshold);

  useEffect(() => {
    let frame: number | null = null;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let previous = window.scrollY >= threshold;

    const update = () => {
      frame = null;
      const next = window.scrollY >= threshold;
      if (next === previous) return;
      previous = next;
      setDetached(next);
    };

    const onScroll = () => {
      if (reducedMotion) {
        update();
        return;
      }
      if (frame === null) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return detached;
}
