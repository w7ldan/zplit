import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseReceipts } from "./expense-receipts";

const receipt = {
  id: "33333333-3333-4333-8333-333333333333",
  originalFilename: "dinner.jpg",
  mediaType: "image/jpeg",
  byteSize: 5 * 1024,
  createdAt: "2026-08-05T00:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("ExpenseReceipts", () => {
  it("renders limits, metadata, accessible view, and explicit inline removal controls", () => {
    render(<ExpenseReceipts expenseId="expense-a" initialReceipts={[receipt]} />);
    expect(screen.getByRole("heading", { name: "Receipts" })).toBeInTheDocument();
    expect(screen.getByText(/JPEG, PNG, or WebP/)).toBeInTheDocument();
    expect(screen.getByLabelText("Choose receipt image")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(screen.getByLabelText("Choose receipt image")).toHaveClass("expense-receipts__file-input");
    expect(screen.queryByText("Choose File")).not.toBeInTheDocument();
    expect(screen.queryByText("No file chosen")).not.toBeInTheDocument();
    expect(screen.getByText("dinner.jpg")).toBeInTheDocument();
    expect(screen.getByText(/image\/jpeg · 5 KiB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/app/expenses/expense-a/receipts/33333333-3333-4333-8333-333333333333");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows a stable pending state, then refreshes local metadata and announces success", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    render(<ExpenseReceipts expenseId="expense-a" initialReceipts={[]} />);
    const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "new.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Choose receipt image"), { target: { files: [file] } });
    expect(screen.getByText("new.jpg")).toBeInTheDocument();
    expect(screen.getByText("Change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload receipt" })).toBeEnabled();
    fireEvent.submit(screen.getByRole("button", { name: "Upload receipt" }).closest("form")!);
    expect(screen.getByRole("button", { name: "Uploading receipt…" })).toBeDisabled();
    resolveFetch(new Response(JSON.stringify({ receipt: { ...receipt, originalFilename: "new.jpg" } }), { status: 200 }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Receipt uploaded."));
    expect(screen.getByText("new.jpg")).toBeInTheDocument();
    expect(screen.getByText("Choose receipt image")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("shows adjacent upload errors and removes a receipt without document reload", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "The receipt MIME type does not match its contents." }), { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ExpenseReceipts expenseId="expense-a" initialReceipts={[receipt]} />);
    const file = new File([new Uint8Array([1])], "bad.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose receipt image"), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole("button", { name: "Upload receipt" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("MIME type does not match"));
    expect(screen.getByText("bad.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Receipt removed."));
    expect(screen.queryByText("dinner.jpg")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
