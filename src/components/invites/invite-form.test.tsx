import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InviteForm } from "./invite-form";

const initialState = {
  fieldErrors: {},
  formError: "",
  values: { email: "", suggestedName: "" },
  invitation: null,
};

describe("InviteForm", () => {
  it("renders bounded invite fields and returns a link after creation", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      invitation: { link: "https://zplit.example/join/token", email: "person@example.com", expiresAt: "2026-08-11T00:00:00.000Z" },
    });
    render(<InviteForm action={action} />);

    expect(screen.getByLabelText("Email address")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText(/Suggested name/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "person@example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create invitation" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText("Temporary invitation link")).toHaveValue("https://zplit.example/join/token"));
  });

  it("shows field errors returned by the action", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { email: "Enter a valid email address." },
      formError: "Please correct the marked fields.",
      values: { email: "bad", suggestedName: "" },
    });
    render(<InviteForm action={action} />);
    fireEvent.submit(screen.getByRole("button", { name: "Create invitation" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument());
    expect(screen.getByLabelText("Email address")).toHaveAttribute("aria-invalid", "true");
  });
});
