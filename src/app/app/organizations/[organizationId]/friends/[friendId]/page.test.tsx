import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAuthenticatedOrganizationLedger: vi.fn(), notFound: vi.fn(() => { throw new Error("not-found"); }) }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedOrganizationLedger: mocks.getAuthenticatedOrganizationLedger }));
vi.mock("@/components/friends/friend-form", () => ({ FriendForm: () => null, FriendArchiveForm: () => null }));
vi.mock("@/app/app/organizations/[organizationId]/ledger-actions", () => ({ updateFriendAction: vi.fn(), archiveFriendAction: vi.fn(), restoreFriendAction: vi.fn(), undoFriendArchiveAction: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import OrganizationFriendPage from "./page";

describe("Organization Friends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedOrganizationLedger.mockResolvedValue({
      ledger: {
        getFriend: vi.fn().mockResolvedValue({ id: "friend-a", name: "Ada", phoneNumber: null, notes: null, archivedAt: null, createdAt: new Date("2026-01-01") }),
        getFriendBalances: vi.fn().mockResolvedValue([]),
        listFriendExpenseShareRecords: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }),
        listRepaymentRecords: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }),
      },
      can: () => false,
    });
  });

  it("keeps Organization Friends out of Personal linking and debtor sharing", async () => {
    render(await OrganizationFriendPage({ params: Promise.resolve({ organizationId: "org-a", friendId: "friend-a" }) }));
    expect(screen.getByRole("heading", { name: "Ada" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /link/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/share link/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /zplit account/i })).not.toBeInTheDocument();
  });
});
