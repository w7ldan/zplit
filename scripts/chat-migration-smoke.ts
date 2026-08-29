import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { formatSafeError, readDatabaseConfig, type DatabaseConfig } from "./migrate.js";

const migrationDirectory = new URL("../drizzle/", import.meta.url);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
  const ids = { userA: randomUUID(), userB: randomUUID(), organization: randomUUID(), groupA: randomUUID(), groupB: randomUUID(), participantA: randomUUID(), participantB: randomUUID(), expense: randomUUID() };
  await client.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Stage 17 A', $2, true), ($3, 'Stage 17 B', $4, true)", [ids.userA, `${ids.userA}@stage17.test`, ids.userB, `${ids.userB}@stage17.test`]);
  await client.query("INSERT INTO organizations (id, name) VALUES ($1, 'Stage 17 Organization')", [ids.organization]);
  await client.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')", [ids.organization, ids.userA, ids.userB]);
  await client.query("INSERT INTO groups (id, name, created_by_user_id) VALUES ($1, 'Stage 17 Group A', $3), ($2, 'Stage 17 Group B', $4)", [ids.groupA, ids.groupB, ids.userA, ids.userB]);
  await client.query("INSERT INTO group_participants (id, group_id, user_id) VALUES ($1, $3, $4), ($2, $6, $5)", [ids.participantA, ids.participantB, ids.groupA, ids.userA, ids.userB, ids.groupB]);
  await client.query("INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES ($1, $2, $3, 'owner'), ($4, $5, $6, 'owner')", [ids.groupA, ids.userA, ids.participantA, ids.groupB, ids.userB, ids.participantB]);
  await client.query("INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, confirmed_at, created_at, updated_at) VALUES ($1, $2, $3, $3, 'Existing expense', '2026-08-30T00:00:00Z', 100, 'pending', NULL, '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')", [ids.expense, ids.groupA, ids.participantA]);
  return ids;
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
      const ids = await seed(client);
      const before = await client.query("SELECT 'organizations' AS table_name, id::text, name FROM organizations UNION ALL SELECT 'groups', id::text, name FROM groups UNION ALL SELECT 'group_expenses', id::text, description FROM group_expenses ORDER BY table_name, id");
      const database = drizzle(client);
      await migrate(database, { migrationsFolder: "./drizzle" });
      await migrate(database, { migrationsFolder: "./drizzle" });
      const after = await client.query("SELECT 'organizations' AS table_name, id::text, name FROM organizations UNION ALL SELECT 'groups', id::text, name FROM groups UNION ALL SELECT 'group_expenses', id::text, description FROM group_expenses ORDER BY table_name, id");
      assert(JSON.stringify(before.rows) === JSON.stringify(after.rows), "0031 changed existing entity or financial data");
      const tables = await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [["chat_threads", "chat_messages"]]);
      assert(tables.rows[0]?.count === 2, "0031 did not create both chat tables");
      const empty = await client.query("SELECT (SELECT count(*) FROM chat_threads) AS threads, (SELECT count(*) FROM chat_messages) AS messages");
      assert(empty.rows[0]?.threads === "0" && empty.rows[0]?.messages === "0", "chat tables were not empty after migration");
      await client.query("INSERT INTO chat_threads (organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [ids.organization]);
      await client.query("INSERT INTO chat_threads (organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [ids.organization]);
      await client.query("INSERT INTO chat_threads (group_id) VALUES ($1) ON CONFLICT DO NOTHING", [ids.groupA]);
      const unique = await client.query("SELECT count(*)::int AS count FROM chat_threads");
      assert(unique.rows[0]?.count === 2, "entity thread uniqueness failed");
      await expectCode(client, "23514", "INSERT INTO chat_threads (id) VALUES ($1)", [randomUUID()]);
      const groupThread = await client.query<{ id: string }>("SELECT id FROM chat_threads WHERE group_id = $1", [ids.groupA]);
      await client.query("INSERT INTO chat_messages (thread_id, group_id, sender_user_id, sender_participant_id, body) VALUES ($1, $2, $3, $4, 'valid')", [groupThread.rows[0]?.id, ids.groupA, ids.userA, ids.participantA]);
      await expectCode(client, "23503", "INSERT INTO chat_messages (thread_id, group_id, sender_user_id, sender_participant_id, body) VALUES ($1, $2, $3, $4, 'cross-scope')", [groupThread.rows[0]?.id, ids.groupA, ids.userB, ids.participantB]);
      const concurrent = await Promise.all([pool.connect(), pool.connect()]);
      await Promise.all(concurrent.map((connection) => connection.query("INSERT INTO chat_threads (group_id) VALUES ($1) ON CONFLICT DO NOTHING", [ids.groupB])));
      concurrent.forEach((connection) => connection.release());
      const concurrentCount = await client.query("SELECT count(*)::int AS count FROM chat_threads WHERE group_id = $1", [ids.groupB]);
      assert(concurrentCount.rows[0]?.count === 1, "concurrent first creation duplicated the Group thread");
      const migrationRows = await client.query("SELECT id FROM drizzle.__drizzle_migrations ORDER BY id");
      assert(migrationRows.rows.length === 32 && Number(migrationRows.rows.at(-1)?.id) === 32, "0031 migration journal rerun is not idempotent");
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
  if (process.env.DB_NAME !== "zplit_test") throw new Error("Chat migration smoke requires DB_NAME=zplit_test");
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
