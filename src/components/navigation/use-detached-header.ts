"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const DETACHED_HEADER_THRESHOLD = 32;
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useDetachedHeader(threshold = DETACHED_HEADER_THRESHOLD) {
  const [detached, setDetached] = useState(false);
  const detachedRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    let frame: number | null = null;
    const update = () => {
      const next = window.scrollY >= threshold;
      if (next === detachedRef.current) return;
      detachedRef.current = next;
      setDetached(next);
    };
    const flush = () => {
      frame = null;
      update();
    };
    const schedule = (restart = false) => {
      if (restart && frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      if (frame === null) frame = window.requestAnimationFrame(flush);
    };
    const onScroll = () => schedule();
    const onRestore = () => schedule(true);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") schedule(); };
    const restorationTimer = window.setTimeout(() => schedule(true), 0);

    update();
    schedule();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pageshow", onRestore);
    window.addEventListener("resize", onRestore);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pageshow", onRestore);
      window.removeEventListener("resize", onRestore);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearTimeout(restorationTimer);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return detached;
}
