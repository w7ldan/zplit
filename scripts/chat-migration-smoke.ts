import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import * as schema from "../src/db/schema";
import { formatSafeError, readDatabaseConfig, type DatabaseConfig } from "./migrate.js";
import { resolveOrganizationCapabilities } from "../src/domain/organization-permissions";

const migrationDirectory = new URL("../drizzle/", import.meta.url);

function migrationFiles(before: number) {
  return readdirSync(migrationDirectory).filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) < before).sort();
}

function statements(file: string) {
  return readFileSync(new URL(file, migrationDirectory), "utf8").split("--> statement-breakpoint").filter((statement) => statement.trim());
}

async function applyMigration(client: PoolClient, file: string) {
  for (const statement of statements(file)) await client.query(statement);
}

async function expectCode(client: PoolClient, code: string, statement: string, values: unknown[]) {
  await client.query("BEGIN");
  try {
    await client.query(statement, values);
    throw new Error(`expected PostgreSQL error ${code}`);
  } catch (error) {
    if ((error as { code?: string }).code !== code) throw error;
  } finally {
    await client.query("ROLLBACK");
  }
}

async function seed(client: PoolClient) {
  const ids = { userA: randomUUID(), userB: randomUUID(), adminUser: randomUUID(), customReader: randomUUID(), hiddenReader: randomUUID(), otherOrgUser: randomUUID(), organization: randomUUID(), otherOrganization: randomUUID(), groupA: randomUUID(), groupB: randomUUID(), participantA: randomUUID(), participantB: randomUUID(), expense: randomUUID(), chatThread: randomUUID(), chatMessage: randomUUID() };
  await client.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Stage 17 A', $2, true), ($3, 'Stage 17 B', $4, true), ($5, 'Stage 17 Admin', $6, true), ($7, 'Stage 17 Custom', $8, true), ($9, 'Stage 17 Hidden', $10, true), ($11, 'Stage 17 Other Org', $12, true)", [ids.userA, `${ids.userA}@stage17.test`, ids.userB, `${ids.userB}@stage17.test`, ids.adminUser, `${ids.adminUser}@stage17.test`, ids.customReader, `${ids.customReader}@stage17.test`, ids.hiddenReader, `${ids.hiddenReader}@stage17.test`, ids.otherOrgUser, `${ids.otherOrgUser}@stage17.test`]);
  await client.query("INSERT INTO organizations (id, name) VALUES ($1, 'Stage 17 Organization'), ($2, 'Stage 17 Other Organization')", [ids.organization, ids.otherOrganization]);
  await client.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'admin')", [ids.organization, ids.userA, ids.userB, ids.adminUser]);
  await client.query("INSERT INTO organization_memberships (organization_id, user_id, role, custom_capabilities) VALUES ($1, $2, 'custom', $3::jsonb), ($1, $4, 'custom', $5::jsonb)", [ids.organization, ids.customReader, '[\"chat.view\"]', ids.hiddenReader, '[]']);
  await client.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')", [ids.otherOrganization, ids.otherOrgUser]);
  await client.query("INSERT INTO groups (id, name, created_by_user_id) VALUES ($1, 'Stage 17 Group A', $3), ($2, 'Stage 17 Group B', $4)", [ids.groupA, ids.groupB, ids.userA, ids.userB]);
  await client.query("INSERT INTO group_participants (id, group_id, user_id) VALUES ($1, $3, $4), ($2, $6, $5)", [ids.participantA, ids.participantB, ids.groupA, ids.userA, ids.userB, ids.groupB]);
  await client.query("INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES ($1, $2, $3, 'owner'), ($4, $5, $6, 'owner')", [ids.groupA, ids.userA, ids.participantA, ids.groupB, ids.userB, ids.participantB]);
  await client.query("INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, confirmed_at, created_at, updated_at) VALUES ($1, $2, $3, $3, 'Existing expense', '2026-08-30T00:00:00Z', 100, 'pending', NULL, '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')", [ids.expense, ids.groupA, ids.participantA]);
  await client.query("INSERT INTO chat_threads (id, organization_id) VALUES ($1, $2)", [ids.chatThread, ids.organization]);
  await client.query("INSERT INTO chat_messages (id, thread_id, organization_id, sender_user_id, body, created_at) VALUES ($1, $2, $3, $4, 'Existing chat message', '2026-08-30T00:00:00Z')", [ids.chatMessage, ids.chatThread, ids.organization, ids.userA]);
  return ids;
}

async function insertJournalEntry(client: PoolClient, entry: { idx: number; tag: string; when: number }) {
  const sql = readFileSync(new URL(`${entry.tag}.sql`, migrationDirectory));
  await client.query("INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)", [entry.idx + 1, createHash("sha256").update(sql).digest("hex"), entry.when]);
}

async function waitForLock(client: PoolClient, queryPart: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await client.query<{ waiting: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND state = 'active' AND query LIKE $1) AS waiting", [`%${queryPart}%`]);
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("concurrent chat read update did not reach the row lock");
}

type ChatSmokeIds = Awaited<ReturnType<typeof seed>>;

async function verifyPrecision(client: PoolClient, ids: ChatSmokeIds) {
  const precisionMessages = {
    m0: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    m1: "22222222-2222-4222-8222-222222222222",
    m2: "11111111-1111-4111-8111-111111111111",
    m3: "00000000-0000-4000-8000-000000000000",
  };
  const precisionMessageIds = Object.values(precisionMessages);
  await client.query("INSERT INTO chat_messages (id, thread_id, organization_id, sender_user_id, body, created_at) VALUES ($1, $2, $3, $4, 'Precision zero', '2026-08-30T00:00:00.123000Z'), ($5, $2, $3, $6, 'Precision one', '2026-08-30T00:00:00.123100Z'), ($7, $2, $3, $6, 'Precision two', '2026-08-30T00:00:00.123500Z'), ($8, $2, $3, $4, 'Precision three', '2026-08-30T00:00:00.123900Z')", [precisionMessages.m0, ids.chatThread, ids.organization, ids.userA, precisionMessages.m1, ids.userB, precisionMessages.m2, precisionMessages.m3]);
  await client.query("INSERT INTO chat_thread_reads (thread_id, user_id, last_read_message_id) VALUES ($1, $2, $3), ($1, $4, $5), ($1, $6, $5), ($1, $7, $5), ($1, $8, $5), ($1, $9, $5) ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id", [ids.chatThread, ids.userA, precisionMessages.m1, ids.userB, precisionMessages.m2, ids.adminUser, ids.customReader, ids.hiddenReader, ids.otherOrgUser]);
  const preciseUnread = await client.query<{ id: string }>("SELECT messages.id FROM chat_messages messages LEFT JOIN chat_thread_reads reads ON reads.thread_id = messages.thread_id AND reads.user_id = $2 LEFT JOIN chat_messages cursor_message ON cursor_message.id = reads.last_read_message_id WHERE messages.thread_id = $1 AND messages.id = ANY($3::uuid[]) AND messages.sender_user_id <> $2 AND messages.deleted_at IS NULL AND (reads.last_read_message_id IS NULL OR (messages.created_at, messages.id) > (cursor_message.created_at, cursor_message.id)) ORDER BY messages.created_at, messages.id", [ids.chatThread, ids.userA, [precisionMessages.m0, precisionMessages.m1, precisionMessages.m2, precisionMessages.m3]]);
  assert(preciseUnread.rows.length === 1, "microsecond unread returned the wrong message count");
  assert(preciseUnread.rows[0]?.id === precisionMessages.m2, "microsecond unread ordering collapsed the cursor message");
  const memberRows = await client.query<{ user_id: string; name: string; role: string; custom_capabilities: unknown }>("SELECT memberships.user_id, users.name, memberships.role, memberships.custom_capabilities FROM organization_memberships memberships JOIN users ON users.id = memberships.user_id WHERE memberships.organization_id = $1", [ids.organization]);
  const eligibleReaders = memberRows.rows.filter((row) => resolveOrganizationCapabilities(row.role, row.custom_capabilities).has("chat.view"));
  const eligibleReaderIds = eligibleReaders.map(({ user_id }) => user_id);
  assert(eligibleReaders.length === 4, "Organization chat.view eligibility count is incorrect");
  assert(eligibleReaders.some(({ name }) => name === "Stage 17 A"), "owner chat.view eligibility is incorrect");
  assert(eligibleReaders.some(({ name }) => name === "Stage 17 B"), "member chat.view eligibility is incorrect");
  assert(eligibleReaders.some(({ name }) => name === "Stage 17 Admin"), "admin chat.view eligibility is incorrect");
  assert(eligibleReaders.some(({ name }) => name === "Stage 17 Custom"), "custom chat.view eligibility is incorrect");
  assert(!eligibleReaders.some(({ name }) => name === "Stage 17 Hidden"), "custom member without chat.view is eligible");
  const receiptRows = await client.query<{ message_id: string; name: string }>("SELECT messages.id AS message_id, users.name FROM chat_messages messages JOIN chat_thread_reads reads ON reads.thread_id = $1 AND reads.user_id = ANY($2::text[]) JOIN chat_messages cursor_message ON cursor_message.id = reads.last_read_message_id JOIN users ON users.id = reads.user_id WHERE messages.thread_id = $1 AND messages.id = ANY($3::uuid[]) AND messages.sender_user_id <> reads.user_id AND (cursor_message.created_at, cursor_message.id) >= (messages.created_at, messages.id)", [ids.chatThread, eligibleReaderIds, precisionMessageIds]);
  const receiptNames = (messageId: string) => receiptRows.rows.filter((row) => row.message_id === messageId).map(({ name }) => name);
  const zeroReceipts = receiptNames(precisionMessages.m0);
  assert(zeroReceipts.length === 4, "member, admin, or custom chat.view receipt was lost");
  assert(zeroReceipts.includes("Stage 17 B"), "member receipt was lost");
  assert(zeroReceipts.includes("Stage 17 Admin"), "admin receipt was lost");
  assert(zeroReceipts.includes("Stage 17 Custom"), "custom chat.view receipt was lost");
  const oneReceipts = receiptNames(precisionMessages.m1);
  assert(oneReceipts.length === 3, "microsecond Seen by ordering is incorrect at M1");
  assert(oneReceipts.includes("Stage 17 A"), "owner Seen by ordering is incorrect at M1");
  assert(oneReceipts.includes("Stage 17 Admin"), "admin Seen by ordering is incorrect at M1");
  assert(oneReceipts.includes("Stage 17 Custom"), "custom Seen by ordering is incorrect at M1");
  const twoReceipts = receiptNames(precisionMessages.m2);
  assert(twoReceipts.length === 2, "microsecond Seen by ordering is incorrect at M2");
  assert(twoReceipts.includes("Stage 17 Admin"), "admin Seen by ordering is incorrect at M2");
  assert(twoReceipts.includes("Stage 17 Custom"), "custom Seen by ordering is incorrect at M2");
  assert(receiptNames(precisionMessages.m3).length === 0, "microsecond Seen by ordering marked M3 as seen");
  assert(!receiptRows.rows.some(({ name }) => name === "Stage 17 Hidden"), "ineligible Organization reader appeared in Seen by");
  assert(!receiptRows.rows.some(({ name }) => name === "Stage 17 Other Org"), "unrelated Organization reader appeared in Seen by");
  await client.query("UPDATE organization_memberships SET custom_capabilities = '[]'::jsonb WHERE organization_id = $1 AND user_id = $2", [ids.organization, ids.customReader]);
  const afterMemberRows = await client.query<{ user_id: string; name: string; role: string; custom_capabilities: unknown }>("SELECT memberships.user_id, users.name, memberships.role, memberships.custom_capabilities FROM organization_memberships memberships JOIN users ON users.id = memberships.user_id WHERE memberships.organization_id = $1", [ids.organization]);
  const afterEligibleReaders = afterMemberRows.rows.filter((row) => resolveOrganizationCapabilities(row.role, row.custom_capabilities).has("chat.view"));
  assert(!afterEligibleReaders.some(({ name }) => name === "Stage 17 Custom"), "removed chat.view capability did not remove the active receipt");
  const preservedRead = await client.query<{ last_read_message_id: string }>("SELECT last_read_message_id FROM chat_thread_reads WHERE thread_id = $1 AND user_id = $2", [ids.chatThread, ids.customReader]);
  assert(preservedRead.rows[0]?.last_read_message_id === precisionMessages.m2, "capability removal deleted historical read state");
}

async function runMigrationSmoke(config: DatabaseConfig) {
  const temporaryDatabase = `zplit_stage17_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ ...config, database: "postgres", max: 1 });
  let pool: Pool | undefined;
  try {
    await adminPool.query(`CREATE DATABASE "${temporaryDatabase}"`);
    pool = new Pool({ ...config, database: temporaryDatabase, max: 4 });
    const client = await pool.connect();
    try {
      for (const file of migrationFiles(31)) await applyMigration(client, file);
      await client.query("CREATE SCHEMA drizzle");
      await client.query("CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
      const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ idx: number; tag: string; when: number }> };
      for (const entry of journal.entries.filter(({ idx }) => idx < 31)) {
        const sql = readFileSync(new URL(`${entry.tag}.sql`, migrationDirectory));
        await client.query("INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)", [entry.idx + 1, createHash("sha256").update(sql).digest("hex"), entry.when]);
      }
      await client.query("SELECT setval('drizzle.__drizzle_migrations_id_seq', 31, true)");
      const migration31 = journal.entries.find(({ tag }) => tag === "0031_skinny_komodo");
      if (!migration31) throw new Error("0031 migration journal entry is missing");
      await applyMigration(client, "0031_skinny_komodo.sql");
      await insertJournalEntry(client, migration31);
      await client.query("SELECT setval('drizzle.__drizzle_migrations_id_seq', 32, true)");
      const ids = await seed(client);
      const before = await client.query("SELECT 'organizations' AS table_name, id::text, name FROM organizations UNION ALL SELECT 'groups', id::text, name FROM groups UNION ALL SELECT 'group_expenses', id::text, description FROM group_expenses UNION ALL SELECT 'chat_threads', id::text, organization_id::text FROM chat_threads UNION ALL SELECT 'chat_messages', id::text, body FROM chat_messages ORDER BY table_name, id");
      const database = drizzle(client, { schema });
      await migrate(database, { migrationsFolder: "./drizzle" });
      await migrate(database, { migrationsFolder: "./drizzle" });
      const after = await client.query("SELECT 'organizations' AS table_name, id::text, name FROM organizations UNION ALL SELECT 'groups', id::text, name FROM groups UNION ALL SELECT 'group_expenses', id::text, description FROM group_expenses UNION ALL SELECT 'chat_threads', id::text, organization_id::text FROM chat_threads UNION ALL SELECT 'chat_messages', id::text, body FROM chat_messages ORDER BY table_name, id");
      assert(JSON.stringify(before.rows) === JSON.stringify(after.rows), "0032 changed existing entity, financial, or chat data");
      const tables = await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [["chat_threads", "chat_messages", "chat_thread_reads"]]);
      assert(tables.rows[0]?.count === 3, "0032 did not create the chat read table");
      const empty = await client.query("SELECT count(*)::int AS reads FROM chat_thread_reads");
      assert(empty.rows[0]?.reads === 0, "read state was backfilled");
      await client.query("INSERT INTO chat_threads (organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [ids.organization]);
      await client.query("INSERT INTO chat_threads (organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [ids.organization]);
      await client.query("INSERT INTO chat_threads (group_id) VALUES ($1) ON CONFLICT DO NOTHING", [ids.groupA]);
      const unique = await client.query("SELECT count(*)::int AS count FROM chat_threads");
      assert(unique.rows[0]?.count === 2, "entity thread uniqueness failed");
      await expectCode(client, "23514", "INSERT INTO chat_threads (id) VALUES ($1)", [randomUUID()]);
      const groupThread = await client.query<{ id: string }>("SELECT id FROM chat_threads WHERE group_id = $1", [ids.groupA]);
      await client.query("INSERT INTO chat_messages (thread_id, group_id, sender_user_id, sender_participant_id, body) VALUES ($1, $2, $3, $4, 'valid')", [groupThread.rows[0]?.id, ids.groupA, ids.userA, ids.participantA]);
      await expectCode(client, "23503", "INSERT INTO chat_messages (thread_id, group_id, sender_user_id, sender_participant_id, body) VALUES ($1, $2, $3, $4, 'cross-scope')", [groupThread.rows[0]?.id, ids.groupA, ids.userB, ids.participantB]);

      const groupMessage = await client.query<{ id: string }>("SELECT id FROM chat_messages WHERE group_id = $1 ORDER BY created_at, id LIMIT 1", [ids.groupA]);
      await client.query("INSERT INTO chat_thread_reads (thread_id, user_id, last_read_message_id) VALUES ($1, $2, $3)", [ids.chatThread, ids.userA, ids.chatMessage]);
      await expectCode(client, "23503", "INSERT INTO chat_thread_reads (thread_id, user_id, last_read_message_id) VALUES ($1, $2, $3)", [ids.chatThread, ids.userA, groupMessage.rows[0]?.id]);
      const oneReadRow = await client.query("SELECT count(*)::int AS count FROM chat_thread_reads WHERE thread_id = $1 AND user_id = $2", [ids.chatThread, ids.userA]);
      assert(oneReadRow.rows[0]?.count === 1, "read state is not unique per thread and user");
      const unreadMessages = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      await client.query("INSERT INTO chat_messages (id, thread_id, organization_id, sender_user_id, body, created_at, deleted_at, deleted_by_user_id) VALUES ($1, $2, $3, $4, 'Unread one', '2026-08-30T00:03:00Z', NULL, NULL), ($5, $2, $3, $8, 'Own message', '2026-08-30T00:04:00Z', NULL, NULL), ($6, $2, $3, $4, 'Deleted message', '2026-08-30T00:05:00Z', '2026-08-30T00:05:01Z', $4), ($7, $2, $3, $4, 'Unread two', '2026-08-30T00:06:00Z', NULL, NULL)", [unreadMessages[0], ids.chatThread, ids.organization, ids.userB, unreadMessages[1], unreadMessages[2], unreadMessages[3], ids.userA]);
      await client.query("UPDATE chat_thread_reads SET last_read_message_id = $3 WHERE thread_id = $1 AND user_id = $2", [ids.chatThread, ids.userA, unreadMessages[0]]);
      const unread = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM chat_messages messages LEFT JOIN chat_thread_reads reads ON reads.thread_id = messages.thread_id AND reads.user_id = $2 LEFT JOIN chat_messages cursor_message ON cursor_message.id = reads.last_read_message_id WHERE messages.thread_id = $1 AND messages.sender_user_id <> $2 AND messages.deleted_at IS NULL AND (reads.last_read_message_id IS NULL OR (messages.created_at, messages.id) > (cursor_message.created_at, cursor_message.id))", [ids.chatThread, ids.userA]);
      assert(unread.rows[0]?.count === 1, "unread count included an own or deleted message");
      await verifyPrecision(client, ids);
      const olderMessage = randomUUID();
      const newerMessage = randomUUID();
      await client.query("INSERT INTO chat_messages (id, thread_id, organization_id, sender_user_id, body, created_at) VALUES ($1, $2, $3, $4, 'Older concurrency message', '2026-08-30T00:01:00Z'), ($5, $2, $3, $4, 'Newer concurrency message', '2026-08-30T00:02:00Z')", [olderMessage, ids.chatThread, ids.organization, ids.userA, newerMessage]);
      await client.query("INSERT INTO chat_thread_reads (thread_id, user_id, last_read_message_id) VALUES ($1, $2, $3) ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id", [ids.chatThread, ids.userB, olderMessage]);
      const advanceRead = `INSERT INTO chat_thread_reads (thread_id, user_id, last_read_message_id) VALUES ($1, $2, $3)
        ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id, updated_at = now()
        WHERE chat_thread_reads.last_read_message_id IS NULL OR EXISTS (
          SELECT 1 FROM chat_messages AS current_message
          JOIN chat_messages AS candidate_message ON candidate_message.id = EXCLUDED.last_read_message_id
          WHERE current_message.id = chat_thread_reads.last_read_message_id
            AND candidate_message.thread_id = current_message.thread_id
            AND (candidate_message.created_at, candidate_message.id) > (current_message.created_at, current_message.id)
        )`;
      const newerFirst = await pool.connect();
      const olderAfterNewer = await pool.connect();
      try {
        await newerFirst.query("BEGIN");
        await newerFirst.query(advanceRead, [ids.chatThread, ids.userB, newerMessage]);
        const olderUpdate = (async () => {
          await olderAfterNewer.query("BEGIN");
          await olderAfterNewer.query(advanceRead, [ids.chatThread, ids.userB, olderMessage]);
          await olderAfterNewer.query("COMMIT");
        })();
        await waitForLock(client, "INSERT INTO chat_thread_reads");
        await newerFirst.query("COMMIT");
        await olderUpdate;
      } finally {
        newerFirst.release();
        olderAfterNewer.release();
      }
      const newerCursor = await client.query<{ last_read_message_id: string }>("SELECT last_read_message_id FROM chat_thread_reads WHERE thread_id = $1 AND user_id = $2", [ids.chatThread, ids.userB]);
      assert(newerCursor.rows[0]?.last_read_message_id === newerMessage, "newer concurrent read was overwritten by an older read");

      await client.query("UPDATE chat_thread_reads SET last_read_message_id = $3 WHERE thread_id = $1 AND user_id = $2", [ids.chatThread, ids.userB, olderMessage]);
      const olderFirst = await pool.connect();
      const newerAfterOlder = await pool.connect();
      try {
        await olderFirst.query("BEGIN");
        await olderFirst.query("SELECT 1 FROM chat_thread_reads WHERE thread_id = $1 AND user_id = $2 FOR UPDATE", [ids.chatThread, ids.userB]);
        await olderFirst.query(advanceRead, [ids.chatThread, ids.userB, olderMessage]);
        const newerUpdate = (async () => {
          await newerAfterOlder.query("BEGIN");
          await newerAfterOlder.query(advanceRead, [ids.chatThread, ids.userB, newerMessage]);
          await newerAfterOlder.query("COMMIT");
        })();
        await waitForLock(client, "INSERT INTO chat_thread_reads");
        await olderFirst.query("COMMIT");
        await newerUpdate;
      } finally {
        olderFirst.release();
        newerAfterOlder.release();
      }
      const finalCursor = await client.query<{ last_read_message_id: string }>("SELECT last_read_message_id FROM chat_thread_reads WHERE thread_id = $1 AND user_id = $2", [ids.chatThread, ids.userB]);
      assert(finalCursor.rows[0]?.last_read_message_id === newerMessage, "newer concurrent read did not win after an older commit");
      const concurrent = await Promise.all([pool.connect(), pool.connect()]);
      await Promise.all(concurrent.map((connection) => connection.query("INSERT INTO chat_threads (group_id) VALUES ($1) ON CONFLICT DO NOTHING", [ids.groupB])));
      concurrent.forEach((connection) => connection.release());
      const concurrentCount = await client.query("SELECT count(*)::int AS count FROM chat_threads WHERE group_id = $1", [ids.groupB]);
      assert(concurrentCount.rows[0]?.count === 1, "concurrent first creation duplicated the Group thread");
      const migrationRows = await client.query("SELECT id FROM drizzle.__drizzle_migrations ORDER BY id");
      assert(migrationRows.rows.length === 33 && Number(migrationRows.rows.at(-1)?.id) === 33, "0032 migration journal rerun is not idempotent");
    } finally {
      client.release();
    }
  } finally {
    await pool?.end();
    await adminPool.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}"`);
    await adminPool.end();
  }
}

export async function runChatMigrationSmoke() {
  const config = readDatabaseConfig("zplit_test");
  try {
    await runMigrationSmoke(config);
    console.log("chat migration smoke passed");
  } catch (error) {
    console.error(`chat migration smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("chat-migration-smoke.ts")) await runChatMigrationSmoke();
