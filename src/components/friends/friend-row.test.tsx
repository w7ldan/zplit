import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FriendRow } from "./friend-row";

describe("FriendRow", () => {
  it("exposes stable friend, state, created, outstanding, and action fields", () => {
    render(<FriendRow friend={{ id: "friend-a", name: "Rani", phoneNumber: "+62 812", archivedAt: null, createdAt: new Date("2026-01-01T00:00:00Z") }} balance={{ assignedAmount: 84_000, repaidAmount: 20_000, outstandingAmount: 64_000 }} />);

    for (const label of ["State", "Created", "Outstanding"]) expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 64.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit record/ })).toBeInTheDocument();
  });

  it("keeps an unbroken friend name in the rendered row", () => {
    const name = "friend-" + "x".repeat(240);
    render(<FriendRow friend={{ id: "friend-a", name, phoneNumber: null, archivedAt: null, createdAt: new Date("2026-01-01T00:00:00Z") }} />);

    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  });
});
