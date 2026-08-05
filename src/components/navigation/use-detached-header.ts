"use client";

import { useState, useEffect } from "react";

export const DETACHED_HEADER_THRESHOLD = 32;

export function useDetachedHeader(threshold = DETACHED_HEADER_THRESHOLD) {
  const [detached, setDetached] = useState(() => typeof window !== "undefined" && window.scrollY >= threshold);

  useEffect(() => {
    let frame: number | null = null;
    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    const update = () => {
      frame = null;
      const next = window.scrollY >= threshold;
      setDetached((current) => current === next ? current : next);
    };

    const onScroll = () => {
      if (motionQuery?.matches) {
        update();
        return;
      }
      if (frame === null) frame = window.requestAnimationFrame(update);
    };

    update();
    document.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    const onMotionChange = () => onScroll();
    motionQuery?.addEventListener?.("change", onMotionChange);
    return () => {
      document.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      motionQuery?.removeEventListener?.("change", onMotionChange);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return detached;
}
