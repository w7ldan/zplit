import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingReveal, LandingStoryMotion } from "./landing-reveal";

afterEach(() => vi.unstubAllGlobals());

describe("LandingReveal", () => {
  it("uses a one-shot observer and disconnects it on cleanup", () => {
    let callback: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) { callback = next; }
      observe = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    render(<LandingReveal><p>Supporting copy</p></LandingReveal>);
    const target = screen.getByText("Supporting copy").parentElement!;
    expect(target).toHaveClass("landing-reveal--ready");
    expect(target).not.toHaveClass("landing-reveal--visible");
    act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(target).toHaveClass("landing-reveal--visible");
    act(() => callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(target).toHaveClass("landing-reveal--visible");
    expect(disconnect).toHaveBeenCalled();
  });

  it("reveals immediately when reduced motion is preferred", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true })) });
    render(<LandingReveal><p>Immediate copy</p></LandingReveal>);
    expect(screen.getByText("Immediate copy").parentElement).toHaveClass("landing-reveal--visible");
  });
});

describe("LandingStoryMotion", () => {
  it("uses one observer for all causal story moments", () => {
    let callback: IntersectionObserverCallback = () => {};
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) { callback = next; }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false })) });
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const { unmount } = render(<LandingStoryMotion><section data-story-motion="search">Search</section><section data-story-motion="receipt">Receipt</section></LandingStoryMotion>);
    const search = screen.getByText("Search");
    const receipt = screen.getByText("Receipt");
    expect(observe).toHaveBeenCalledTimes(2);
    expect(search).toHaveClass("story-motion--ready");
    act(() => callback([{ isIntersecting: true, target: search } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(search).toHaveClass("story-motion--visible");
    expect(receipt).not.toHaveClass("story-motion--visible");
    expect(unobserve).toHaveBeenCalledWith(search);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
