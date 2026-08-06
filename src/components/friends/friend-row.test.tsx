import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FriendRow } from "./friend-row";

describe("FriendRow", () => {
  it("keeps an unbroken friend name in the rendered row", () => {
    const name = "friend-" + "x".repeat(240);
    render(<FriendRow friend={{ id: "friend-a", ownerUserId: "owner-a", name, phoneNumber: null, notes: null, archivedAt: null, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") }} />);

    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  });
});
