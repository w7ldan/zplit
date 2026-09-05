import { describe, expect, it } from "vitest";
import { readSource } from "./helpers";

const publicSource = readSource("src/app/styles/10-public.css");
const landingMotionSource = readSource("src/components/editorial/landing-reveal.tsx");
const publicPageSource = readSource("src/app/page.tsx");
const landingSceneSource = readSource("src/components/editorial/landing-scenes.tsx");

describe("Motion and feedback contract", () => {
  it("centralizes reversible scroll and pointer input for public scenes", () => {
    expect(landingMotionSource).toContain('window.addEventListener("scroll", onScroll, { passive: true })');
    expect(landingMotionSource).toContain('target.addEventListener("pointermove", onPointerMove, { passive: true })');
    expect(landingMotionSource).toContain("window.requestAnimationFrame(update)");
    expect(landingMotionSource).toContain("document.visibilityState");
    expect(landingMotionSource).toContain("window.cancelAnimationFrame(frame)");
    expect(landingMotionSource).not.toMatch(/setState|set[A-Z][A-Za-z]+\(progress/);
    expect(publicPageSource).toContain('data-spatial-scene="hero"');
    expect(landingSceneSource).toContain('data-spatial-scene="model"');
    expect(landingSceneSource).toContain("aria-pressed={receiptFocused}");
    expect(landingSceneSource).toContain("aria-expanded={sharesOpen}");
  });

  it("keeps meaningful depth and a complete reduced-motion path", () => {
    expect(publicSource).toContain("perspective: 1800px;");
    expect(publicSource).toContain("transform-style: preserve-3d;");
    expect(publicSource).toContain("calc(var(--scene-progress, 0)");
    expect(publicSource).toContain("@keyframes ledger-tick");
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transform: none !important;/);
    expect(publicSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;/);
    expect(publicSource).not.toMatch(/\.public-home[^{}]*\{[^}]*overflow:\s*hidden/);
  });
});
