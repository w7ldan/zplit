import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const publicAuth = readSource("src/app/styles/70-public-auth-vnext.css");
const landing = readSource("src/components/editorial/public-landing.tsx");
const page = readSource("src/app/page.tsx");

describe("Motion and feedback contract", () => {
  it("keeps public motion small, semantic, and free of scroll takeover", () => {
    expect(publicAuth).toContain("@keyframes public-vnext-example-in");
    expect(publicAuth).toContain("@keyframes public-vnext-record-in");
    expect(publicAuth).toContain("@media (prefers-reduced-motion: reduce)");
    expect(publicAuth).not.toMatch(/scroll-snap|wheel|scrollTo|Observer|ScrollTrigger|pointermove|mousemove/);
    expect(landing).not.toMatch(/useEffect|useState|PublicMotion|gsap|ScrollTrigger|Observer|wheel|pointermove|mousemove/);
    expect(page).not.toContain("PublicMotion");
    expect(css).not.toMatch(/\.public-home|\.public-scene-index|\.journey-|\.story-motion/);
  });

  it("keeps reduced motion complete and removes the abandoned GSAP direction", () => {
    expect(publicAuth).toMatch(/prefers-reduced-motion: reduce[\s\S]*?animation: none !important/);
    expect(publicAuth).toMatch(/prefers-reduced-motion: reduce[\s\S]*?transform: none !important/);
    expect(readFileSync("package.json", "utf8")).not.toMatch(/"gsap"/);
    expect(readSource("src/app/globals.css")).toContain('70-public-auth-vnext.css');
  });
});
