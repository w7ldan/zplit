import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FriendRow } from "./friend-row";

vi.mock("@/app/app/inbox/actions", () => ({ unlinkFriendLinkRequestAction: vi.fn() }));

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

  it("renders an active registered Friend with identity and unlink but no ledger route", () => {
    render(<FriendRow friend={{ type: "connection", id: "connection-a", userId: "user-a", name: "Alice Tan", username: "alice", requestId: "request-a" }} />);

    const row = document.querySelector<HTMLElement>(".friend-row")!;
    expect(within(row).getByText("Alice Tan")).toBeInTheDocument();
    expect(within(row).getByText("@alice")).toBeInTheDocument();
    expect(within(row).getByText("ACTIVE")).toBeInTheDocument();
    expect(within(row).getByText("Unlink", { selector: "summary" })).toBeInTheDocument();
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).queryByText("Outstanding")).not.toBeInTheDocument();
    expect(within(row).queryByText("Edit record")).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent(/@example|email/i);
  });

  it("enriches an existing local row without adding a connection row", () => {
    render(<FriendRow friend={{ id: "friend-a", name: "Alice Tan", phoneNumber: null, archivedAt: null, createdAt: new Date("2026-01-01T00:00:00Z"), linkedUser: { displayName: "Alice Tan", username: "alice" } }} />);

    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit record" })).toHaveAttribute("href", "/app/friends/friend-a");
    expect(document.querySelectorAll(".friend-row")).toHaveLength(1);
  });

  it("marks an unlinked local Friend as external", () => {
    render(<FriendRow friend={{ id: "friend-a", name: "Cash", phoneNumber: null, archivedAt: null, createdAt: new Date("2026-01-01T00:00:00Z") }} />);

    expect(screen.getByText("External")).toBeInTheDocument();
  });
});
