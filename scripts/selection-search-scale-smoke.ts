import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { SCALE_FIXTURE_DATABASE, generateScaleFixture } from "./scale-fixture-data";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(label: string, operation: () => Promise<unknown>) {
  await operation();
  const durations: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  const result = median(durations);
  console.log(`${label} warm median: ${result.toFixed(1)} ms`);
  assert(result <= 300, `${label} warm median exceeded 300 ms`);
}

async function resolveOwner(client: PoolClient, email: string) {
  const result = await client.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  assert(result.rows.length === 1, "SCALE_TEST_OWNER_EMAIL must resolve exactly one existing test user");
  return result.rows[0]!.id;
}

async function run() {
  assert(process.env.DB_NAME?.trim() === SCALE_FIXTURE_DATABASE, `DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
  const ownerEmail = required("SCALE_TEST_OWNER_EMAIL");
  const pool = createDatabasePool(readRuntimeDatabaseConfig());
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transactionStarted = true;
    const ownerUserId = await resolveOwner(client, ownerEmail);
    const repository = createLedgerRepository(drizzle(client, { schema }), ownerUserId);
    const fixture = generateScaleFixture(ownerUserId);
    const selectedOutingId = fixture.outings.at(-1)!.id;
    const selectedFriendId = fixture.friends.at(-1)!.id;

    const checkBound = (label: string, options: Array<{ id: string }>) => {
      assert(options.length <= 20, `${label} returned more than 20 options`);
      assert(options.every((option) => Object.keys(option).length >= 1 && option.id), `${label} returned an invalid option`);
    };
    const checkOutings = async () => {
      const options = await repository.searchOutings();
      checkBound("empty outing search", options);
      return options;
    };
    const checkFriends = async () => {
      const options = await repository.searchFriends();
      checkBound("empty friend search", options);
      const archivedIndex = options.findIndex((friend) => friend.archived);
      assert(archivedIndex < 0 || options.slice(archivedIndex).every((friend) => friend.archived), "active friends must precede archived friends");
      return options;
    };

    await measure("Outings empty", checkOutings);
    await measure("Outings search", async () => {
      const options = await repository.searchOutings({ q: "Scale outing 2" });
      checkBound("outing search", options);
      return options;
    });
    await measure("Friends empty", checkFriends);
    await measure("Friends search", async () => {
      const options = await repository.searchFriends({ q: "Scale friend 0" });
      checkBound("friend search", options);
      return options;
    });

    const selectedOuting = await repository.searchOutings({ q: "does-not-match", selectedId: selectedOutingId });
    assert(selectedOuting.some((option) => option.id === selectedOutingId), "selected outing was dropped from search results");
    const selectedFriend = await repository.searchFriends({ q: "does-not-match", selectedId: selectedFriendId });
    assert(selectedFriend.some((option) => option.id === selectedFriendId), "selected friend was dropped from search results");
    console.log("selection-search scale smoke passed: bounded, owner-scoped, read-only searches verified");
    await client.query("ROLLBACK");
    transactionStarted = false;
  } finally {
    if (client && transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run().catch((error) => {
    console.error(error instanceof Error ? error.message : "selection-search scale smoke failed");
    process.exitCode = 1;
  });
}
