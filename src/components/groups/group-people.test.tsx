import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GroupParticipant } from "@/server/groups";

vi.mock("server-only", () => ({}));
vi.mock("@/app/app/personal/groups/actions", () => ({
  createExternalParticipantAction: vi.fn(),
  deleteExternalParticipantAction: vi.fn(),
  removeGroupMemberAction: vi.fn(),
  updateExternalParticipantAction: vi.fn(),
  updateGroupMemberRoleAction: vi.fn(),
}));

import { GroupPeople } from "./group-people";

const externalParticipant: GroupParticipant = { id: "participant-external", userId: null, displayName: "Taxi", label: "Driver", role: null, isExternal: true };

describe("GroupPeople", () => {
  it("renders external participant data as read-only for non-managers", () => {
    const { container } = render(<GroupPeople groupId="group-a" participants={[externalParticipant]} canManageParticipants={false} canManageRoles={false} />);

    expect(screen.getByText("Taxi")).toBeInTheDocument();
    expect(screen.getByText("Driver")).toBeInTheDocument();
    expect(screen.getByText("External")).toBeInTheDocument();
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
});
