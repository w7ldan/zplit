import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupExpenseRow } from "./group-expense-row";

const payer = { id: "payer", userId: "user-a", displayName: "Alice", label: null, status: "active" as const };

describe("GroupExpenseRow", () => {
  it("shows payer, state, share count, and confirmation attention", () => {
    render(<GroupExpenseRow expense={{ id: "expense-a", groupId: "group-a", creatorParticipantId: "creator", payerParticipantId: "payer", description: "Dinner", occurredAt: new Date("2026-08-27T12:00:00Z"), totalAmount: 100000, state: "pending", confirmedAt: null, createdAt: new Date(), updatedAt: new Date(), payer, shareCount: 3 }} viewerUserId="user-a" basePath="/app/personal/groups/group-a/expenses" />);
    expect(screen.getByRole("link", { name: "Dinner" })).toHaveAttribute("href", "/app/personal/groups/group-a/expenses/expense-a");
    expect(screen.getByText("Rp 100.000")).toBeInTheDocument();
    expect(screen.getByText("Pending confirmation")).toBeInTheDocument();
    expect(screen.getByText("Needs your confirmation")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("3", { exact: true })).toBeInTheDocument();
  });

  it("labels historical and external identities", () => {
    render(<GroupExpenseRow expense={{ id: "expense-a", groupId: "group-a", creatorParticipantId: "creator", payerParticipantId: "payer", description: "Taxi", occurredAt: new Date("2026-08-27T12:00:00Z"), totalAmount: 100000, state: "confirmed", confirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), payer: { ...payer, userId: null, status: "external", displayName: "Charlie", label: "Driver" }, shareCount: 1 }} viewerUserId="user-a" basePath="/app/personal/groups/group-a/expenses" />);
    expect(screen.getByText("Charlie · Driver · External")).toBeInTheDocument();
  });
});
