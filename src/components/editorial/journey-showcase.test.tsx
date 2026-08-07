import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JourneyShowcase } from "./journey-showcase";

afterEach(() => vi.unstubAllGlobals());

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value });
}

function mediaQuery({ desktop = false, tall = false, reduced = false } = {}) {
  return (query: string) => ({
    matches: query === "(min-width: 960px)" ? desktop : query === "(min-height: 720px)" ? tall : reduced,
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
    expect(scene.querySelector(".journey-scene__body > .journey-scene__expenses")).not.toBeInTheDocument();
    expect(scene.querySelector(".journey-scene__body > .journey-scene__repayment")).not.toBeInTheDocument();
    expect(scene.querySelector(".journey-scene__body > .journey-scene__balances")).not.toBeInTheDocument();
    expect(screen.getByText("Bandung day out", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Sunday, 12 April 2026", { exact: true })).toBeInTheDocument();
    expect(within(scene.querySelector(".journey-scene__outing")!).getByText("None yet", { exact: true })).toBeInTheDocument();
    expect(sceneSection("expenses")).toHaveAttribute("data-visible", "false");
    expect(sceneSection("repayment")).toHaveAttribute("aria-hidden", "true");
    expect(sceneSection("repayment").querySelector(".journey-repayment__allocation")).toHaveAttribute("data-progress", "zero");
    expect(sceneSection("repayment").querySelector("[role=progressbar]")).toHaveAttribute("aria-valuenow", "0");
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
    expect(within(sceneSection("expenses")).getByText("Dinner", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("expenses")).getByText("Taxi", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("expenses")).getByText("Rp 360.000", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Friend shares/ }));
    expect(document.querySelector(".journey-panel")).toBe(scene);
    expect(sceneSection("expenses")).toHaveAttribute("data-visible", "true");
    expect(sceneSection("expenses").querySelectorAll(".journey-expense-row")).toHaveLength(2);
    expect(sceneSection("expenses").querySelectorAll(".journey-expense-row__shares[data-visible=\"true\"]")).toHaveLength(2);
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
    expect(screen.getByText("SETTLED", { exact: true })).toBeInTheDocument();
    expect(within(sceneSection("balances")).getByText("Dimas", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 42.500", { exact: true }).length).toBeGreaterThan(0);
    expect(within(sceneSection("expenses")).getAllByText("Outstanding · not covered", { exact: true })).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: /Friend shares/ }));
    expect(document.querySelector(".journey-panel")).toBe(scene);
    expect(scene).toHaveAttribute("data-journey-step", "2");
    expect(sceneSection("repayment")).toHaveAttribute("aria-hidden", "true");
    expect(sceneSection("balances")).toHaveAttribute("aria-hidden", "true");
    expect(within(sceneSection("expenses")).getAllByText("Outstanding · not covered", { exact: true })).toHaveLength(3);
    expect(within(sceneSection("expenses")).queryByText("Covered by repayment", { exact: true })).not.toBeInTheDocument();
    expect(sceneSection("repayment").querySelector(".journey-repayment__allocation")).toHaveAttribute("data-progress", "zero");
    expect(sceneSection("repayment").querySelector("[role=progressbar]")).toHaveAttribute("aria-valuenow", "0");
    expect(scene.querySelectorAll(".journey-scene__body > *")).toHaveLength(2);
  });

  it("maps scroll progress, resize reconciliation, and tab selection without replacing the scene", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setScrollY(0);
    render(<JourneyShowcase />);

    const scene = document.querySelector(".journey-panel")!;
    const runway = document.querySelector(".journey-runway")! as HTMLElement;
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    Object.defineProperty(stage, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(runway, "offsetHeight", { configurable: true, value: 3000 });
    vi.spyOn(runway, "getBoundingClientRect").mockImplementation(() => ({ top: 100 - window.scrollY } as DOMRect));

    for (const step of [0, 1, 2, 3, 4]) {
      setScrollY(step * 600);
      act(() => window.dispatchEvent(new Event("scroll")));
      act(() => frame?.(1));
      expect(document.querySelector(".journey-panel")).toBe(scene);
      expect(scene).toHaveAttribute("data-journey-step", String(step));
      expect(screen.getAllByRole("tab")[step]).toHaveAttribute("aria-selected", "true");
    }

    act(() => window.dispatchEvent(new Event("resize")));
    act(() => frame?.(1));
    fireEvent.click(screen.getByRole("tab", { name: /Expenses enter/ }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 700, behavior: "smooth" });
    expect(scene).toHaveAttribute("data-journey-step", "1");
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

  it("falls back when the natural interactive stage cannot fit", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    render(<JourneyShowcase />);
    const stage = document.querySelector(".journey-sticky")! as HTMLElement;
    Object.defineProperty(stage, "offsetHeight", { configurable: true, value: 700 });

    act(() => window.dispatchEvent(new Event("resize")));
    expect(stage).not.toHaveClass("journey-sticky--pinned");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  });

  it("does not intercept wheel or touch scrolling", () => {
    vi.stubGlobal("matchMedia", mediaQuery({ desktop: true, tall: true }));
    const addEventListener = vi.spyOn(window, "addEventListener");
    render(<JourneyShowcase />);
    expect(addEventListener.mock.calls.some(([type]) => type === "wheel" || type === "touchmove")).toBe(false);
  });
});
