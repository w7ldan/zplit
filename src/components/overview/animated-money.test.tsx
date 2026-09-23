import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRupiah } from "@/domain/rupiah";
import { AnimatedMoney } from "./animated-money";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AnimatedMoney", () => {
  it("starts settled with the final formatted value and exact accessible label", () => {
    const { container } = render(<AnimatedMoney amount={2450000} label="Still owed" />);
    const money = container.querySelector<HTMLElement>(".animated-money")!;

    expect(screen.getByText(formatRupiah(2450000))).toBeInTheDocument();
    expect(screen.getByLabelText(`Still owed: ${formatRupiah(2450000)}`)).toBeInTheDocument();
    expect(money).toHaveAttribute("data-animating", "false");
    expect(money.querySelectorAll(":scope > span")).toHaveLength(1);
    expect(money.querySelector(".animated-money__visual")).not.toBeInTheDocument();
    expect(money.querySelector("[data-money-reel]")).not.toBeInTheDocument();
  });

  it("keeps static text as the layout authority through a real amount update", () => {
    vi.useFakeTimers();
    const view = render(<AnimatedMoney amount={350000} />);
    const money = view.container.querySelector<HTMLElement>(".animated-money")!;
    const staticText = money.querySelector<HTMLElement>(".animated-money__static")!;

    view.rerender(<AnimatedMoney amount={8900000} />);
    act(() => vi.advanceTimersByTime(20));

    expect(money).toHaveAttribute("data-animating", "true");
    expect(money.querySelector(".animated-money__static")).toBe(staticText);
    expect(staticText).toHaveTextContent(formatRupiah(8900000));
    expect(money.children).toHaveLength(1);
    expect(money).toHaveAttribute("aria-label", formatRupiah(8900000));

    act(() => vi.advanceTimersByTime(180));

    expect(money).toHaveAttribute("data-animating", "false");
    expect(money.querySelector(".animated-money__static")).toBe(staticText);
    expect(money.children).toHaveLength(1);
  });

  it("does not animate initial or changed values under reduced motion", () => {
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    const view = render(<AnimatedMoney amount={84000} animate />);
    const money = view.container.querySelector<HTMLElement>(".animated-money")!;

    expect(money).toHaveAttribute("data-animating", "false");
    view.rerender(<AnimatedMoney amount={92000} animate />);
    expect(money).toHaveAttribute("data-animating", "false");
    expect(money).toHaveAttribute("aria-label", formatRupiah(92000));
    expect(media.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("stops an update transition when reduced motion becomes active", () => {
    vi.useFakeTimers();
    const listeners: Array<() => void> = [];
    const media = {
      matches: false,
      addEventListener: vi.fn((_event: string, listener: () => void) => { listeners.push(listener); }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    const view = render(<AnimatedMoney amount={100} />);
    const money = view.container.querySelector<HTMLElement>(".animated-money")!;
    view.rerender(<AnimatedMoney amount={200} />);
    act(() => vi.advanceTimersByTime(20));
    expect(money).toHaveAttribute("data-animating", "true");

    act(() => {
      media.matches = true;
      listeners.forEach((listener) => listener());
    });

    expect(money).toHaveAttribute("data-animating", "false");
  });
});
