import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.STAGE5_MIGRATION_DATABASE_URL?.trim();
const databaseName = databaseUrl ? decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) : "";
const migrationDirectory = path.resolve(process.cwd(), "drizzle");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => /^00(?:0\d|1[0-7])_.*\.sql$/.test(file))
  .sort();

async function applyMigration(client: Client, file: string) {
  for (const statement of readFileSync(path.join(migrationDirectory, file), "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

describe("Stage 5 migration 0018", () => {
  it.skipIf(!databaseUrl)("backfills accepted Friend links without changing ledger history", async () => {
    if (databaseName !== "zplit_stage5_migration_test") throw new Error("STAGE5_MIGRATION_DATABASE_URL must name zplit_stage5_migration_test");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DROP SCHEMA public CASCADE");
      await client.query("CREATE SCHEMA public");
      for (const file of migrationFiles) await applyMigration(client, file);

      await client.query(`
        INSERT INTO users (id, name, email, username) VALUES
          ('wildan', 'Wildan', 'wildan@stage5.test', 'wildan'),
          ('alice', 'Alice', 'alice@stage5.test', 'alice')
      `);
      await client.query(`
        INSERT INTO friends (id, owner_user_id, linked_user_id, name, phone_number, notes, created_at, updated_at) VALUES
          ('11111111-1111-4111-8111-111111111111', 'wildan', 'alice', 'Alice', '+62123', 'accepted link', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
          ('22222222-2222-4222-8222-222222222222', 'alice', 'wildan', 'Wildan', NULL, NULL, '2026-01-02T00:00:00Z', '2026-02-02T00:00:00Z')
      `);
      await client.query(`
        INSERT INTO friend_link_requests (id, owner_user_id, friend_id, target_user_id, status, accepted_at) VALUES
          ('33333333-3333-4333-8333-333333333333', 'wildan', '11111111-1111-4111-8111-111111111111', 'alice', 'accepted', '2026-01-15T00:00:00Z'),
          ('44444444-4444-4444-8444-444444444444', 'alice', '22222222-2222-4222-8222-222222222222', 'wildan', 'accepted', '2026-01-16T00:00:00Z')
      `);
      await client.query(`
        INSERT INTO outings (id, owner_user_id, title, occurred_at, created_at, updated_at)
        VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'wildan', 'Dinner', '2026-01-20T00:00:00Z', '2026-01-20T00:00:00Z', '2026-01-20T00:00:00Z')
      `);
      await client.query(`
        INSERT INTO expenses (id, owner_user_id, outing_id, description, amount, created_at, updated_at)
        VALUES ('55555555-5555-4555-8555-555555555555', 'wildan', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Dinner', 84000, '2026-01-20T00:00:00Z', '2026-01-20T00:00:00Z')
      `);
      await client.query(`
        INSERT INTO expense_shares (id, owner_user_id, expense_id, friend_id, base_amount, amount_owed, created_at)
        VALUES ('66666666-6666-4666-8666-666666666666', 'wildan', '55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 84000, 84000, '2026-01-20T00:00:00Z')
      `);
      await client.query(`
        INSERT INTO repayments (id, owner_user_id, friend_id, amount, paid_at, payment_method, created_at)
        VALUES ('77777777-7777-4777-8777-777777777777', 'wildan', '11111111-1111-4111-8111-111111111111', 84000, '2026-01-21T00:00:00Z', 'Cash', '2026-01-21T00:00:00Z')
      `);
      await client.query(`
        INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount, created_at)
        VALUES ('wildan', '77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666', 84000, '2026-01-21T00:00:00Z')
      `);

      const before = await client.query(`
        SELECT 'friends' AS table_name, id::text, owner_user_id, linked_user_id, name, phone_number, notes, created_at, updated_at FROM friends
        UNION ALL
        SELECT 'expenses', id::text, owner_user_id, outing_id::text, description, amount::text, NULL, created_at, updated_at FROM expenses
        UNION ALL
        SELECT 'expense_shares', id::text, owner_user_id, friend_id::text, amount_owed::text, base_amount::text, NULL, created_at, NULL FROM expense_shares
        UNION ALL
        SELECT 'repayments', id::text, owner_user_id, friend_id::text, amount::text, payment_method, notes, created_at, paid_at FROM repayments
        UNION ALL
        SELECT 'repayment_allocations', repayment_id::text, owner_user_id, expense_share_id::text, amount::text, NULL, NULL, created_at, NULL FROM repayment_allocations
        ORDER BY table_name, id
      `);

      await applyMigration(client, "0018_old_sentry.sql");

      const after = await client.query(`
        SELECT 'friends' AS table_name, id::text, owner_user_id, linked_user_id, name, phone_number, notes, created_at, updated_at FROM friends
        UNION ALL
        SELECT 'expenses', id::text, owner_user_id, outing_id::text, description, amount::text, NULL, created_at, updated_at FROM expenses
        UNION ALL
        SELECT 'expense_shares', id::text, owner_user_id, friend_id::text, amount_owed::text, base_amount::text, NULL, created_at, NULL FROM expense_shares
        UNION ALL
        SELECT 'repayments', id::text, owner_user_id, friend_id::text, amount::text, payment_method, notes, created_at, paid_at FROM repayments
        UNION ALL
        SELECT 'repayment_allocations', repayment_id::text, owner_user_id, expense_share_id::text, amount::text, NULL, NULL, created_at, NULL FROM repayment_allocations
        ORDER BY table_name, id
      `);
      expect(after.rows).toEqual(before.rows);

      await expect(client.query("SELECT user_a_id, user_b_id, status, connected_at, disconnected_at FROM friend_connections")).resolves.toMatchObject({
        rows: [{ user_a_id: "alice", user_b_id: "wildan", status: "connected", disconnected_at: null }],
      });
      await expect(client.query(`
        SELECT u.id, c.status
        FROM users AS u
        JOIN friend_connections AS c ON (c.user_a_id = u.id OR c.user_b_id = u.id)
        WHERE u.id IN ('wildan', 'alice')
        ORDER BY u.id
      `)).resolves.toMatchObject({ rows: [{ id: "alice", status: "connected" }, { id: "wildan", status: "connected" }] });
    } finally {
      await client.query("DROP SCHEMA public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.end();
    }
  });
});
