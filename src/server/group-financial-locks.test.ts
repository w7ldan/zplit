import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { groupMemberships, groupParticipants } from "@/db/schema";

const mocks = vi.hoisted(() => ({ lockActiveGroupForOperationalMutation: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/groups", () => ({ lockActiveGroupForOperationalMutation: mocks.lockActiveGroupForOperationalMutation }));

import { lockGroupFinancialParticipants } from "./group-financial-locks";

const groupId = "11111111-1111-4111-8111-111111111111";
const participantIds = [
  "33333333-3333-4333-8333-333333333333",
  "22222222-2222-4222-8222-222222222222",
];

function databaseFor(events: string[]) {
  const rows: unknown[][] = [
    participantIds.map((id) => ({ id, userId: `user-${id}`, displayName: null })),
    participantIds.map((participantId) => ({ participantId, userId: `user-${participantId}` })),
  ];
  const database = {
    select: vi.fn(() => {
      const currentRows = rows.shift() ?? [];
      const query = {
        from(table: unknown) { events.push(table === groupParticipants ? "participants" : table === groupMemberships ? "memberships" : "other"); return query; },
        where() { return query; },
        orderBy() { return query; },
        for(lock: string) { events.push(`lock:${lock}`); return Promise.resolve(currentRows); },
      };
      return query;
    }),
  } as unknown as Database;
  return database;
}

describe("Group financial participant locks", () => {
  it("locks an active Group before its participant and membership rows", async () => {
    const events: string[] = [];
    const database = databaseFor(events);
    mocks.lockActiveGroupForOperationalMutation.mockImplementationOnce(async (transaction: Database, id: string) => {
      expect(transaction).toBe(database);
      expect(id).toBe(groupId);
      events.push("lifecycle");
    });

    const locked = await lockGroupFinancialParticipants(database, groupId, [...participantIds].reverse());

    expect([...locked.participants.keys()]).toHaveLength(2);
    expect([...locked.memberships.keys()]).toHaveLength(2);
    expect(events).toEqual(["lifecycle", "participants", "lock:update", "memberships", "lock:update"]);
  });

  it("rejects an archived Group before reading financial participants", async () => {
    const events: string[] = [];
    const database = databaseFor(events);
    mocks.lockActiveGroupForOperationalMutation.mockRejectedValueOnce(Object.assign(new Error("archived"), { code: "archived" }));

    await expect(lockGroupFinancialParticipants(database, groupId, participantIds)).rejects.toMatchObject({ code: "archived" });
    expect(database.select).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
