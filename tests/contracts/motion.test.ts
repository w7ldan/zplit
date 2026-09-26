import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSource } from "./helpers";

const css = readSource("src/app/styles/75-money-trail.css");
const interactions = readSource(
  "src/components/marketing/money-trail-interactions.tsx",
);

describe("Motion and feedback contract", () => {
  it("keeps the trail motion bounded and the story controllable", () => {
    expect(css).toContain("@keyframes trail-draw");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(interactions).toContain("IntersectionObserver");
    expect(interactions).toContain("aria-current");
    expect(interactions).not.toMatch(
      /scrollTo|ScrollTrigger|pointermove|mousemove|requestAnimationFrame/,
    );
    expect(css).not.toMatch(/scroll-snap|position: fixed/);
  });

  it("shows the final state immediately with reduced motion", () => {
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*?animation: none !important/,
    );
    expect(readFileSync("package.json", "utf8")).not.toMatch(/"gsap"/);
  });
});
