import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GroupSummary } from "@/domain/group-contracts";
import { GroupCard } from "./group-card";

const group: GroupSummary = {
  id: "group-a",
  name: "Bandung Trip",
  description: null,
  role: "member",
  participantCount: 3,
  avatar: null,
};

describe("GroupCard", () => {
  it("keeps the participant-relative canonical balance concise", () => {
    render(<GroupCard group={group} balance={{ youOwe: 25_000, owedToYou: 0 }} />);

    const card = screen.getByRole("link", { name: /Bandung Trip/ });
    expect(card).toHaveAttribute("href", "/app/personal/groups/group-a");
    expect(screen.getByText("You owe")).toBeInTheDocument();
    expect(screen.getByText("Rp 25.000")).toBeInTheDocument();
  });
});
