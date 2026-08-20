import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InvitesPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  listInvitations: vi.fn(),
  isInstallationOwner: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/auth/invitations", () => ({ listInvitations: mocks.listInvitations, isInstallationOwner: mocks.isInstallationOwner }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/invites/invite-form", () => ({ InviteForm: () => <form aria-label="Create invitation form" /> }));
vi.mock("./actions", () => ({ createInviteAction: vi.fn(), revokeInviteAction: vi.fn() }));

describe("/app/invites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the creation surface and invitation history", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.isInstallationOwner.mockResolvedValue(true);
    mocks.listInvitations.mockResolvedValue([
      {
        id: "invite-a",
        email: "person@example.com",
        suggestedName: "Ada",
        expiresAt: new Date("2099-08-11T00:00:00.000Z"),
        acceptedAt: null,
        revokedAt: null,
      },
    ]);

    render(await InvitesPage());

    expect(screen.getByRole("heading", { level: 1, name: "Bring someone in." })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create invitation form" })).toBeInTheDocument();
    expect(screen.getByText("person@example.com")).toBeInTheDocument();
    expect(screen.getByText("Ready to share")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("shows a useful empty history", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.isInstallationOwner.mockResolvedValue(true);
    mocks.listInvitations.mockResolvedValue([]);

    render(await InvitesPage());

    expect(screen.getByText("No invitations yet.")).toBeInTheDocument();
  });

  it("uses not-found for a non-owner", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-b" } });
    mocks.isInstallationOwner.mockResolvedValue(false);
    await expect(InvitesPage()).rejects.toThrow("not-found");
    expect(mocks.listInvitations).not.toHaveBeenCalled();
  });
});
