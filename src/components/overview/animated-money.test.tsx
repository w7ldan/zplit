import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRupiah } from "@/domain/rupiah";
import { AnimatedMoney } from "./animated-money";

afterEach(() => vi.unstubAllGlobals());

describe("AnimatedMoney", () => {
  it("renders the canonical formatted amount accessibly", () => {
    render(<AnimatedMoney amount={2450000} label="Still owed" />);

    expect(screen.getByText(formatRupiah(2450000))).toBeInTheDocument();
    expect(screen.getByLabelText(`Still owed: ${formatRupiah(2450000)}`)).toBeInTheDocument();
    expect(screen.getByLabelText(`Still owed: ${formatRupiah(2450000)}`)).not.toHaveAttribute("aria-live");
  });

  it("keeps the static formatted value in the layout contract", () => {
    const { container } = render(<AnimatedMoney amount={2450000} animate={false} />);

    expect(container.querySelector(".animated-money__static")).toHaveTextContent(formatRupiah(2450000));
  });

  it("updates the final readable value when the amount changes", () => {
    const view = render(<AnimatedMoney amount={350000} />);

    view.rerender(<AnimatedMoney amount={8900000} />);

    expect(screen.getByText(formatRupiah(8900000))).toBeInTheDocument();
    expect(screen.queryByText(formatRupiah(350000))).not.toBeInTheDocument();
  });

  it("animates each digit in its own stable reel", () => {
    const originalAnimate = HTMLElement.prototype.animate;
    const animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() } as unknown as Animation));
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });

    try {
      const view = render(<AnimatedMoney amount={100} animate={false} />);
      view.rerender(<AnimatedMoney amount={2450000} />);
      const reels = [...view.container.querySelectorAll("[data-money-reel]")];

      expect(reels).toHaveLength(7);
      expect(animate).toHaveBeenCalledTimes(7);
      const firstCall = animate.mock.calls[0] as unknown as [unknown];
      expect(firstCall?.[0]).toEqual([
        { transform: "translate3d(0, -0em, 0)" },
        { transform: "translate3d(0, -2.2em, 0)" },
      ]);
    } finally {
      if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: originalAnimate });
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  it("settles every digit reel immediately when reduced motion is preferred", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener,
      addListener: vi.fn(),
      removeEventListener,
      removeListener: vi.fn(),
    })));

    const view = render(<AnimatedMoney amount={84000} animate />);

    expect(screen.getByText(formatRupiah(84000))).toBeInTheDocument();
    const reels = [...view.container.querySelectorAll<HTMLElement>("[data-money-reel]")];
    expect(reels).toHaveLength(5);
    expect(reels.at(-1)?.style.transform).toBe("translate3d(0, -0em, 0)");
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
