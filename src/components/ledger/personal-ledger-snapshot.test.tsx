import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LedgerOverviewSummary } from "@/domain/ledger/types";
import { PersonalLedgerSnapshot } from "./personal-ledger-snapshot";

function summary(totalUnallocatedRepaymentAmount: number) {
  return {
    totalOutstandingAmount: 25_000,
    totalUnallocatedRepaymentAmount,
    totalExpenseAmount: 40_000,
  } as LedgerOverviewSummary;
}

describe("PersonalLedgerSnapshot", () => {
  it.each([
    { amount: 0, active: false },
    { amount: 12_000, active: true },
  ])("keeps the Needs allocation tile structure at $amount", ({ amount, active }) => {
    render(<PersonalLedgerSnapshot summary={summary(amount)} />);

    const tile = screen.getByText("Needs allocation").parentElement!;
    expect(tile).toHaveClass("personal-ledger-summary__attention");
    if (active) expect(tile).toHaveClass("personal-ledger-summary__attention--active");
    else expect(tile).not.toHaveClass("personal-ledger-summary__attention--active");
    expect(tile).toHaveTextContent(amount === 0 ? "Rp 0" : "Rp 12.000");
  });
});
