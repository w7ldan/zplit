import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JourneyShowcase } from "./journey-showcase";

const defaultInnerHeight = window.innerHeight;
const pinnedStageHeight = 600;
const viewportHeight = 900;
const stepTravel = 495;
const runwayHeight = 2580;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: defaultInnerHeight });
});

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value });
}

function setInnerHeight(value: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value });
}

function mockPinnedGeometry(runway: HTMLElement, stage: HTMLElement, height = pinnedStageHeight) {
  Object.defineProperty(stage, "offsetHeight", { configurable: true, value: height });
  Object.defineProperty(runway, "offsetHeight", { configurable: true, get: () => Number.parseFloat(runway.style.height) || 0 });
  vi.spyOn(runway, "getBoundingClientRect").mockImplementation(() => ({ top: 100 - window.scrollY } as DOMRect));
}

function mediaQuery({ desktop = false, tall = false, reduced = false }: { desktop?: boolean; tall?: boolean | (() => boolean); reduced?: boolean } = {}) {
  return (query: string) => ({
    get matches() {
      const value = query === "(min-width: 960px)" ? desktop : query === "(min-height: 720px)" ? tall : reduced;
      return typeof value === "function" ? value() : value;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

function sceneSection(name: string) {
  return document.querySelector<HTMLElement>(`.journey-scene__${name}`)!;
}

describe("JourneyShowcase", () => {
  it("mounts one persistent scene with the outing identity ready for expenses", () => {
    vi.stubGlobal("matchMedia", mediaQuery());
    render(<JourneyShowcase />);

    const editorial = document.querySelector(".journey-editorial")!;
    const runway = document.querySelector(".journey-runway")!;
    const scene = document.querySelector(".journey-panel")!;
    expect(editorial.querySelector(".section-heading")).toHaveTextContent("From one outing to a balance you can settle.");
    expect(editorial.querySelector(".section-intro")).toBeInTheDocument();
    expect(runway.querySelector(".section-heading")).not.toBeInTheDocument();
    expect(runway.querySelector(".section-intro")).not.toBeInTheDocument();
    expect(runway.querySelector(".journey-tabs")).toBeInTheDocument();
    expect(runway.querySelector(".journey-frame")).toBeInTheDocument();
    expect(document.querySelector(".journey-rail")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".journey-panel")).toHaveLength(1);
    expect(scene.querySelectorAll(".journey-scene__body > *")).toHaveLength(2);
    expect(scene.querySelector(".journey-scene__main")).toBeInTheDocument();
    expect(scene.querySelector(".journey-scene__summary")).toBeInTheDocument();
    expect(scene.querySelector('[data-expense="Dinner"]')).toBeInTheDocument();
    expect(scene.querySelector('[data-expense="Taxi"]')).toBeInTheDocument();
    expect(screen.getByText("Bandung day out", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Sunday, 12 April 2026", { exact: true })).toBeInTheDocument();
    expect(within(scene.querySelector(".journey-scene__outing")!).getByText("None yet", { exact: true })).toBeInTheDocument();
    expect(sceneSection("expenses")).toHaveAttribute("data-visible", "false");
    expect(sceneSection("expenses")).toHaveAttribute("data-layout", "collapsed");
    expect(sceneSection("expenses").querySelectorAll('.journey-expense-row__shares[data-layout="collapsed"]')).toHaveLength(2);
    expect(sceneSection("expenses").querySelector(".journey-allocation")).toHaveAttribute("data-layout", "collapsed");
    expect(sceneSection("repayment")).toHaveAttribute("aria-hidden", "true");
    expect(sceneSection("repayment")).toHaveAttribute("data-layout", "collapsed");
    expect(sceneSection("repayment").querySelector(".journey-repayment__allocation")).toHaveAttribute("data-progress", "zero");
    expect(sceneSection("repayment").querySelector("[role=progressbar]")).toHaveAttribute("aria-valuenow", "0");
    expect(sceneSection("balances")).toHaveAttribute("aria-hidden", "true");
    expect(sceneSection("balances")).toHaveAttribute("data-layout", "collapsed");
    expect(scene.querySelectorAll("[data-summary-slot]")).toHaveLength(2);
    expect(scene.querySelector('[data-summary-slot="totals"]')).toBeInTheDocument();
    expect(scene.querySelector('[data-summary-slot="state"]')).toContainElement(sceneSection("repayment"));
    expect(scene.querySelector('[data-summary-slot="state"]')).toContainElement(sceneSection("balances"));
  });

  it("progressively reveals the same expenses, shares, repayment, and balances in both directions", () => {
    vi.stubGlobal("matchMedia", mediaQuery());
    render(<JourneyShowcase />);
    const scene = document.querySelector(".journey-panel")!;
    const dinner = scene.querySelector('[data-expense="Dinner"]')!;
    const taxi = scene.querySelector('[data-expense="Taxi"]')!;
    const dinnerShares = dinner.querySelector(".journey-expense-row__shares")!;
    const taxiShares = taxi.querySelector(".journey-expense-row__shares")!;

    fireEvent.click(screen.getByRole("tab", { name: /Expenses enter/ }));
    expect(document.querySelector(".journey-panel")).toBe(scene);
    expect(scene.querySelector('[data-expense="Dinner"]')).toBe(dinner);
    expect(scene.querySelector('[data-expense="Taxi"]')).toBe(taxi);
    expect(scene).toHaveAttribute("data-journey-step", "1");
    expect(sceneSection("expenses")).toHaveAttribute("data-visible", "true");
    expect(sceneSection("expenses")).toHaveAttribute("data-layout", "expanded");
    expect(sceneSection("expenses").querySelectorAll('.journey-expense-row__shares[data-layout="collapsed"]')).toHaveLength(2);
    expect(sceneSection("expenses").querySelector(".journey-allocation")).toHaveAttribute("data-layout", "collapsed");
    expect(within(sceneSection("expenses")).getByText("Dinner", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("expenses")).getByText("Taxi", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("expenses")).getByText("Rp 360.000", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Friend shares/ }));
    expect(document.querySelector(".journey-panel")).toBe(scene);
    expect(sceneSection("expenses")).toHaveAttribute("data-visible", "true");
    expect(sceneSection("expenses").querySelectorAll(".journey-expense-row")).toHaveLength(2);
    expect(sceneSection("expenses").querySelectorAll(".journey-expense-row__shares[data-visible=\"true\"]")).toHaveLength(2);
    expect(sceneSection("expenses").querySelectorAll('.journey-expense-row__shares[data-layout="expanded"]')).toHaveLength(2);
    expect(sceneSection("expenses").querySelector(".journey-allocation")).toHaveAttribute("data-layout", "expanded");
    expect(dinner.querySelector(".journey-expense-row__shares")).toBe(dinnerShares);
    expect(taxi.querySelector(".journey-expense-row__shares")).toBe(taxiShares);
    expect(within(scene.querySelector(".journey-scene__summary")!).getByText("Assigned to friends", { exact: true })).toBeInTheDocument();
    expect(within(scene.querySelector(".journey-scene__summary")!).getByText("Your portion", { exact: true })).toBeInTheDocument();
    expect(within(scene.querySelector(".journey-scene__summary")!).getByText("Rp 169.000", { exact: true })).toBeInTheDocument();
    expect(within(scene.querySelector(".journey-scene__summary")!).getByText("Rp 191.000", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("expenses")).getAllByText("Outstanding · not covered", { exact: true })).toHaveLength(3);
    expect(within(sceneSection("expenses")).queryByText("Covered by repayment", { exact: true })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /A repayment/ }));
    expect(document.querySelector(".journey-panel")).toBe(scene);
    expect(scene.querySelector('[data-expense="Dinner"]')).toBe(dinner);
    expect(scene.querySelector('[data-expense="Taxi"]')).toBe(taxi);
    expect(sceneSection("repayment")).toHaveAttribute("data-visible", "true");
    expect(sceneSection("repayment")).toHaveAttribute("data-layout", "expanded");
    expect(dinner.querySelector(".journey-expense-row__shares")).toBe(dinnerShares);
    expect(taxi.querySelector(".journey-expense-row__shares")).toBe(taxiShares);
    expect(within(sceneSection("repayment")).getByText("Rani repayment", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("expenses")).getAllByText("Covered by repayment", { exact: true })).toHaveLength(2);
    expect(within(sceneSection("expenses")).getAllByText("Outstanding · not covered", { exact: true })).toHaveLength(1);
    expect(screen.getAllByText("Rp 126.500", { exact: true }).length).toBeGreaterThan(0);
    const repayment = sceneSection("repayment");
    expect(within(repayment).getByText("Dinner applied", { exact: true })).toBeInTheDocument();
    expect(within(repayment).getByText("Taxi applied", { exact: true })).toBeInTheDocument();
    expect(within(repayment).getByText("Needs allocation", { exact: true })).toBeInTheDocument();
    expect(within(repayment).getByRole("progressbar", { name: "Repayment allocation" })).toHaveAttribute("aria-valuenow", "126500");
    expect(repayment.querySelector(".journey-repayment__allocation")).toHaveAttribute("data-progress", "complete");

    fireEvent.click(screen.getByRole("tab", { name: /balance becomes/ }));
    expect(document.querySelector(".journey-panel")).toBe(scene);
    expect(scene.querySelector('[data-expense="Dinner"]')).toBe(dinner);
    expect(scene.querySelector('[data-expense="Taxi"]')).toBe(taxi);
    expect(sceneSection("balances")).toHaveAttribute("data-visible", "true");
    expect(sceneSection("balances")).toHaveAttribute("data-layout", "expanded");
    expect(sceneSection("repayment")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("SETTLED", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("balances")).getByText("Rani", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("balances")).getByText("Dimas", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
    expect(within(sceneSection("expenses")).getAllByText("Outstanding · not covered", { exact: true })).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: /Friend shares/ }));
    expect(document.querySelector(".journey-panel")).toBe(scene);
    expect(scene).toHaveAttribute("data-journey-step", "2");
    expect(sceneSection("repayment")).toHaveAttribute("aria-hidden", "true");
    expect(sceneSection("balances")).toHaveAttribute("aria-hidden", "true");
    expect(sceneSection("repayment")).toHaveAttribute("data-layout", "collapsed");
    expect(sceneSection("balances")).toHaveAttribute("data-layout", "collapsed");
    expect(within(sceneSection("expenses")).getAllByText("Outstanding · not covered", { exact: true })).toHaveLength(3);
    expect(within(sceneSection("expenses")).queryByText("Covered by repayment", { exact: true })).not.toBeInTheDocument();
    expect(sceneSection("repayment").querySelector(".journey-repayment__allocation")).toHaveAttribute("data-progress", "zero");
    expect(sceneSection("repayment").querySelector("[role=progressbar]")).toHaveAttribute("aria-valuenow", "0");
    expect(scene.querySelectorAll(".journey-scene__body > *")).toHaveLength(2);
  });

  it("keeps the pinned runway through active-step growth", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    setInnerHeight(viewportHeight);
    let frame: FrameRequestCallback | undefined;
    let visibleStageHeight = 600;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setScrollY(0);
    render(<JourneyShowcase />);

    const scene = document.querySelector(".journey-panel")!;
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    Object.defineProperty(stage, "offsetHeight", { configurable: true, get: () => visibleStageHeight });
    Object.defineProperty(runway, "offsetHeight", { configurable: true, get: () => Number.parseFloat(runway.style.height) || 0 });
    vi.spyOn(runway, "getBoundingClientRect").mockImplementation(() => ({ top: 100 - window.scrollY } as DOMRect));
    act(() => window.dispatchEvent(new Event("resize")));
    const capturedRunwayHeight = runway.style.height;
    expect(stage).toHaveClass("journey-sticky--pinned");
    expect(capturedRunwayHeight).toBe(`${runwayHeight}px`);

    for (const [step, growth] of [0, 1, 2, 3, 4].map((step) => [step, 600 + step * 300] as const)) {
      visibleStageHeight = growth;
      act(() => window.dispatchEvent(new Event("resize")));
      setScrollY(100 + step * stepTravel);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
      expect(stage).toHaveClass("journey-sticky--pinned");
      expect(runway.style.height).toBe(capturedRunwayHeight);
      expect(scene).toHaveAttribute("data-journey-step", String(step));
    }

    expect(screen.getAllByRole("tab")[4]).toHaveAttribute("aria-selected", "true");
  });

  it("keeps future mobile regions collapsed until their step", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ tall: true }));
    render(<JourneyShowcase />);
    expect(sceneSection("expenses")).toHaveAttribute("data-layout", "collapsed");
    expect(sceneSection("repayment")).toHaveAttribute("data-layout", "collapsed");
    expect(sceneSection("balances")).toHaveAttribute("data-layout", "collapsed");

    fireEvent.click(screen.getByRole("tab", { name: /Friend shares/ }));
    expect(sceneSection("expenses")).toHaveAttribute("data-layout", "expanded");
    expect(sceneSection("repayment")).toHaveAttribute("data-layout", "collapsed");
    expect(sceneSection("balances")).toHaveAttribute("data-layout", "collapsed");
  });

  it("maps scroll progress, resize reconciliation, and tab selection without replacing the scene", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    setInnerHeight(viewportHeight);
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setScrollY(0);
    render(<JourneyShowcase />);

    const scene = document.querySelector(".journey-panel")!;
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(stage).toHaveClass("journey-sticky--pinned");
    expect(runway.style.height).toBe(`${runwayHeight}px`);

    for (const step of [0, 1, 2, 3, 4]) {
      setScrollY(100 + step * stepTravel);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
      expect(document.querySelector(".journey-panel")).toBe(scene);
      expect(scene).toHaveAttribute("data-journey-step", String(step));
      expect(screen.getAllByRole("tab")[step]).toHaveAttribute("aria-selected", "true");
    }

    act(() => window.dispatchEvent(new Event("resize")));
    act(() => frame?.(1));
    for (const step of [0, 1, 2, 3, 4]) {
      fireEvent.click(screen.getAllByRole("tab")[step]);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 100 + step * stepTravel, behavior: "smooth" });
      expect(scene).toHaveAttribute("data-journey-step", String(step));
    }
  });

  it("keeps arrow-key tab controls functional in fallback mode", () => {
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
    expect(sceneSection("repayment")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("Rani repayment", { exact: true })).toBeInTheDocument();
  });

  it("keeps short desktop and mobile journeys in normal flow", () => {
    for (const mode of [{ desktop: true, tall: false }, { desktop: false, tall: true }]) {
      vi.stubGlobal("matchMedia", mediaQuery(mode));
      const { unmount } = render(<JourneyShowcase />);
      expect(document.querySelector(".journey-sticky")).not.toHaveClass("journey-sticky--pinned");
      expect(document.querySelector(".journey-frame")).not.toHaveStyle({ overflowY: "auto" });
      unmount();
    }
  });

  it("re-enables pinned mode after a short viewport and clears its runway height", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: () => window.innerHeight >= 720 }));
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setInnerHeight(viewportHeight);
    setScrollY(0);
    render(<JourneyShowcase />);

    const scene = document.querySelector(".journey-panel")!;
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    mockPinnedGeometry(runway, stage);

    act(() => window.dispatchEvent(new Event("resize")));
    expect(stage).toHaveClass("journey-sticky--pinned");
    expect(runway.style.height).toBe(`${runwayHeight}px`);

    setInnerHeight(1000);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(runway.style.height).toBe("2800px");

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(stage).not.toHaveClass("journey-sticky--pinned");
    expect(runway.style.height).toBe("");

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(stage).toHaveClass("journey-sticky--pinned");
    expect(runway.style.height).toBe(`${runwayHeight}px`);

    setScrollY(1300);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(scene).toHaveAttribute("data-journey-step", "2");
  });

  it("does not intercept wheel or touch scrolling", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    const addEventListener = vi.spyOn(window, "addEventListener");
    render(<JourneyShowcase />);
    expect(addEventListener.mock.calls.some(([type]) => type === "wheel" || type === "touchmove")).toBe(false);
  });
});
