import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { TaskPanel } from "./task-panel";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/app/app/search/actions", () => ({ searchGlobalRecords: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function panel(open = true) {
  return (
    <TaskPanel open={open} title="Add a friend" description="Details" triggerId="friend-create">
      <form data-testid="panel-form">
        <label htmlFor="name">Name</label>
        <input id="name" />
      </form>
    </TaskPanel>
  );
}

describe("TaskPanel", () => {
  it("adds and removes product mode with the authenticated shell", () => {
    const { unmount } = render(<AppShell user={{ id: "user-a", name: "Wildan", email: "owner@example.com" }}><p>Content</p></AppShell>);

    expect(document.documentElement).toHaveClass("zplit-product-mode");
    unmount();
    expect(document.documentElement).not.toHaveClass("zplit-product-mode");
  });

  it("focuses the first field, closes through the button, and restores the fallback trigger", async () => {
    render(
      <>
        <a href="?create=1" data-task-trigger="friend-create">Add friend</a>
        {panel()}
      </>,
    );

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));

    expect(dialog).toHaveClass("task-panel--closing");
    expect(screen.getByRole("button", { name: "Close panel" })).toBeDisabled();
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(mocks.replace).not.toHaveBeenCalled();
    fireEvent.transitionEnd(dialog, { propertyName: "opacity" });
    fireEvent.animationEnd(dialog);
    expect((dialog as HTMLDialogElement).open).toBe(true);
    fireEvent.transitionEnd(dialog, { propertyName: "transform" });
    fireEvent.transitionEnd(dialog, { propertyName: "transform" });
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(screen.getByRole("link", { name: "Add friend" })).toHaveFocus();
    expect(mocks.replace).toHaveBeenCalledWith("/", { scroll: false });
  });

  it("restores the exact focused trigger when selectors are duplicated", async () => {
    const first = <button type="button" data-task-trigger="friend-create">First</button>;
    const second = <button type="button" data-task-trigger="friend-create">Second</button>;
    const Wrapper = ({ open }: { open: boolean }) => <>{first}{second}{panel(open)}</>;
    const view = render(<Wrapper open={false} />);
    const secondTrigger = screen.getByRole("button", { name: "Second" });
    secondTrigger.focus();
    view.rerender(<Wrapper open />);

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    fireEvent.transitionEnd(screen.getByRole("dialog"), { propertyName: "transform" });

    expect(secondTrigger).toHaveFocus();
  });

  it("preserves unrelated query parameters while closing and can reopen", async () => {
    window.history.replaceState({}, "", "/app/friends?create=1&q=alice#top");
    const Wrapper = ({ open }: { open: boolean }) => open ? panel() : null;
    const view = render(<Wrapper open />);

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    fireEvent.transitionEnd(screen.getByRole("dialog"), { propertyName: "transform" });
    expect(mocks.replace).toHaveBeenCalledWith("/app/friends?q=alice#top", { scroll: false });

    view.rerender(<Wrapper open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<Wrapper open />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  it("dismisses through Escape and backdrop clicks", async () => {
    const view = render(panel());
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    fireEvent.transitionEnd(dialog, { propertyName: "transform" });
    expect((dialog as HTMLDialogElement).open).toBe(false);

    view.rerender(panel(false));
    view.rerender(panel(true));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    const backdropDialog = screen.getByRole("dialog");
    fireEvent.click(backdropDialog);
    fireEvent.transitionEnd(backdropDialog, { propertyName: "transform" });
    expect((backdropDialog as HTMLDialogElement).open).toBe(false);
  });

  it("ignores duplicate close requests and finalizes through the bounded fallback", async () => {
    vi.useFakeTimers();
    render(panel());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));

    expect(mocks.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(260));
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(mocks.replace).toHaveBeenCalledOnce();
  });

  it("finalizes on the next frame without spatial motion when reduced motion is requested", async () => {
    vi.useFakeTimers();
    let frameCallback: FrameRequestCallback | null = null;
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frameCallback = callback; return 1; });
    render(panel());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(mocks.replace).not.toHaveBeenCalled();
    act(() => frameCallback?.(1));
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(mocks.replace).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(260));
    expect(mocks.replace).toHaveBeenCalledOnce();
  });

  it("prevents submission while closing", async () => {
    render(panel());
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));

    const event = new Event("submit", { bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId("panel-form"), event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("cancels delayed finalization when unmounted", () => {
    vi.useFakeTimers();
    const view = render(panel());
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    view.unmount();

    act(() => vi.advanceTimersByTime(260));
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("resets a mounted panel before opening it again", async () => {
    const Wrapper = ({ open }: { open: boolean }) => panel(open);
    const view = render(<Wrapper open />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    const dialog = screen.getByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    fireEvent.transitionEnd(dialog, { propertyName: "transform" });
    view.rerender(<Wrapper open={false} />);
    view.rerender(<Wrapper open />);

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    expect(dialog).not.toHaveClass("task-panel--closing");
    expect(screen.getByRole("button", { name: "Close panel" })).not.toBeDisabled();
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });
});
