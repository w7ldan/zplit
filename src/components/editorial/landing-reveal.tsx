"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";

type ThreeCanvas = ComponentType<{ onReadyChange: (ready: boolean) => void }>;

/** Keeps the complete narrative DOM available while the public-only renderer loads. */
export function LandingStoryMotion({ children }: { children: ReactNode }) {
  const [Canvas, setCanvas] = useState<ThreeCanvas>();
  const [webglReady, setWebglReady] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let active = true;
    const load = () => {
      if (motion?.matches) {
        setCanvas(undefined);
        setWebglReady(false);
        return;
      }
      void import("./three-landing-canvas")
        .then(({ ThreeLandingCanvas }) => {
          if (active) setCanvas(() => ThreeLandingCanvas);
        })
        .catch(() => setWebglReady(false));
    };
    load();
    motion?.addEventListener?.("change", load);
    return () => {
      active = false;
      motion?.removeEventListener?.("change", load);
    };
  }, []);

  return (
    <main className={`public-home spatial-landing${webglReady ? " landing-webgl--ready" : ""}`} id="top">
      {Canvas ? <Canvas onReadyChange={setWebglReady} /> : null}
      <div className="landing-narrative">{children}</div>
    </main>
  );
}
