import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { CHAT_PAGE_SIZE } from "../src/domain/chat";
import { getPersonalLedgerScopeId } from "../src/server/ledger-scopes";
import { SCALE_FIXTURE_CONFIRMATION, SCALE_FIXTURE_DATABASE } from "./scale-fixture-data";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { listGroups } = await import("../src/server/groups");
const { listOrganizations } = await import("../src/server/organizations");
const { getGroupChat, getOrganizationChat } = await import("../src/server/chat");
const { NOTIFICATIONS_PAGE_SIZE } = await import("../src/server/notifications");

const BUDGETS = {
  notifications: 500,
  unread: 300,
  groupChat: 500,
  groupChatHistory: 500,
  organizationChat: 500,
} as const;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(label: string, budget: number, operation: () => Promise<unknown>) {
  await operation();
  const durations: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  const result = median(durations);
  console.log(`${label} warm median: ${result.toFixed(1)} ms (budget ${budget} ms)`);
  assert(result <= budget, `${label} warm median exceeded ${budget} ms`);
}

async function resolveOwner(client: PoolClient, email: string) {
  const result = await client.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  assert(result.rows.length === 1, "SCALE_TEST_OWNER_EMAIL must resolve exactly one existing test user");
  return result.rows[0]!.id;
}

async function run() {
  assert(process.env.DB_NAME?.trim() === SCALE_FIXTURE_DATABASE, `DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
  assert(process.env.ZPLIT_SCALE_TEST_CONFIRM?.trim() === SCALE_FIXTURE_CONFIRMATION, `ZPLIT_SCALE_TEST_CONFIRM must be ${SCALE_FIXTURE_CONFIRMATION}`);
  const ownerEmail = required("SCALE_TEST_OWNER_EMAIL");
  const pool = createDatabasePool(readRuntimeDatabaseConfig());
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transactionStarted = true;
    const userId = await resolveOwner(client, ownerEmail);
    const database = drizzle(client, { schema });
    await getPersonalLedgerScopeId(database, userId);

    // Inbox primary bounded read path: total count plus one page, mirroring
    // the production notification page shape without requiring a session.
    const readNotificationPage = async (page: number) => {
      const [total] = await database
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.notifications)
        .where(eq(schema.notifications.recipientUserId, userId));
      const rows = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.recipientUserId, userId))
        .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
        .limit(NOTIFICATIONS_PAGE_SIZE)
        .offset((page - 1) * NOTIFICATIONS_PAGE_SIZE);
      return { total: Number(total?.total ?? 0), rows };
    };
    const readUnreadCount = async () => {
      const [row] = await database
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.notifications)
        .where(and(eq(schema.notifications.recipientUserId, userId), isNull(schema.notifications.readAt)));
      return Number(row?.total ?? 0);
    };

    const firstPage = await readNotificationPage(1);
    assert(firstPage.total >= 200, "notification fixture volume is missing");
    assert(firstPage.rows.length <= NOTIFICATIONS_PAGE_SIZE, "notification page is not bounded");
    const unread = await readUnreadCount();
    assert(unread > 0 && unread < firstPage.total, "notification read/unread mix is missing");
    const secondPage = await readNotificationPage(2);
    const firstIds = new Set(firstPage.rows.map((row) => row.id));
    assert(secondPage.rows.every((row) => !firstIds.has(row.id)), "adjacent notification pages overlap");

    const groups = await listGroups(database, userId);
    const denseGroup = groups.find((group) => group.name === "Japan Trip 2026");
    assert(denseGroup, "dense Japan Trip 2026 group is missing");
    const chat = await getGroupChat(database, denseGroup.id, userId);
    assert(chat.messages.length > 0 && chat.messages.length <= CHAT_PAGE_SIZE, "group chat page is not bounded");
    assert(chat.nextCursor, "dense group chat has no history cursor");
    const history = await getGroupChat(database, denseGroup.id, userId, chat.nextCursor);
    assert(history.messages.length <= CHAT_PAGE_SIZE, "group chat history page is not bounded");
    const historyIds = new Set(history.messages.map((message) => message.id));
    assert(chat.messages.every((message) => !historyIds.has(message.id)), "adjacent chat pages overlap");

    const organizations = await listOrganizations(database, userId);
    const denseOrg = organizations.find((organization) => organization.name === "Engineering Guild");
    assert(denseOrg, "dense Engineering Guild organization is missing");
    const orgChat = await getOrganizationChat(database, denseOrg.id, userId);
    assert(orgChat.messages.length <= CHAT_PAGE_SIZE, "organization chat page is not bounded");

    await measure("Notifications page", BUDGETS.notifications, () => readNotificationPage(1));
    await measure("Notifications unread", BUDGETS.unread, () => readUnreadCount());
    await measure("Group chat", BUDGETS.groupChat, () => getGroupChat(database, denseGroup.id, userId));
    await measure("Group chat history", BUDGETS.groupChatHistory, () => getGroupChat(database, denseGroup.id, userId, chat.nextCursor));
    await measure("Organization chat", BUDGETS.organizationChat, () => getOrganizationChat(database, denseOrg.id, userId));
    console.log("collaboration scale smoke passed: bounded inbox, long-thread history, org chat, and warm medians verified");
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
    console.error(error instanceof Error ? error.message : "collaboration scale smoke failed");
    process.exitCode = 1;
  });
}
