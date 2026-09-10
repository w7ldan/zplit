import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { groupMemberships } from "@/db/schema";
vi.mock("server-only", () => ({}));
import { buildGroupSettlementBudgetDistribution, readGroupBudgetSharedMoney, settlementDescription } from "./sources-group";

function queryChain(rows: unknown[], fromTables: unknown[]) {
  const query = {} as Record<string, unknown>;
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    query[method] = vi.fn((...args: unknown[]) => {
      if (method === "from") fromTables.push(args[0]);
      return query;
    });
  }
  query.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return query;
}

function databaseFor(selectRows: unknown[][]) {
  const rows = [...selectRows];
  const fromTables: unknown[] = [];
  const select = vi.fn(() => queryChain(rows.shift() ?? [], fromTables));
  return { database: { select } as unknown as Database, select, fromTables };
}

describe("Group settlement budget distribution", () => {
  it("maps applications, aggregates categories, and credits the remainder", () => {
    expect(buildGroupSettlementBudgetDistribution(500, [
      { amount: 100, categoryId: "food" },
      { amount: 150, categoryId: "food" },
      { amount: 100, categoryId: "travel" },
    ], "uncategorized")).toEqual(new Map([
      ["food", 250],
      ["travel", 100],
      ["uncategorized", 150],
    ]));
  });

  it("uses Uncategorized for missing or unusable classifications", () => {
    const result = buildGroupSettlementBudgetDistribution(300, [
      { amount: 100, categoryId: null },
      { amount: 100, categoryId: "usable" },
    ], "uncategorized");
    expect(result).toEqual(new Map([["uncategorized", 200], ["usable", 100]]));
    expect([...result.values()].reduce((sum, amount) => sum + amount, 0)).toBe(300);
  });

  it("rejects canonical applications that exceed settlement cash", () => {
    expect(() => buildGroupSettlementBudgetDistribution(100, [{ amount: 101, categoryId: "food" }], "uncategorized")).toThrow();
  });
});

describe("Group Shared Money", () => {
  it("uses every linked participant identity, preserves former balances, and batches counterparties", async () => {
    const ownerParticipantA = "owner-participant-a";
    const ownerParticipantB = "owner-participant-b";
    const debtorObligation = "obligation-debtor";
    const creditorObligation = "obligation-creditor";
    const formerDebtorObligation = "obligation-former-debtor";
    const formerCreditorObligation = "obligation-former-creditor";
    const db = databaseFor([
      [
        { groupId: "group-a", participantId: ownerParticipantA },
        { groupId: "group-b", participantId: ownerParticipantB },
      ],
      [
        { id: debtorObligation, groupId: "group-a", authoritativeAt: new Date("2026-09-01"), originalAmount: 100, debtorParticipantId: ownerParticipantA, creditorParticipantId: "participant-b" },
        { id: creditorObligation, groupId: "group-a", authoritativeAt: new Date("2026-09-02"), originalAmount: 80, debtorParticipantId: "participant-c", creditorParticipantId: ownerParticipantA },
        { id: formerDebtorObligation, groupId: "group-b", authoritativeAt: new Date("2026-09-03"), originalAmount: 50, debtorParticipantId: ownerParticipantB, creditorParticipantId: "participant-d" },
        { id: formerCreditorObligation, groupId: "group-b", authoritativeAt: new Date("2026-09-04"), originalAmount: 60, debtorParticipantId: "participant-e", creditorParticipantId: ownerParticipantB },
      ],
      [
        { obligationId: debtorObligation, amount: 20 },
      ],
      [
        { obligationId: debtorObligation, amount: 10 },
      ],
      [
        { id: debtorObligation, groupId: "group-a", groupName: "Active group", description: "Active debt" },
        { id: creditorObligation, groupId: "group-a", groupName: "Active group", description: "Active credit" },
        { id: formerDebtorObligation, groupId: "group-b", groupName: "Former group", description: "Former debt" },
        { id: formerCreditorObligation, groupId: "group-b", groupName: "Former group", description: "Former credit" },
      ],
      [
        { obligationId: debtorObligation, categoryId: "category-food", categoryName: "Food" },
        { obligationId: formerDebtorObligation, categoryId: "category-travel", categoryName: "Travel" },
      ],
    ]);

    await expect(readGroupBudgetSharedMoney(db.database, "owner-user")).resolves.toEqual({
      expectedBack: 140,
      stillOwe: 120,
      obligations: [
        { id: debtorObligation, groupId: "group-a", groupName: "Active group", description: "Active debt", amount: 70, categoryId: "category-food", categoryName: "Food" },
        { id: formerDebtorObligation, groupId: "group-b", groupName: "Former group", description: "Former debt", amount: 50, categoryId: "category-travel", categoryName: "Travel" },
      ],
    });
    expect(db.select).toHaveBeenCalledTimes(6);
    expect(db.fromTables).not.toContain(groupMemberships);
  });

  it("does not double count a fully applied obligation", async () => {
    const db = databaseFor([
      [{ groupId: "group-a", participantId: "owner-participant" }],
      [{ id: "obligation-a", groupId: "group-a", authoritativeAt: new Date("2026-09-01"), originalAmount: 100, debtorParticipantId: "other", creditorParticipantId: "owner-participant" }],
      [{ obligationId: "obligation-a", amount: 60 }],
      [{ obligationId: "obligation-a", amount: 40 }],
      [{ id: "obligation-a", groupId: "group-a", groupName: "Group", description: "Paid" }],
      [],
    ]);

    await expect(readGroupBudgetSharedMoney(db.database, "owner-user")).resolves.toEqual({ expectedBack: 0, stillOwe: 0, obligations: [] });
    expect(db.select).toHaveBeenCalledTimes(6);
  });
});

describe("Group settlement presentation", () => {
  it("uses the canonical registered or external participant display name", () => {
    expect(settlementDescription("outflow", { displayName: "Alice" })).toBe("Group payment to Alice");
    expect(settlementDescription("inflow", { displayName: "Taxi" })).toBe("Group payment from Taxi");
    expect(settlementDescription("outflow", null)).toBe("Group payment to Group participant");
  });
});
