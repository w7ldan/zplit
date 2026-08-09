import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JOURNEY_MAGNET_RADIUS_RATIO, JOURNEY_SCROLL_IDLE_MS, JOURNEY_STEP_TRAVEL_RATIO, JOURNEY_TRANSITION_HOLD, JourneyShowcase, journeyTransitionProgress } from "./journey-showcase";

const defaultInnerHeight = window.innerHeight;
const pinnedStageHeight = 600;
const viewportHeight = 900;
const stepTravel = 378;
const sequenceTravel = 1512;
const runwayHeight = 2112;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  it("uses a 0.42 runway with a 0.10 symmetric visual hold", () => {
    expect(JOURNEY_STEP_TRAVEL_RATIO).toBe(0.42);
    expect(JOURNEY_TRANSITION_HOLD).toBe(0.1);
    expect(viewportHeight * JOURNEY_STEP_TRAVEL_RATIO).toBe(stepTravel);
    expect(stepTravel * 4).toBe(sequenceTravel);
    expect(journeyTransitionProgress(0)).toBe(0);
    expect(journeyTransitionProgress(0.1)).toBe(0);
    expect(journeyTransitionProgress(0.5)).toBe(0.5);
    expect(journeyTransitionProgress(0.9)).toBe(1);
    expect(journeyTransitionProgress(1)).toBe(1);
    for (const progress of [0.2, 0.35, 0.65, 0.8]) {
      expect(journeyTransitionProgress(progress) + journeyTransitionProgress(1 - progress)).toBeCloseTo(1);
    }
  });

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
    expect(within(scene.querySelector(".journey-scene__outing")!).getByText("Bandung day out", { exact: true })).toBeInTheDocument();
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
    expect(sceneSection("repayment")).toHaveTextContent("Rani repaymentReceived and ready to allocateRp 126.500");
    expect(sceneSection("repayment")).toHaveTextContent("Repayment allocationRp 126.500");
    expect(sceneSection("repayment")).toHaveTextContent("ReceivedRp 126.500");
    expect(sceneSection("repayment")).toHaveTextContent("AppliedRp 126.500");
    expect(sceneSection("repayment")).toHaveTextContent("Dinner appliedRp 84.000");
    expect(sceneSection("repayment")).toHaveTextContent("Taxi appliedRp 42.500");
    expect(sceneSection("repayment")).toHaveTextContent("Needs allocationRp 0");
    expect(sceneSection("balances")).toHaveAttribute("aria-hidden", "true");
    expect(sceneSection("balances")).toHaveAttribute("data-layout", "collapsed");
    expect(scene.querySelectorAll("[data-summary-slot]")).toHaveLength(2);
    expect(scene.querySelector('[data-summary-slot="totals"]')).toBeInTheDocument();
    expect(scene.querySelector('[data-summary-slot="state"]')).toContainElement(sceneSection("repayment"));
    expect(scene.querySelector('[data-summary-slot="state"]')).toContainElement(sceneSection("balances"));
  });

  it("adds a decorative desktop connector layer for the causal relationships", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    setInnerHeight(viewportHeight);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<JourneyShowcase />);

    const svg = document.querySelector<SVGSVGElement>("[data-journey-connectors]")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-journey-connectors", "desktop");
    expect(svg.textContent).toBe("");
    expect([...svg.querySelectorAll("path")].map((path) => path.getAttribute("data-relationship"))).toEqual([
      "dinner-rani",
      "dinner-dimas",
      "taxi-rani",
      "repayment-dinner-rani",
      "repayment-taxi-rani",
    ]);
    for (const node of ["expense-dinner", "dinner-rani", "dinner-dimas", "expense-taxi", "taxi-rani", "repayment-rani"]) {
      expect(document.querySelector(`[data-connector-node="${node}"]`)).toBeInTheDocument();
    }
  });

  it("reveals, reverses, and clears connectors from existing Journey progress without per-scroll geometry reads", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    setInnerHeight(viewportHeight);
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setScrollY(100);
    render(<JourneyShowcase />);

    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    const frameElement = document.querySelector(".journey-frame")! as HTMLElement;
    const scene = document.querySelector(".journey-panel")!;
    mockPinnedGeometry(runway, stage);
    vi.spyOn(frameElement, "getBoundingClientRect").mockReturnValue({ left: 100, top: 100, width: 1000, height: 600 } as DOMRect);
    const nodeReads = [...document.querySelectorAll<HTMLElement>("[data-connector-node]")].map((node) => vi.spyOn(node, "getBoundingClientRect").mockReturnValue({ left: 200, right: 500, top: 200, height: 30 } as DOMRect));
    act(() => window.dispatchEvent(new Event("resize")));
    const readsAfterReconcile = nodeReads.map((spy) => spy.mock.calls.length);

    setScrollY(100 + 0.8 * stepTravel);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(stage.style.getPropertyValue("--journey-connector-share-progress")).toBe("0");
    expect(stage.style.getPropertyValue("--journey-connector-repayment-progress")).toBe("0");

    setScrollY(100 + 1.5 * stepTravel);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(stage.style.getPropertyValue("--journey-connector-share-progress")).toBe("0.5");
    expect(stage.style.getPropertyValue("--journey-connector-repayment-progress")).toBe("0");

    setScrollY(100 + 2.5 * stepTravel);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(stage.style.getPropertyValue("--journey-connector-share-progress")).toBe("0.5");
    expect(stage.style.getPropertyValue("--journey-connector-repayment-progress")).toBe("0.5");

    setScrollY(100 + 4 * stepTravel);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(stage.style.getPropertyValue("--journey-connector-share-progress")).toBe("0");
    expect(stage.style.getPropertyValue("--journey-connector-repayment-progress")).toBe("0");
    expect(nodeReads.map((spy) => spy.mock.calls.length)).toEqual(readsAfterReconcile);
    expect(scene).toHaveAttribute("data-journey-step", "4");
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

  it("settles near exact early and later chapters only after scroll becomes idle", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setInnerHeight(viewportHeight);
    setScrollY(0);
    render(<JourneyShowcase />);
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));

    setScrollY(100 + stepTravel + 25);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS - 20));
    setScrollY(100 + stepTravel + 30);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS - 1));
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 100 + stepTravel, behavior: "smooth" });

    act(() => vi.advanceTimersByTime(180));
    scrollTo.mockClear();
    setScrollY(100 + 3 * stepTravel - 30);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS));
    expect(scrollTo).toHaveBeenCalledWith({ top: 100 + 3 * stepTravel, behavior: "smooth" });
  });

  it("does not magnetize outside the radius or interrupt a continuing fast progression", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setInnerHeight(viewportHeight);
    setScrollY(0);
    render(<JourneyShowcase />);
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(JOURNEY_SCROLL_IDLE_MS).toBe(200);
    expect(stepTravel * JOURNEY_MAGNET_RADIUS_RATIO).toBeCloseTo(34.02);

    setScrollY(70);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS));
    expect(scrollTo).not.toHaveBeenCalled();

    for (const position of [100 + stepTravel + 30, 100 + 2 * stepTravel + 25, 100 + 3 * stepTravel + 20]) {
      setScrollY(position);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS - 1));
      expect(scrollTo).not.toHaveBeenCalled();
    }
    setScrollY(100 + 3 * stepTravel + 60);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("guards tab scrolling from magnetic feedback and cancels pending settlement on fallback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: () => window.innerHeight >= 720 }));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setInnerHeight(viewportHeight);
    setScrollY(0);
    render(<JourneyShowcase />);
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));

    fireEvent.click(screen.getAllByRole("tab")[3]);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS + 180));
    expect(scrollTo).toHaveBeenCalledTimes(1);

    scrollTo.mockClear();
    setScrollY(100 + stepTravel + 40);
    act(() => window.dispatchEvent(new Event("scroll")));
    setInnerHeight(500);
    act(() => window.dispatchEvent(new Event("resize")));
    act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("cancels a pending magnetic settlement on cleanup", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setInnerHeight(viewportHeight);
    setScrollY(0);
    const { unmount } = render(<JourneyShowcase />);
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));
    setScrollY(100 + stepTravel + 40);
    act(() => window.dispatchEvent(new Event("scroll")));
    unmount();
    act(() => vi.advanceTimersByTime(JOURNEY_SCROLL_IDLE_MS));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("maps continuous progress into four equal reversible transition ranges", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    setInnerHeight(viewportHeight);
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setScrollY(0);
    render(<JourneyShowcase />);

    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    const scene = document.querySelector(".journey-panel")!;
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(runway.style.height).toBe(`${pinnedStageHeight + sequenceTravel}px`);

    const samples = [
      [0, [0, 0, 0, 0], 0],
      [0.125, [0.5, 0, 0, 0], 1],
      [0.25, [1, 0, 0, 0], 1],
      [0.375, [1, 0.5, 0, 0], 2],
      [0.5, [1, 1, 0, 0], 2],
      [0.625, [1, 1, 0.5, 0], 3],
      [0.75, [1, 1, 1, 0], 3],
      [0.875, [1, 1, 1, 0.5], 4],
      [1, [1, 1, 1, 1], 4],
    ] as const;
    const properties = ["--journey-expense-progress", "--journey-share-progress", "--journey-repayment-progress", "--journey-balance-progress"];

    for (const [progress, locals, activeStep] of samples) {
      setScrollY(100 + progress * sequenceTravel);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
      expect(Number(stage.style.getPropertyValue("--journey-progress"))).toBeCloseTo(progress);
      properties.forEach((property, index) => expect(Number(stage.style.getPropertyValue(property))).toBeCloseTo(locals[index]));
      expect(scene).toHaveAttribute("data-journey-step", String(activeStep));
      expect(screen.getAllByRole("tab")[activeStep]).toHaveAttribute("aria-selected", "true");
    }

    for (const progress of [0.75, 0.5, 0.25, 0]) {
      setScrollY(100 + progress * sequenceTravel);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
      expect(Number(stage.style.getPropertyValue("--journey-progress"))).toBeCloseTo(progress);
    }
  });

  it("keeps the complete repayment visual available through continuous 03 to 04 progress", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    setInnerHeight(viewportHeight);
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setScrollY(0);
    render(<JourneyShowcase />);

    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    const repayment = sceneSection("repayment");
    const allocation = repayment.querySelector(".journey-repayment__allocation")!;
    const allocationBar = allocation.querySelector(".journey-allocation__track span")!;
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));

    for (const localProgress of [0, 0.25, 0.5, 0.75, 1]) {
      setScrollY(100 + (0.5 + localProgress / 4) * sequenceTravel);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
      expect(Number(stage.style.getPropertyValue("--journey-repayment-progress"))).toBeCloseTo(journeyTransitionProgress(localProgress));
      expect(sceneSection("repayment")).toBe(repayment);
      expect(repayment.querySelector(".journey-repayment__allocation")).toBe(allocation);
      expect(allocation.querySelector(".journey-allocation__track span")).toBe(allocationBar);
      expect(allocationBar).toHaveStyle({ "--repayment-allocation": "1" });
      expect(repayment).toHaveTextContent("ReceivedRp 126.500");
      expect(repayment).toHaveTextContent("AppliedRp 126.500");
    }
  });

  it("keeps one intact visual state slot while semantics switch from repayment to balances", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    setInnerHeight(viewportHeight);
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setScrollY(0);
    render(<JourneyShowcase />);

    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    const slot = document.querySelector('[data-summary-slot="state"]')!;
    const repayment = sceneSection("repayment");
    const balances = sceneSection("balances");
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));

    for (const localProgress of [0, 0.25, 0.5, 0.75, 1]) {
      setScrollY(100 + (0.75 + localProgress / 4) * sequenceTravel);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
      expect(slot).toContainElement(repayment);
      expect(slot).toContainElement(balances);
      expect(sceneSection("repayment")).toBe(repayment);
      expect(sceneSection("balances")).toBe(balances);
      expect(repayment).toHaveTextContent("Needs allocationRp 0");
      expect(balances).toHaveTextContent("Rani");
      expect(balances).toHaveTextContent("RemainingRp 0");
      expect(balances).toHaveTextContent("Dimas");
      expect(balances).toHaveTextContent("RemainingRp 42.500");
      expect(slot.querySelectorAll('[data-summary-state][aria-hidden="false"]')).toHaveLength(1);
      expect(Number(stage.style.getPropertyValue("--journey-balance-progress"))).toBeCloseTo(journeyTransitionProgress(localProgress));
      const balanceIsSemantic = localProgress >= 0.5;
      expect(repayment).toHaveAttribute("aria-hidden", String(balanceIsSemantic));
      expect(balances).toHaveAttribute("aria-hidden", String(!balanceIsSemantic));
    }
  });

  it("updates semantic DOM only when a chapter threshold changes", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    setInnerHeight(viewportHeight);
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setScrollY(100);
    render(<JourneyShowcase />);

    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    const scene = document.querySelector(".journey-panel")!;
    mockPinnedGeometry(runway, stage);
    act(() => window.dispatchEvent(new Event("resize")));
    const semanticUpdate = vi.spyOn(scene, "setAttribute");

    for (const progress of [0.02, 0.05, 0.1]) {
      setScrollY(100 + progress * sequenceTravel);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
    }
    expect(semanticUpdate).not.toHaveBeenCalledWith("data-journey-step", expect.anything());
    expect(screen.getByText(/01 \/ 05/)).toBeInTheDocument();

    setScrollY(100 + 0.125 * sequenceTravel);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(scene).toHaveAttribute("data-journey-step", "1");
    expect(screen.getByText(/02 \/ 05/)).toBeInTheDocument();
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
    expect(document.querySelector("[data-journey-connectors]")).not.toBeInTheDocument();
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
    expect(runway.style.height).toBe("2280px");

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(stage).not.toHaveClass("journey-sticky--pinned");
    expect(runway.style.height).toBe("");
    expect(stage.style.getPropertyValue("--journey-progress")).toBe("");

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(stage).toHaveClass("journey-sticky--pinned");
    expect(runway.style.height).toBe(`${runwayHeight}px`);
    expect(stage.style.getPropertyValue("--journey-progress")).not.toBe("");

    setScrollY(100 + 2 * stepTravel);
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
