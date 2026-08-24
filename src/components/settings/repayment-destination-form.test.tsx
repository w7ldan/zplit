import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepaymentDestinationForm } from "./repayment-destination-form";

describe("RepaymentDestinationForm", () => {
  it("uses adaptive identifier labels and defaults sharing off", () => {
    render(<RepaymentDestinationForm action={vi.fn()} />);
    expect(screen.getByLabelText("Account number")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Show on balance links/ })).not.toBeChecked();
    expect(screen.getByText("Anyone with an active balance link can see these details.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "e_wallet" } });
    expect(screen.getByLabelText("Phone / account number")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "other" } });
    expect(screen.getByLabelText("Repayment details")).toBeInTheDocument();
  });
});
