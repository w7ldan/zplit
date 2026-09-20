"use client";

import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function readPreference() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(readPreference);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    if (media.addEventListener) media.addEventListener("change", updatePreference);
    else media.addListener?.(updatePreference);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", updatePreference);
      else media.removeListener?.(updatePreference);
    };
  }, []);

  return reducedMotion;
}
