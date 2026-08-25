import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accept: vi.fn(), decline: vi.fn() }));

vi.mock("@/app/app/inbox/actions", () => ({ acceptOrganizationInvitationAction: mocks.accept, declineOrganizationInvitationAction: mocks.decline }));

import { OrganizationInvitationActions } from "./organization-invitation";

const invitation = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "member" as const,
  expiresAt: new Date("2026-09-01T00:00:00Z"),
};

describe("OrganizationInvitationActions", () => {
  it("shows Accept and Decline only for pending state", () => {
    render(<OrganizationInvitationActions invitationId={invitation.id} status={{ ...invitation, status: "pending" }} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it.each(["declined", "revoked", "expired"] as const)("renders %s without actionable controls", (status) => {
    render(<OrganizationInvitationActions invitationId={invitation.id} status={{ ...invitation, status }} />);
    expect(screen.getByText(status[0]!.toUpperCase() + status.slice(1))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });

  it("links accepted membership to the canonical Organization", () => {
    render(<OrganizationInvitationActions invitationId={invitation.id} status={{ ...invitation, status: "accepted" }} />);
    expect(screen.getByText("Joined")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open organization" })).toHaveAttribute("href", `/app/organizations/${invitation.organizationId}`);
  });
});
