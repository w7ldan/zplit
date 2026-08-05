import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FriendForm } from "./friend-form";

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
});
