import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accept: vi.fn(), decline: vi.fn() }));

vi.mock("@/app/app/inbox/actions", () => ({ acceptGroupJoinRequestAction: mocks.accept, declineGroupJoinRequestAction: mocks.decline }));

import { GroupJoinRequestActions } from "./group-join-request";

const request = {
  id: "11111111-1111-4111-8111-111111111111",
  groupId: "22222222-2222-4222-8222-222222222222",
  kind: "participant_link" as const,
  participantId: null,
  expiresAt: new Date("2026-09-01T00:00:00Z"),
};

describe("GroupJoinRequestActions", () => {
  it("shows link actions only for pending state", () => {
    render(<GroupJoinRequestActions requestId={request.id} kind={request.kind} status={{ ...request, status: "pending" }} />);
    expect(screen.getByRole("button", { name: "Accept link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
  });

  it.each(["declined", "revoked", "expired"] as const)("renders %s without actions after participant deletion", (status) => {
    render(<GroupJoinRequestActions requestId={request.id} kind={request.kind} status={{ ...request, status }} />);
    expect(screen.getByText(status[0]!.toUpperCase() + status.slice(1))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });

  it("links an accepted participant request to the Group", () => {
    render(<GroupJoinRequestActions requestId={request.id} kind={request.kind} status={{ ...request, status: "accepted" }} />);
    expect(screen.getByText("Linked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Group" })).toHaveAttribute("href", `/app/personal/groups/${request.groupId}`);
  });
});
