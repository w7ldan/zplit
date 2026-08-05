"use client";

import { useCallback, useSyncExternalStore } from "react";

export const DETACHED_HEADER_THRESHOLD = 32;

export function useDetachedHeader(threshold = DETACHED_HEADER_THRESHOLD) {
  const getSnapshot = useCallback(() => typeof window !== "undefined" && window.scrollY >= threshold, [threshold]);
  const getServerSnapshot = useCallback(() => false, []);
  const subscribe = useCallback((listener: () => void) => {
    let frame: number | null = null;
    let current = getSnapshot();
    const emit = () => {
      const next = getSnapshot();
      if (next === current) return;
      current = next;
      listener();
    };
    const flush = () => {
      frame = null;
      emit();
    };
    const onScroll = () => {
      if (frame === null) frame = window.requestAnimationFrame(flush);
    };
    const onRestore = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      emit();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pageshow", onRestore);
    window.addEventListener("resize", onRestore);
    document.addEventListener("visibilitychange", onRestore);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pageshow", onRestore);
      window.removeEventListener("resize", onRestore);
      document.removeEventListener("visibilitychange", onRestore);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [getSnapshot]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
