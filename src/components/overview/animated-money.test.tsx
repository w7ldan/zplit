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

  it("updates the final readable value when the amount changes", () => {
    const view = render(<AnimatedMoney amount={350000} />);

    view.rerender(<AnimatedMoney amount={8900000} />);

    expect(screen.getByText(formatRupiah(8900000))).toBeInTheDocument();
    expect(screen.queryByText(formatRupiah(350000))).not.toBeInTheDocument();
  });

  it("settles reels immediately when reduced motion is preferred", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener,
      addListener: vi.fn(),
      removeEventListener,
      removeListener: vi.fn(),
    })));

    const view = render(<AnimatedMoney amount={84000} />);
    const reels = [...view.container.querySelectorAll<HTMLElement>("[data-money-reel]")];

    expect(screen.getByText(formatRupiah(84000))).toBeInTheDocument();
    expect(reels.at(-1)?.style.transform).toBe("translate3d(0, -0%, 0)");
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
