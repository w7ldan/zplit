import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductJourney } from "./product-journey";

afterEach(() => vi.unstubAllGlobals());

function mediaQuery(matches: boolean) {
  return { matches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

describe("ProductJourney", () => {
  it("keeps the five panels in logical order and supports direct keyboard selection", () => {
    render(<ProductJourney />);
    expect([...document.querySelectorAll("[data-journey-step]")].map((panel) => panel.textContent?.match(/Outing record|Expense rows|Manual share assignment|Repayment record|Friend balances/)?.[0])).toEqual([
      "Outing record",
      "Expense rows",
      "Manual share assignment",
      "Repayment record",
      "Friend balances",
    ]);
    const first = screen.getByRole("tab", { name: /An outing is created/ });
    first.focus();
    act(() => first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(screen.getByRole("tab", { name: /The balance becomes settled/ })).toHaveAttribute("aria-selected", "true");
  });

  it("advances desktop progress through passive scroll frames", () => {
    vi.stubGlobal("matchMedia", (query: string) => mediaQuery(query === "(min-width: 960px)"));
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    render(<ProductJourney />);
    const runway = document.querySelector(".journey-runway")!;
    const rail = document.querySelector(".journey-rail")! as HTMLElement;
    Object.defineProperty(runway, "offsetHeight", { configurable: true, value: 1000 });
    vi.spyOn(runway, "getBoundingClientRect").mockReturnValue({ top: -250 } as DOMRect);
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frame?.(1));
    expect(rail.style.getPropertyValue("--journey-progress")).toBe("0.5000");
    expect(screen.getByRole("tab", { name: /Friend shares are assigned/ })).toHaveAttribute("aria-selected", "true");
  });

  it("leaves mobile and reduced-motion layouts outside the scroll-linked sequence", () => {
    vi.stubGlobal("matchMedia", (query: string) => mediaQuery(query === "(prefers-reduced-motion: reduce)"));
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    render(<ProductJourney />);
    const rail = document.querySelector(".journey-rail") as HTMLElement;
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(rail.style.getPropertyValue("--journey-offset")).toBe("");
    expect(document.querySelectorAll("[data-journey-step]")).toHaveLength(5);
  });
});
