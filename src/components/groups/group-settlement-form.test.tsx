import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupSettlementForm } from "./group-settlement-form";

const recipient = {
  id: "recipient-a",
  displayName: "Bima",
  label: "Office",
  currentDebt: 100000,
};

const emptyState = {
  fieldErrors: {},
  formError: "",
  values: {
    recipientParticipantId: recipient.id,
    amountRupiah: "",
    paymentMethodChoice: "",
    paymentMethodOther: "",
  },
};

describe("GroupSettlementForm", () => {
  it("keeps the sender fixed, shows canonical current debt, and offers optional proof", () => {
    render(
      <GroupSettlementForm
        action={vi.fn().mockResolvedValue(emptyState)}
        senderName="Ari"
        recipients={[recipient]}
      />,
    );

    expect(screen.getByText("Ari")).toBeInTheDocument();
    expect(screen.getByText(/recipient must confirm it/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Paid by")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Paid to")).toHaveValue(recipient.id);
    expect(screen.getByText("Rp 100.000")).toBeInTheDocument();
    expect(screen.getByLabelText("Optional payment proof")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
    expect(screen.getByText(/Proof is evidence only and does not confirm payment/)).toBeInTheDocument();
  });

  it("blocks an amount above current debt before submitting", () => {
    const action = vi.fn().mockResolvedValue(emptyState);
    render(
      <GroupSettlementForm
        action={action}
        senderName="Ari"
        recipients={[recipient]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), {
      target: { value: "100001" },
    });
    fireEvent.change(screen.getByLabelText("Payment method"), {
      target: { value: "Cash" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Record payment" }).closest("form")!);
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("cannot exceed");
  });

  it("preserves a server error and exposes one shared pending submit state", async () => {
    const action = vi.fn().mockResolvedValue({
      ...emptyState,
      formError: "The accounting data changed. Reload and try again.",
    });
    render(
      <GroupSettlementForm
        action={action}
        senderName="Ari"
        recipients={[recipient]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Amount in rupiah"), {
      target: { value: "50000" },
    });
    fireEvent.change(screen.getByLabelText("Payment method"), {
      target: { value: "Cash" },
    });
    const form = screen.getByRole("button", { name: "Record payment" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("accounting data changed"));
    expect(screen.getByRole("button", { name: "Record payment" })).toBeEnabled();
  });
});
