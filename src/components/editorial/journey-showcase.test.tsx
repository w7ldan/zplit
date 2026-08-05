import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JourneyShowcase } from "./journey-showcase";

afterEach(() => vi.unstubAllGlobals());

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value });
}

function mediaQuery({ desktop = false, tall = false, reduced = false } = {}) {
  return (query: string) => ({
    matches: query === "(min-width: 960px)" ? desktop : query === "(min-height: 760px)" ? tall : reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe("JourneyShowcase", () => {
  it("renders exactly one complete scenario panel without a horizontal rail", () => {
    vi.stubGlobal("matchMedia", mediaQuery());
    render(<JourneyShowcase />);

    expect(document.querySelector(".journey-rail")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".journey-panel")).toHaveLength(1);
    expect(document.querySelectorAll(".journey-panel--active")).toHaveLength(1);
    expect(screen.getByText("Bandung day out", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Sunday, 12 April 2026", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("None yet", { exact: true })).toBeInTheDocument();

    const frame = document.querySelector(".journey-frame")!;
    expect(frame.getAttribute("style") ?? "").not.toMatch(/overflow-y|overflow: auto|overflow: scroll/);
  });

  it("maps runway progress deterministically in both directions and scrolls tabs to steps", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setScrollY(0);
    render(<JourneyShowcase />);

    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    Object.defineProperty(stage, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(runway, "offsetHeight", { configurable: true, value: 3000 });
    vi.spyOn(runway, "getBoundingClientRect").mockImplementation(() => ({ top: 100 - window.scrollY } as DOMRect));

    for (const step of [0, 1, 2, 3, 4]) {
      setScrollY(step * 600);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
      expect(document.querySelector(".journey-panel")).toHaveAttribute("data-journey-step", String(step));
      expect(screen.getAllByRole("tab")[step]).toHaveAttribute("aria-selected", "true");
    }

    setScrollY(3 * 600);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(document.querySelector(".journey-panel")).toHaveAttribute("data-journey-step", "3");

    fireEvent.click(screen.getByRole("tab", { name: /Expenses enter/ }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 700, behavior: "smooth" });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(document.querySelector(".journey-panel")).toHaveAttribute("data-journey-step", "1");
  });

  it("keeps keyboard controls functional in fallback mode", () => {
    vi.stubGlobal("matchMedia", mediaQuery());
    render(<JourneyShowcase />);
    const first = screen.getByRole("tab", { name: /An outing is created/ });

    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Expenses enter the outing/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /Expenses enter/ }), { key: "End" });
    expect(document.querySelector(".journey-panel")).toHaveAttribute("data-journey-step", "4");
    fireEvent.keyDown(screen.getByRole("tab", { name: /The balance becomes/ }), { key: "Home" });
    expect(document.querySelector(".journey-panel")).toHaveAttribute("data-journey-step", "0");
  });

  it.each([
    ["short viewports", { desktop: true, tall: false }],
    ["reduced motion", { desktop: true, tall: true, reduced: true }],
  ])("uses direct tab selection for %s", (_label, mode) => {
    vi.stubGlobal("matchMedia", mediaQuery(mode));
    render(<JourneyShowcase />);
    fireEvent.click(screen.getByRole("tab", { name: /A repayment is recorded/ }));
    expect(document.querySelectorAll(".journey-panel")).toHaveLength(1);
    expect(document.querySelector(".journey-panel")).toHaveAttribute("data-journey-step", "3");
    expect(screen.getByText("Rani pays back her shares", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Dinner share", { exact: true })).toBeInTheDocument();
  });

  it("does not intercept wheel or touch scrolling", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    const addEventListener = vi.spyOn(window, "addEventListener");
    render(<JourneyShowcase />);
    expect(addEventListener.mock.calls.some(([type]) => type === "wheel" || type === "touchmove")).toBe(false);
  });
});
