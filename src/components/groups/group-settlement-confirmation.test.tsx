import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupSettlementConfirmation } from "./group-settlement-confirmation";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => router.refresh.mockReset());

describe("GroupSettlementConfirmation", () => {
  it("has one recipient action and disables duplicate submissions", async () => {
    const result = deferred<{ error: string }>();
    const action = vi.fn(() => result.promise);
    render(<GroupSettlementConfirmation action={action} />);
    const form = screen.getByRole("button", { name: "Confirm payment received" }).closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Confirming payment…" })).toBeDisabled();
    result.resolve({ error: "" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm payment received" })).toBeEnabled());
  });

  it("shows backend errors and refreshes canonical state after success", async () => {
    const action = vi.fn()
      .mockResolvedValueOnce({ error: "Only the payment recipient can confirm this payment." })
      .mockResolvedValueOnce({ error: "", success: "Payment confirmed." });
    render(<GroupSettlementConfirmation action={action} />);
    const form = () => screen.getByRole("button", { name: /Confirm payment/ }).closest("form")!;

    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Only the payment recipient"));
    expect(screen.getByRole("button", { name: "Confirm payment received" })).toBeEnabled();
    fireEvent.submit(form());
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  });
});
