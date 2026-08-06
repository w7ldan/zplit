import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FriendArchiveForm, FriendForm } from "./friend-form";
import { ToastProvider } from "@/components/feedback/toast";

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const initialFriendActionState = {
  fieldErrors: {},
  formError: "",
  values: { name: "", phoneNumber: "", notes: "" },
};

describe("FriendForm", () => {
  it("renders persistent labels and connected validation fields", () => {
    render(<FriendForm action={vi.fn().mockResolvedValue(initialFriendActionState)} />);

    for (const label of ["Name", "Phone number", "Notes"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-describedby", expect.stringContaining("friend-"));
    }
    expect(screen.getByRole("button", { name: "Add friend" })).toBeInTheDocument();
    expect(document.querySelectorAll(".friend-form__field-error")).toHaveLength(3);
    expect(document.querySelectorAll(".friend-form__message")).toHaveLength(1);
    expect(screen.getByLabelText("Country code")).toHaveValue("+62");
  });

  it("shows an explicit Other calling-code field without changing the stored form shape", () => {
    render(<FriendForm action={vi.fn().mockResolvedValue(initialFriendActionState)} />);
    fireEvent.change(screen.getByLabelText("Country code"), { target: { value: "other" } });
    expect(screen.getByLabelText("Other calling code")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveAttribute("name", "phoneNumber");
  });

  it("preserves entered values after a validation failure and exposes the field error", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialFriendActionState,
      fieldErrors: { name: "Name is required." },
      formError: "Please correct the marked fields.",
      values: { name: "Entered name", phoneNumber: "+62 1", notes: "Entered notes" },
    });
    render(<FriendForm action={action} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Entered name" } });
    fireEvent.click(screen.getByRole("button", { name: "Add friend" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(document.getElementById("friend-name-error")).toHaveTextContent("Name is required."));
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows an accessible pending state and prevents repeat submission", async () => {
    let resolveAction: (state: typeof initialFriendActionState) => void = () => {};
    const action = vi.fn().mockReturnValue(new Promise((resolve) => { resolveAction = resolve; }));
    render(<FriendForm action={action} />);
    const form = screen.getByRole("button", { name: "Add friend" }).closest("form");
    if (!form) throw new Error("friend form is missing");

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Adding friend…" })).toBeDisabled();
    resolveAction(initialFriendActionState);
  });

  it("archives immediately, announces it, and sends the versioned receipt to Undo", async () => {
    const receipt = { version: 1 as const, friendId: "friend-a", archivedAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:01.000Z" };
    const action = vi.fn().mockResolvedValue({ ...initialFriendActionState, archiveReceipt: receipt });
    const undoAction = vi.fn().mockResolvedValue({ ok: true });
    render(<ToastProvider><FriendArchiveForm action={action} archived={false} undoAction={undoAction} /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Archive friend" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Friend archived"));
    expect(action).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undoAction).toHaveBeenCalledWith(receipt));
    expect(router.refresh).toHaveBeenCalled();
  });
});
