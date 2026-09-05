import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";

const groupProps = {
  title: "Delete group?",
  entityName: "Bandung Trip",
  confirmLabel: "Delete group",
  pendingLabel: "Deleting group…",
};

const organizationProps = {
  title: "Delete organization?",
  entityName: "Studio",
  confirmLabel: "Delete organization",
  pendingLabel: "Deleting organization…",
};

describe.each([
  ["group", groupProps],
  ["organization", organizationProps],
] as const)("DeleteConfirmationDialog (%s)", (_kind, props) => {
  it("opens a named confirmation from the delete control without deleting", () => {
    const action = vi.fn();
    render(<DeleteConfirmationDialog {...props} action={action} />);

    expect(
      screen.getByRole("button", { name: props.confirmLabel }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: props.confirmLabel }));

    expect(action).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: props.title }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(props.entityName, { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: props.confirmLabel }),
    ).toBeInTheDocument();
  });

  it("cancels without deleting and restores trigger focus", () => {
    const action = vi.fn();
    render(<DeleteConfirmationDialog {...props} action={action} />);
    const trigger = screen.getByRole("button", { name: props.confirmLabel });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("dismisses through Escape and backdrop without deleting", () => {
    const action = vi.fn();
    render(<DeleteConfirmationDialog {...props} action={action} />);
    fireEvent.click(screen.getByRole("button", { name: props.confirmLabel }));

    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: props.confirmLabel }));
    const reopened = screen.getByRole("dialog");
    fireEvent.click(reopened);
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms exactly once with the existing action", async () => {
    const action = vi.fn(async () => {});
    render(<DeleteConfirmationDialog {...props} action={action} />);
    fireEvent.click(screen.getByRole("button", { name: props.confirmLabel }));

    const dialog = screen.getByRole("dialog");
    const form = within(dialog)
      .getByRole("button", { name: props.confirmLabel })
      .closest("form");
    if (!form) throw new Error("confirmation form is missing");
    fireEvent.submit(form);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows pending copy and keeps the confirmation disabled", async () => {
    let resolveAction: () => void = () => {};
    const action = vi
      .fn()
      .mockReturnValue(new Promise<void>((resolve) => { resolveAction = resolve; }));
    render(<DeleteConfirmationDialog {...props} action={action} />);
    fireEvent.click(screen.getByRole("button", { name: props.confirmLabel }));

    const dialog = screen.getByRole("dialog");
    const form = within(dialog)
      .getByRole("button", { name: props.confirmLabel })
      .closest("form");
    if (!form) throw new Error("confirmation form is missing");
    fireEvent.submit(form);

    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: props.pendingLabel }),
      ).toBeDisabled(),
    );
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();
    resolveAction();
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
  });
});
