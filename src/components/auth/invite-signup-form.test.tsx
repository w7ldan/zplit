import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InviteSignupForm } from "./invite-signup-form";

const initialState = {
  fieldErrors: {},
  formError: "",
  values: { name: "" },
};

describe("InviteSignupForm", () => {
  it("shows the invited email, suggested name, and new-password fields", () => {
    render(<InviteSignupForm email="person@example.com" suggestedName="Ada" action={vi.fn().mockResolvedValue(initialState)} />);

    expect(screen.getByText("person@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("preserves the name and displays action errors without preserving passwords", async () => {
    const action = vi.fn().mockResolvedValue({
      ...initialState,
      fieldErrors: { confirmPassword: "Passwords do not match." },
      formError: "Please correct the marked fields.",
      values: { name: "Ada Lovelace" },
    });
    render(<InviteSignupForm email="person@example.com" action={action} />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada Lovelace" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Passwords do not match.")).toBeInTheDocument());
    expect(screen.getByLabelText("Your name")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });
});
