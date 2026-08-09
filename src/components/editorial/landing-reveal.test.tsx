import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEDGER_HANDOFF_TRAVEL_VH, LandingReveal, LandingStoryMotion, ledgerHandoffProgress, ledgerHandoffWindow } from "./landing-reveal";

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
  it("maps the compact handoff continuously and reversibly from scroll geometry", () => {
    expect(LEDGER_HANDOFF_TRAVEL_VH).toBe(30);
    for (const progress of [0, 0.2, 0.4, 0.7, 1]) expect(ledgerHandoffProgress(900 + progress * 300, 900, 300)).toBeCloseTo(progress);
    expect(ledgerHandoffProgress(800, 900, 300)).toBe(0);
    expect(ledgerHandoffProgress(1300, 900, 300)).toBe(1);
    expect(ledgerHandoffProgress(1110, 900, 300)).toBeCloseTo(0.7);
    expect(ledgerHandoffProgress(1020, 900, 300)).toBeCloseTo(0.4);
    expect(ledgerHandoffWindow(0.1, 0.1, 0.55)).toBe(0);
    expect(ledgerHandoffWindow(0.55, 0.1, 0.55)).toBe(1);
  });

  it("reconciles restored scroll, resize, pageshow, and clears progress outside desktop mode", () => {
    let desktop = true;
    let frame: FrameRequestCallback | undefined;
    let documentTop = 1000;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1210, writable: true });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn((query: string) => ({ get matches() { return query === "(min-width: 960px)" ? desktop : query === "(min-height: 720px)"; }, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ top: "0px" } as CSSStyleDeclaration);
    const { unmount } = render(<LandingStoryMotion><div data-ledger-handoff-runway><div data-ledger-handoff /></div></LandingStoryMotion>);
    const runway = document.querySelector<HTMLElement>("[data-ledger-handoff-runway]")!;
    Object.defineProperty(runway, "offsetHeight", { configurable: true, value: 300 });
    vi.spyOn(runway, "getBoundingClientRect").mockImplementation(() => ({ top: documentTop - window.scrollY } as DOMRect));

    act(() => window.dispatchEvent(new Event("resize")));
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("0.7");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1120, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("0.4");
    documentTop = 1100;
    act(() => window.dispatchEvent(new Event("pageshow")));
    expect(Number(runway.style.getPropertyValue("--ledger-handoff-progress"))).toBeCloseTo(0.0667, 3);
    desktop = false;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(runway).not.toHaveAttribute("data-handoff-active");
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("");
    unmount();
  });

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
