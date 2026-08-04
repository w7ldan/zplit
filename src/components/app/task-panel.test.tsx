import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskPanel } from "./task-panel";

describe("TaskPanel", () => {
  it("focuses the first field, closes on Escape, and restores the trigger", async () => {
    render(
      <>
        <a href="?create=1" data-task-trigger="friend-create">Add friend</a>
        <TaskPanel open title="Add a friend" description="Details" triggerId="friend-create">
          <label htmlFor="name">Name</label>
          <input id="name" />
        </TaskPanel>
      </>,
    );

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(screen.getByRole("link", { name: "Add friend" })).toHaveFocus();
  });

  it("supports the native cancel event", async () => {
    render(<TaskPanel open title="Add a friend" description="Details" triggerId="friend-create"><input aria-label="Name" /></TaskPanel>);
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect((dialog as HTMLDialogElement).open).toBe(false);
  });
});
