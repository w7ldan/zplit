import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinedConfirmation } from "./joined-confirmation";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), router: { replace: vi.fn() } }));
mocks.router.replace = mocks.replace;

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

describe("JoinedConfirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/login?joined=1&next=ledger#top");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("consumes only joined while preserving other URL state", () => {
    render(<JoinedConfirmation active />);
    expect(mocks.replace).toHaveBeenCalledWith("/login?next=ledger#top", { scroll: false });
    expect(screen.getByRole("status")).toHaveTextContent("Your account is ready. Sign in to open your ledger.");
  });

  it("hides after four seconds and clears its timer", () => {
    const view = render(<JoinedConfirmation active />);
    const status = screen.getByRole("status");
    act(() => vi.advanceTimersByTime(4000));
    expect(status).toHaveStyle({ visibility: "hidden" });
    view.unmount();
    act(() => vi.advanceTimersByTime(4000));
    expect(mocks.replace).toHaveBeenCalledOnce();
  });
});
