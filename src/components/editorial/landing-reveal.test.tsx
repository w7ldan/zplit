import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingStoryMotion } from "./landing-reveal";

afterEach(() => vi.unstubAllGlobals());

describe("LandingStoryMotion", () => {
  it("owns one scroll/pointer-ready public input surface and writes scene variables", () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const { container, unmount } = render(<LandingStoryMotion><section data-spatial-scene="model">Model</section></LandingStoryMotion>);

    const root = container.querySelector("main")!;
    const scene = container.querySelector<HTMLElement>("[data-spatial-scene]")!;
    expect(root).toHaveClass("spatial-landing--motion-ready");
    expect(scene.style.getPropertyValue("--scene-progress")).not.toBe("");
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(requestAnimationFrame).toHaveBeenCalled();
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("marks reduced motion while keeping the complete DOM path available", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn((query: string) => ({ matches: query.includes("prefers-reduced-motion") })) });
    const { container } = render(<LandingStoryMotion><section data-spatial-scene="model">Model content</section></LandingStoryMotion>);
    expect(container.querySelector("main")).toHaveClass("spatial-landing--reduced");
    expect(container).toHaveTextContent("Model content");
  });
});
