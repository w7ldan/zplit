import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GroupJoinRequestSummary, GroupParticipant } from "@/domain/group-contracts";
import { assertPlainDto } from "@/test/assert-plain-dto";

vi.mock("server-only", () => ({}));
vi.mock("@/app/app/personal/groups/actions", () => ({
  addPersonalFriendAsGroupParticipantAction: vi.fn(),
  createExternalParticipantAction: vi.fn(),
  createGroupInvitationAction: vi.fn(),
  createGroupParticipantLinkRequestAction: vi.fn(),
  deleteExternalParticipantAction: vi.fn(),
  removeGroupMemberAction: vi.fn(),
  revokeGroupJoinRequestAction: vi.fn(),
  searchGroupJoinUserOptions: vi.fn().mockResolvedValue([]),
  searchGroupMemberOptions: vi.fn().mockResolvedValue([]),
  updateExternalParticipantAction: vi.fn(),
  updateGroupMemberRoleAction: vi.fn(),
}));

import { GroupPeople } from "./group-people";

const externalParticipant: GroupParticipant = { id: "participant-external", userId: null, displayName: "Taxi", label: "Driver", role: null, isExternal: true, isFormer: false };
const pendingLink: GroupJoinRequestSummary = { id: "request-a", kind: "participant_link", status: "pending", targetUserId: "user-b", targetDisplayName: "Alice", targetUsername: "alice", participantId: externalParticipant.id, participantDisplayName: "Taxi", participantLabel: "Driver", expiresAt: "2026-09-01T00:00:00.000Z" };
describe("GroupPeople", () => {
  it("renders external participant data as read-only for non-managers", () => {
    const { container } = render(<GroupPeople groupId="group-a" participants={[externalParticipant]} canManageParticipants={false} canManageRoles={false} />);

    expect(screen.getByText("Taxi")).toBeInTheDocument();
    expect(screen.getByText("Driver")).toBeInTheDocument();
    expect(screen.getByText("Local member")).toBeInTheDocument();
    expect(container.querySelector(".group-external-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Name for Taxi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Label for Taxi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("keeps external participant editing for managers", () => {
    render(<GroupPeople groupId="group-a" participants={[externalParticipant]} canManageParticipants canManageRoles={false} />);

    expect(screen.getByRole("textbox", { name: "Name for Taxi" })).toHaveValue("Taxi");
    expect(screen.getByRole("textbox", { name: "Label for Taxi" })).toHaveValue("Driver");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows a pending link instead of a second link form", () => {
    assertPlainDto(pendingLink);
    render(<GroupPeople
      groupId="group-a"
      participants={[externalParticipant]}
      pendingLinks={[pendingLink]}
      canManageParticipants
      canManageRoles={false}
    />);

    expect(screen.getByText("Pending link → @alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link Zplit account" })).not.toBeInTheDocument();
  });

  it("uses one member combobox and keeps arbitrary local creation out of Groups", () => {
    const { container } = render(
      <GroupPeople
        groupId="group-a"
        participants={[]}
        canManageParticipants
        canManageRoles={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Add member" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search by name or @username..." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add member" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a Personal Friend first." })).toHaveAttribute("href", "/app/friends?create=1");
    expect(container.querySelector('input[aria-label="External participant name"]')).not.toBeInTheDocument();
    expect(screen.queryByText("FROM PERSONAL FRIENDS")).not.toBeInTheDocument();
  });
});
