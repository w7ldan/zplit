import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordConfirmation } from "./record-confirmation";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

describe("RecordConfirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/app/friends?created=friend-1&q=alice#top");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("consumes only its flag through client navigation", () => {
    render(<RecordConfirmation queryKey="created" message="Friend added." />);

    expect(mocks.replace).toHaveBeenCalledWith("/app/friends?q=alice#top", { scroll: false });
    expect(screen.getByRole("status")).toHaveTextContent("Friend added.");
  });

  it("hides after four seconds and clears its timer on unmount", () => {
    const view = render(<RecordConfirmation queryKey="created" message="Friend added." />);
    const status = screen.getByRole("status");

    act(() => vi.advanceTimersByTime(3999));
    expect(status).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(status).toHaveClass("record-confirmation--hidden");
    expect(status).toHaveAttribute("aria-hidden", "true");

    view.unmount();
    act(() => vi.advanceTimersByTime(4000));
    expect(mocks.replace).toHaveBeenCalledOnce();
  });
});
