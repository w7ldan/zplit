import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ZplitSocialPreview } from "./zplit-social-preview";

describe("Zplit social preview", () => {
  it("renders the branded illustrative ledger composition", () => {
    render(<ZplitSocialPreview />);

    expect(screen.getByText("ZPLIT / SHARED EXPENSE LEDGER")).toBeInTheDocument();
    expect(screen.getByText("Shared expenses, clearly settled.")).toBeInTheDocument();
    expect(screen.getByText("Outings · Shares · Repayments · Balances")).toBeInTheDocument();
    expect(screen.getByText("ILLUSTRATIVE LEDGER")).toBeInTheDocument();
    expect(screen.getByText("Bandung day out")).toBeInTheDocument();
    for (const value of ["Rp 126.500", "Rp 84.000", "Rp 42.500"]) expect(screen.getByText(value)).toBeInTheDocument();
  });
});
