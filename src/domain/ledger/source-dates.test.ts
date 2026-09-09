import { describe, expect, it } from "vitest";
import type { Database } from "../../db/client";
import { friends, outings, repaymentAllocations, repayments } from "../../db/schema";
import { createLedgerRepository } from "../ledger-repository";

type Query = {
  from(table: unknown): Query;
  innerJoin(...args: unknown[]): Query;
  where(...args: unknown[]): Query;
  limit(...args: unknown[]): Query;
  for(...args: unknown[]): Promise<unknown[]>;
  then(resolve: (rows: unknown[]) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};

function sourceDateDatabase() {
  const state = {
    outing: {
      id: "outing-a",
      ledgerScopeId: "scope-a",
      title: "Dinner",
      occurredAt: new Date("2026-09-09T17:30:00.000Z"),
      occurredOn: null as string | null,
      notes: null,
      tripId: null,
      createdAt: new Date("2026-09-09T17:30:00.000Z"),
      updatedAt: new Date("2026-09-09T17:30:00.000Z"),
    },
    repayment: {
      id: "repayment-a",
      ledgerScopeId: "scope-a",
      friendId: "friend-a",
      amount: 100,
      paidAt: new Date("2026-09-09T17:30:00.000Z"),
      paidOn: null as string | null,
      paymentMethod: null,
      notes: null,
      createdAt: new Date("2026-09-09T17:30:00.000Z"),
    },
  };

  function rows(table: unknown) {
    if (table === outings) return [state.outing];
    if (table === repayments) return [state.repayment];
    if (table === friends) return [{ id: state.repayment.friendId }];
    if (table === repaymentAllocations) return [];
    return [];
  }

  const select = () => {
    let table: unknown;
    const query = {} as Query;
    query.from = (nextTable) => { table = nextTable; return query; };
    query.innerJoin = () => query;
    query.where = () => query;
    query.limit = () => query;
    query.for = async () => rows(table);
    query.then = (resolve, reject) => Promise.resolve(rows(table)).then(resolve, reject);
    return query;
  };

  const database = {
    select,
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          return {
            returning: async () => {
                if (table === outings) Object.assign(state.outing, values);
                if (table === repayments) Object.assign(state.repayment, values);
              return [table === outings ? state.outing : state.repayment];
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
              where: () => ({
                returning: async () => {
                if (table === outings) {
                  const occurredAt = values.occurredAt instanceof Date ? values.occurredAt : state.outing.occurredAt;
                  const occurredOn = typeof values.occurredOn === "string"
                    ? values.occurredOn
                    : state.outing.occurredAt.getTime() === occurredAt.getTime() && state.outing.occurredOn
                      ? state.outing.occurredOn
                      : occurredAt.toISOString().slice(0, 10);
                  Object.assign(state.outing, { ...values, occurredOn });
                }
                if (table === repayments) Object.assign(state.repayment, values);
                return [table === outings ? state.outing : state.repayment];
              },
            }),
          };
        },
      };
    },
    transaction: async (callback: (transaction: Database) => Promise<unknown>) => callback(database as unknown as Database),
  };

  return { database: database as unknown as Database, state };
}

describe("canonical source dates", () => {
  it("reads legacy NULL dates without inferring them", async () => {
    const fixture = sourceDateDatabase();
    const repository = createLedgerRepository(fixture.database, "scope-a");

    await expect(repository.getOuting("outing-a")).resolves.toMatchObject({ occurredOn: null });
    await expect(repository.getRepayment("repayment-a")).resolves.toMatchObject({ paidOn: null });
    expect(fixture.state.outing.occurredOn).toBeNull();
    expect(fixture.state.repayment.paidOn).toBeNull();
  });

  it("writes an Outing timestamp and owner date from the source mutation input", async () => {
    const fixture = sourceDateDatabase();
    const repository = createLedgerRepository(fixture.database, "scope-a");

    const outing = await repository.createOuting({
      title: "Midnight dinner",
      occurredAt: new Date("2026-09-09T17:30:00.000Z"),
      occurredOn: "2026-09-10",
      notes: null,
    });

    expect(outing).toMatchObject({ occurredAt: new Date("2026-09-09T17:30:00.000Z"), occurredOn: "2026-09-10" });
  });

  it("preserves a confirmed Outing date for an unchanged instant and updates it when the instant changes", async () => {
    const fixture = sourceDateDatabase();
    fixture.state.outing.occurredOn = "2026-09-10";
    const repository = createLedgerRepository(fixture.database, "scope-a");

    await repository.updateOuting("outing-a", {
      title: "Renamed",
      occurredAt: fixture.state.outing.occurredAt,
      occurredOn: "2026-09-09",
      notes: null,
    });
    expect(fixture.state.outing.occurredOn).toBe("2026-09-10");

    await repository.updateOuting("outing-a", {
      title: "Moved",
      occurredAt: new Date("2026-09-11T09:30:00.000Z"),
      occurredOn: "2026-09-11",
      notes: null,
    });
    expect(fixture.state.outing).toMatchObject({ occurredAt: new Date("2026-09-11T09:30:00.000Z"), occurredOn: "2026-09-11" });
  });

  it("confirms a legacy Outing date only when its visible source datetime is saved", async () => {
    const fixture = sourceDateDatabase();
    const repository = createLedgerRepository(fixture.database, "scope-a");

    await repository.updateOuting("outing-a", {
      title: "Confirmed",
      occurredAt: fixture.state.outing.occurredAt,
      occurredOn: "2026-09-09",
      notes: null,
    });

    expect(fixture.state.outing.occurredOn).toBe("2026-09-09");
  });

  it("writes and updates a Repayment timestamp and owner date together", async () => {
    const fixture = sourceDateDatabase();
    const repository = createLedgerRepository(fixture.database, "scope-a");

    const repayment = await repository.createRepayment({
      friendId: "friend-a",
      amount: 100,
      paidAt: new Date("2026-09-09T17:30:00.000Z"),
      paidOn: "2026-09-10",
      paymentMethod: null,
      notes: null,
    });
    expect(repayment).toMatchObject({ paidAt: new Date("2026-09-09T17:30:00.000Z"), paidOn: "2026-09-10" });

    await repository.updateRepayment("repayment-a", {
      friendId: "friend-a",
      amount: 100,
      paidAt: new Date("2026-09-11T09:30:00.000Z"),
      paidOn: "2026-09-11",
      paymentMethod: null,
      notes: null,
    });
    expect(fixture.state.repayment).toMatchObject({ paidAt: new Date("2026-09-11T09:30:00.000Z"), paidOn: "2026-09-11" });
  });
});
