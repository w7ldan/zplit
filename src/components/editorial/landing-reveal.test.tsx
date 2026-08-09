import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEDGER_HANDOFF_TRAVEL_VH, LandingReveal, LandingStoryMotion, ledgerHandoffGeometry, ledgerHandoffProgress, ledgerHandoffStart, ledgerHandoffTravel, ledgerHandoffWindow } from "./landing-reveal";

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

  it("interpolates viewport endpoints continuously and reversibly", () => {
    const hero = { left: 820, top: 180, width: 420 } as DOMRect;
    const journey = { left: 220, top: 630, width: 960 } as DOMRect;
    expect(ledgerHandoffStart(hero, 900)).toBe(1080);
    expect(ledgerHandoffGeometry(hero, journey, 0)).toEqual({ left: 820, top: 180, width: 420 });
    expect(ledgerHandoffGeometry(hero, journey, 1)).toEqual({ left: 220, top: 630, width: 960 });
    const middle = ledgerHandoffGeometry(hero, journey, 0.5);
    expect(middle.left).toBe(520);
    expect(middle.top).toBe(405);
    expect(middle.width).toBeGreaterThan(420);
    expect(middle.width).toBeLessThan(960);
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const forward = ledgerHandoffGeometry(hero, journey, progress);
      const reverse = ledgerHandoffGeometry(journey, hero, 1 - progress);
      expect(forward.left).toBeCloseTo(reverse.left);
      expect(forward.top).toBeCloseTo(reverse.top);
    }
  });

  it("keeps travel at 30vh regardless of the bridge child size", () => {
    expect(LEDGER_HANDOFF_TRAVEL_VH).toBe(30);
    expect(ledgerHandoffTravel(900)).toBe(270);
  });

  it("anchors progress to the Hero boundary, crossfades carriers, and reconciles viewport endpoints", () => {
    let desktop = true;
    let frame: FrameRequestCallback | undefined;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900, writable: true });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 600, writable: true });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn((query: string) => ({ get matches() { return query === "(min-width: 960px)" ? desktop : query === "(min-height: 720px)"; }, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { unmount } = render(<LandingStoryMotion><div className="hero__content" /><div className="hero__ledger" /><div data-ledger-handoff-runway><div data-ledger-handoff /></div><div className="product-journey"><div className="journey-frame" /></div></LandingStoryMotion>);
    const runway = document.querySelector<HTMLElement>("[data-ledger-handoff-runway]")!;
    const handoff = document.querySelector<HTMLElement>("[data-ledger-handoff]")!;
    const hero = document.querySelector<HTMLElement>(".hero__ledger")!;
    const journey = document.querySelector<HTMLElement>(".journey-frame")!;
    const journeyProduct = document.querySelector<HTMLElement>(".product-journey")!;
    Object.defineProperty(handoff, "offsetHeight", { configurable: true, get: () => { throw new Error("handoff child height must not determine travel"); } });
    vi.spyOn(hero, "getBoundingClientRect").mockImplementation(() => ({ left: 820, top: 500 - window.scrollY, width: 420 } as DOMRect));
    vi.spyOn(journey, "getBoundingClientRect").mockImplementation(() => ({ left: 220, top: 1400 - window.scrollY, width: 960 } as DOMRect));

    act(() => window.dispatchEvent(new Event("resize")));
    expect(Number(runway.style.getPropertyValue("--ledger-handoff-progress"))).toBeCloseTo(100 / 270);
    expect(runway).toHaveAttribute("data-handoff-ready", "true");
    expect(runway).toHaveAttribute("data-handoff-active", "true");
    expect(journeyProduct).toHaveAttribute("data-ledger-handoff-target", "true");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 500, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("0");
    expect(runway.style.getPropertyValue("--ledger-handoff-x")).toBe("820px");
    expect(runway.style.getPropertyValue("--ledger-handoff-y")).toBe("0px");
    expect(runway.style.getPropertyValue("--ledger-handoff-width")).toBe("420px");
    expect(runway.style.getPropertyValue("--ledger-handoff-opacity")).toBe("0");
    expect(hero.style.getPropertyValue("--ledger-handoff-hero-opacity")).toBe("1");
    expect(document.querySelector<HTMLElement>(".hero__content")?.style.getPropertyValue("--ledger-handoff-copy-opacity")).toBe("1");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 513.5, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(runway).toHaveAttribute("data-handoff-active", "true");
    expect(Number.parseFloat(runway.style.getPropertyValue("--ledger-handoff-opacity"))).toBeGreaterThan(0);
    expect(Number.parseFloat(runway.style.getPropertyValue("--ledger-handoff-opacity"))).toBeLessThan(1);
    expect(Number.parseFloat(hero.style.getPropertyValue("--ledger-handoff-hero-opacity"))).toBeGreaterThan(0);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 635, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(Number(runway.style.getPropertyValue("--ledger-handoff-progress"))).toBeCloseTo(0.5);
    expect(Number.parseFloat(runway.style.getPropertyValue("--ledger-handoff-x"))).toBeCloseTo(520);
    expect(Number.parseFloat(runway.style.getPropertyValue("--ledger-handoff-y"))).toBeCloseTo(315);
    expect(Number.parseFloat(runway.style.getPropertyValue("--ledger-handoff-opacity"))).toBe(1);
    expect(hero.style.getPropertyValue("--ledger-handoff-hero-opacity")).toBe("0");
    expect(document.querySelector<HTMLElement>(".hero__content")?.style.getPropertyValue("--ledger-handoff-copy-opacity")).toBe("0");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 770, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("1");
    expect(runway.style.getPropertyValue("--ledger-handoff-x")).toBe("220px");
    expect(runway.style.getPropertyValue("--ledger-handoff-y")).toBe("630px");
    expect(runway.style.getPropertyValue("--ledger-handoff-opacity")).toBe("0");
    expect(journeyProduct.style.getPropertyValue("--ledger-handoff-journey-opacity")).toBe("1");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 800, writable: true });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(runway).not.toHaveAttribute("data-handoff-active");
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("1");

    act(() => window.dispatchEvent(new Event("pageshow")));
    desktop = false;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(runway).not.toHaveAttribute("data-handoff-active");
    expect(runway).not.toHaveAttribute("data-handoff-ready");
    expect(runway.style.getPropertyValue("--ledger-handoff-progress")).toBe("");
    expect(journeyProduct).not.toHaveAttribute("data-ledger-handoff-target");
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
