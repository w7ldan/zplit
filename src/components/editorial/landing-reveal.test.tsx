import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEDGER_HANDOFF_TRAVEL_VH, LandingReveal, LandingStoryMotion, ledgerHandoffGeometry, ledgerHandoffProgress, ledgerHandoffTravel, ledgerHandoffWindow } from "./landing-reveal";

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
    expect(ledgerHandoffTravel(900)).toBe(270);
    for (const progress of [0, 0.2, 0.4, 0.7, 1]) expect(ledgerHandoffProgress(900 + progress * 270, 900, 270)).toBeCloseTo(progress);
    expect(ledgerHandoffProgress(800, 900, 270)).toBe(0);
    expect(ledgerHandoffProgress(1300, 900, 270)).toBe(1);
    expect(ledgerHandoffWindow(0.1, 0.1, 0.55)).toBe(0);
    expect(ledgerHandoffWindow(0.55, 0.1, 0.55)).toBe(1);
  });

  it("interpolates measured Hero and Journey endpoints without handoff-child geometry", () => {
    const hero = { left: 700, top: 100, width: 400 } as DOMRect;
    const journey = { left: 100, top: 1000, width: 1200 } as DOMRect;
    const runway = { left: 0, top: 800 } as DOMRect;
    expect(ledgerHandoffGeometry(hero, journey, runway, 0)).toEqual({ x: 700, y: -700, width: 400 });
    expect(ledgerHandoffGeometry(hero, journey, runway, 1)).toEqual({ x: 100, y: 200, width: 1200 });
    const middle = ledgerHandoffGeometry(hero, journey, runway, 0.5);
    expect(middle.x).toBe(400);
    expect(middle.y).toBe(-250);
    expect(middle.width).toBeGreaterThan(400);
    expect(middle.width).toBeLessThan(1200);
  });

  it("reconciles restored scroll, resize, pageshow, and clears progress outside desktop mode", () => {
    let desktop = true;
    let frame: FrameRequestCallback | undefined;
    let documentTop = 1000;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900, writable: true });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1189, writable: true });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn((query: string) => ({ get matches() { return query === "(min-width: 960px)" ? desktop : query === "(min-height: 720px)"; }, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ top: "0px" } as CSSStyleDeclaration);
    const { unmount } = render(<LandingStoryMotion><div className="hero__ledger" /><div data-ledger-handoff-runway><div data-ledger-handoff /></div><div className="journey-frame" /></LandingStoryMotion>);
    const runway = document.querySelector<HTMLElement>("[data-ledger-handoff-runway]")!;
    const handoff = document.querySelector<HTMLElement>("[data-ledger-handoff]")!;
    const hero = document.querySelector<HTMLElement>(".hero__ledger")!;
    const journey = document.querySelector<HTMLElement>(".journey-frame")!;
    Object.defineProperty(handoff, "offsetHeight", { configurable: true, value: 9000 });
    vi.spyOn(runway, "getBoundingClientRect").mockImplementation(() => ({ left: 0, top: documentTop - window.scrollY } as DOMRect));
    vi.spyOn(hero, "getBoundingClientRect").mockImplementation(() => ({ left: 600, top: 500 - window.scrollY, width: 400 } as DOMRect));
    vi.spyOn(journey, "getBoundingClientRect").mockImplementation(() => ({ left: 100, top: 1400 - window.scrollY, width: 1100 } as DOMRect));

    act(() => window.dispatchEvent(new Event("resize")));
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("0.7");
    expect(Number.parseFloat(runway.style.getPropertyValue("--ledger-handoff-x"))).toBeCloseTo(208);
    expect(runway.style.getPropertyValue("--ledger-handoff-width")).toBe("1100px");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1108, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("0.4");
    Object.defineProperty(handoff, "offsetHeight", { configurable: true, value: 1 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("0.4");
    documentTop = 1100;
    act(() => window.dispatchEvent(new Event("pageshow")));
    expect(Number(runway.style.getPropertyValue("--ledger-handoff-progress"))).toBeCloseTo(0.0296, 3);
    vi.mocked(hero.getBoundingClientRect).mockImplementation(() => ({ left: 500, top: 500 - window.scrollY, width: 500 } as DOMRect));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(Number.parseFloat(runway.style.getPropertyValue("--ledger-handoff-x"))).toBeCloseTo(499, 0);
    expect(runway.style.getPropertyValue("--ledger-handoff-width")).toBe("500px");
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
    const { unmount } = render(<LandingStoryMotion><section data-story-motion="search">Search</section><section data-story-motion="receipt">Receipt</section><footer data-story-motion="finale">Finale</footer></LandingStoryMotion>);
    const search = screen.getByText("Search");
    const receipt = screen.getByText("Receipt");
    expect(observe).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Finale")).toHaveClass("payoff-motion--ready");
    expect(screen.getByText("Finale")).not.toHaveClass("story-motion--ready");
    expect(search).toHaveClass("story-motion--ready");
    act(() => callback([{ isIntersecting: true, target: search } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(search).toHaveClass("story-motion--visible");
    expect(receipt).not.toHaveClass("story-motion--visible");
    expect(unobserve).toHaveBeenCalledWith(search);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("shows the payoff amount first, then the row, then the CTA from local scroll progress", () => {
    let frame: FrameRequestCallback | undefined;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000, writable: true });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0, writable: true });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    const { unmount } = render(<LandingStoryMotion><footer data-story-motion="finale"><div className="payoff"><span>Still open</span><strong>Rp 42.500</strong><div className="payoff__row">Dimas</div></div><div className="story-close__cta">Open Zplit</div></footer></LandingStoryMotion>);
    const finale = screen.getByText("Still open").closest("footer")!;
    vi.spyOn(finale, "getBoundingClientRect").mockReturnValue({ top: 2000 } as DOMRect);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(finale.style.getPropertyValue("--payoff-row-progress")).toBe("0");
    expect(finale.style.getPropertyValue("--payoff-cta-progress")).toBe("0");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1675, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(Number(finale.style.getPropertyValue("--payoff-row-progress"))).toBeGreaterThan(0);
    expect(finale.style.getPropertyValue("--payoff-cta-progress")).toBe("0");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 2000, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(finale.style.getPropertyValue("--payoff-row-progress")).toBe("1");
    expect(finale.style.getPropertyValue("--payoff-cta-progress")).toBe("1");
    unmount();
  });

  it("leaves every payoff state visible without choreography for reduced motion", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    render(<LandingStoryMotion><footer data-story-motion="finale"><strong>Rp 42.500</strong><div>Dimas row</div><div>Open Zplit</div></footer></LandingStoryMotion>);
    const finale = screen.getByText("Rp 42.500").closest("footer")!;
    expect(finale).not.toHaveClass("payoff-motion--ready");
    expect(finale.style.getPropertyValue("--payoff-row-progress")).toBe("");
    expect(screen.getByText("Dimas row")).toBeInTheDocument();
    expect(screen.getByText("Open Zplit")).toBeInTheDocument();
  });
});
