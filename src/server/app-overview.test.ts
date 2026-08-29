import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGroupOverviewSummaries: vi.fn(),
  listOrganizationOverviewSummaries: vi.fn(),
  readLedgerOverviewSummaries: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/groups", () => ({ listGroupOverviewSummaries: mocks.listGroupOverviewSummaries }));
vi.mock("@/server/organizations", () => ({ listOrganizationOverviewSummaries: mocks.listOrganizationOverviewSummaries }));
vi.mock("@/domain/ledger/summary", () => ({ readLedgerOverviewSummaries: mocks.readLedgerOverviewSummaries }));

import { readOverviewSpaces } from "./app-overview";

describe("authenticated Overview space reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listGroupOverviewSummaries.mockResolvedValue([]);
    mocks.listOrganizationOverviewSummaries.mockResolvedValue([]);
    mocks.readLedgerOverviewSummaries.mockResolvedValue(new Map());
  });

  it("batches only permitted Organization ledger scopes and keeps domains separate", async () => {
    mocks.listGroupOverviewSummaries.mockResolvedValue([{ id: "group-a", name: "Trip", youOwe: 20, owedToYou: 0 }]);
    mocks.listOrganizationOverviewSummaries.mockResolvedValue([
      { id: "org-a", name: "Acme", canViewLedger: true, ledgerScopeId: "scope-a" },
      { id: "org-b", name: "Private", canViewLedger: false, ledgerScopeId: "scope-b" },
    ]);
    mocks.readLedgerOverviewSummaries.mockResolvedValue(new Map([["scope-a", { totalExpenseAmount: 100, totalRepaidAmount: 20, totalOutstandingAmount: 80 }]]));

    const spaces = await readOverviewSpaces("database" as never, "user-a");

    expect(mocks.listGroupOverviewSummaries).toHaveBeenCalledOnce();
    expect(mocks.listOrganizationOverviewSummaries).toHaveBeenCalledOnce();
    expect(mocks.readLedgerOverviewSummaries).toHaveBeenCalledExactlyOnceWith("database", ["scope-a"]);
    expect(spaces.groups[0]).toMatchObject({ id: "group-a", youOwe: 20 });
    expect(spaces.organizations).toEqual([
      expect.objectContaining({ id: "org-a", ledgerSummary: expect.objectContaining({ totalOutstandingAmount: 80 }) }),
      expect.objectContaining({ id: "org-b", ledgerSummary: null }),
    ]);
    expect(spaces).not.toHaveProperty("totalOutstandingAmount");
  });
});
