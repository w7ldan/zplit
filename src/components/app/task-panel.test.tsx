import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

function panel(open = true) {
  return (
    <TaskPanel open={open} title="Add a friend" description="Details" triggerId="friend-create">
      <label htmlFor="name">Name</label>
      <input id="name" />
    </TaskPanel>
  );
}

describe("TaskPanel", () => {
  it("adds and removes product mode with the authenticated shell", () => {
    const { unmount } = render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Content</p></AppShell>);

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

    expect(secondTrigger).toHaveFocus();
  });

  it("preserves unrelated query parameters while closing and can reopen", async () => {
    window.history.replaceState({}, "", "/app/friends?create=1&q=alice#top");
    const Wrapper = ({ open }: { open: boolean }) => open ? panel() : null;
    const view = render(<Wrapper open />);

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
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
    expect((dialog as HTMLDialogElement).open).toBe(false);

    view.rerender(panel(false));
    view.rerender(panel(true));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    const backdropDialog = screen.getByRole("dialog");
    fireEvent.click(backdropDialog);
    expect((backdropDialog as HTMLDialogElement).open).toBe(false);
  });
});
