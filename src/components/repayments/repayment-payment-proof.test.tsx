import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepaymentPaymentProof } from "./repayment-payment-proof";

const proof = { id: "proof-a", originalFilename: "transfer.png", mediaType: "image/png", byteSize: 8, createdAt: new Date("2026-08-20T00:00:00.000Z") };

describe("RepaymentPaymentProof", () => {
  it("renders the empty owner-private state and add control", () => {
    render(<RepaymentPaymentProof repaymentId="repayment-a" initialPaymentProof={null} />);
    expect(screen.getByRole("heading", { name: "Payment proof" })).toBeInTheDocument();
    expect(screen.getByText("No payment proof attached.")).toBeInTheDocument();
    expect(screen.getByLabelText("Choose payment proof image")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(screen.getByRole("button", { name: "Add payment proof" })).toBeDisabled();
    expect(screen.getByText(/Private to you\./)).toBeInTheDocument();
  });

  it("adds, replaces, previews, and removes without changing repayment fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ paymentProof: proof }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ paymentProof: { ...proof, originalFilename: "new.png" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { rerender } = render(<RepaymentPaymentProof repaymentId="repayment-a" initialPaymentProof={null} />);
    const file = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "transfer.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose payment proof image"), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole("button", { name: "Add payment proof" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Payment proof uploaded."));
    expect(fetchMock).toHaveBeenLastCalledWith("/app/repayments/repayment-a/payment-proof", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("button", { name: "Replace payment proof" })).toBeInTheDocument();

    const replacement = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "new.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose payment proof image"), { target: { files: [replacement] } });
    fireEvent.submit(screen.getByRole("button", { name: "Replace payment proof" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Payment proof replaced."));
    expect(fetchMock).toHaveBeenLastCalledWith("/app/repayments/repayment-a/payment-proof", expect.objectContaining({ method: "PUT" }));

    fireEvent.click(screen.getByRole("button", { name: "Preview new.png" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close payment proof preview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", "/app/repayments/repayment-a/payment-proof/proof-a");
    fireEvent.click(screen.getByRole("button", { name: "Close payment proof preview" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Payment proof removed."));
    expect(fetchMock).toHaveBeenLastCalledWith("/app/repayments/repayment-a/payment-proof/proof-a", expect.objectContaining({ method: "DELETE" }));
    expect(screen.getByText("No payment proof attached.")).toBeInTheDocument();

    rerender(<RepaymentPaymentProof repaymentId="repayment-a" initialPaymentProof={null} />);
    expect(screen.queryByText(/Received|Applied to shares|Needs allocation/)).not.toBeInTheDocument();
    fetchMock.mockRestore();
  });
});
