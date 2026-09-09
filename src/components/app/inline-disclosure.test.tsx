import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineDisclosure } from "./inline-disclosure";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Disclosure({ open }: { open: boolean }) {
  return (
    <InlineDisclosure open={open}>
      <p>Disclosure content</p>
    </InlineDisclosure>
  );
}

describe("InlineDisclosure", () => {
  it("starts closed and mounts content when opened", () => {
    const view = render(<Disclosure open={false} />);
    expect(screen.queryByText("Disclosure content")).not.toBeInTheDocument();

    view.rerender(<Disclosure open />);
    expect(screen.getByText("Disclosure content")).toBeInTheDocument();
    expect(screen.getByText("Disclosure content").parentElement).toHaveAttribute("data-inline-disclosure-state", "open");
  });

  it("keeps content present until the normal exit transition completes", () => {
    const view = render(<Disclosure open />);
    const disclosure = screen.getByText("Disclosure content").parentElement!;

    view.rerender(<Disclosure open={false} />);
    expect(screen.getByText("Disclosure content")).toBeInTheDocument();
    expect(disclosure).toHaveAttribute("data-inline-disclosure-state", "closing");

    fireEvent.transitionEnd(disclosure, { propertyName: "opacity" });
    expect(screen.queryByText("Disclosure content")).not.toBeInTheDocument();
  });

  it("cancels a pending exit when rapidly reopened", () => {
    vi.useFakeTimers();
    const view = render(<Disclosure open />);
    view.rerender(<Disclosure open={false} />);
    view.rerender(<Disclosure open />);

    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText("Disclosure content")).toBeInTheDocument();
    expect(screen.getByText("Disclosure content").parentElement).toHaveAttribute("data-inline-disclosure-state", "open");
  });

  it("uses the immediate reduced-motion handoff and cleans up on unmount", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const view = render(<Disclosure open />);
    view.rerender(<Disclosure open={false} />);
    expect(screen.getByText("Disclosure content")).toBeInTheDocument();

    act(() => vi.runAllTimers());
    expect(screen.queryByText("Disclosure content")).not.toBeInTheDocument();

    const mounted = render(<Disclosure open />);
    mounted.rerender(<Disclosure open={false} />);
    mounted.unmount();
    expect(() => act(() => vi.runAllTimers())).not.toThrow();
  });
});
