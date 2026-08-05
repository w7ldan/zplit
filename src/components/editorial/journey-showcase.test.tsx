import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JourneyShowcase } from "./journey-showcase";

afterEach(() => vi.unstubAllGlobals());

function mediaQuery(matches: boolean) {
  return { matches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

describe("JourneyShowcase", () => {
  it("keeps the complete presentation inside one sticky stage", () => {
    vi.stubGlobal("matchMedia", (query: string) => mediaQuery(query === "(min-width: 960px)"));
    render(<JourneyShowcase />);
    const stage = document.querySelector(".journey-sticky")!;
    expect(stage).toContainElement(screen.getByRole("heading", { name: /From one outing/ }));
    expect(stage).toContainElement(screen.getByRole("tab", { name: /The balance becomes settled/ }));
    expect(stage).toContainElement(document.querySelector(".journey-frame")!);
    expect(document.querySelectorAll(".journey-runway")).toHaveLength(1);
    expect(document.querySelectorAll("[style*='overflow-y']")).toHaveLength(0);
  });

  it("reaches both progress boundaries and scrolls to a selected desktop step", () => {
    vi.stubGlobal("matchMedia", (query: string) => mediaQuery(query === "(min-width: 960px)"));
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    render(<JourneyShowcase />);
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    const rail = document.querySelector(".journey-rail")! as HTMLElement;
    Object.defineProperty(stage, "offsetHeight", { configurable: true, value: 400 });
    Object.defineProperty(runway, "offsetHeight", { configurable: true, value: 2000 });
    vi.spyOn(runway, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(rail.style.getPropertyValue("--journey-progress")).toBe("0.0000");
    vi.spyOn(runway, "getBoundingClientRect").mockReturnValue({ top: -1600 } as DOMRect);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(rail.style.getPropertyValue("--journey-progress")).toBe("1.0000");
    fireEvent.click(screen.getByRole("tab", { name: /Expenses enter/ }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });

  it("waits for the illustrative frame before advancing the rail", () => {
    vi.stubGlobal("matchMedia", (query: string) => mediaQuery(query === "(min-width: 960px)"));
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    render(<JourneyShowcase />);
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    const illustrativeFrame = document.querySelector(".journey-frame")! as HTMLElement;
    const rail = document.querySelector(".journey-rail")! as HTMLElement;
    Object.defineProperty(stage, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(runway, "offsetHeight", { configurable: true, value: 2000 });
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(illustrativeFrame, "getBoundingClientRect").mockReturnValue({ top: 400, bottom: 900 } as DOMRect);
    vi.spyOn(runway, "getBoundingClientRect").mockReturnValue({ top: -399 } as DOMRect);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(rail.style.getPropertyValue("--journey-progress")).toBe("0.0000");
    vi.spyOn(runway, "getBoundingClientRect").mockReturnValue({ top: -800 } as DOMRect);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(rail.style.getPropertyValue("--journey-progress")).toBe("0.2857");
  });
});
