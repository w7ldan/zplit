import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.ORGANIZATION_PARTICIPANT_MIGRATION_DATABASE_URL?.trim();
const migrationDirectory = path.resolve(process.cwd(), "drizzle");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) <= 34)
  .sort();

async function applyMigration(client: Client, file: string) {
  for (const statement of readFileSync(path.join(migrationDirectory, file), "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

describe("Organization participant migration", () => {
  it.skipIf(!databaseUrl)("backfills memberships and enforces participant identity uniqueness", async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DROP SCHEMA public CASCADE");
      await client.query("CREATE SCHEMA public");
      for (const file of migrationFiles.filter((file) => Number(file.slice(0, 4)) <= 33)) await applyMigration(client, file);
      await client.query("INSERT INTO users (id, name, email) VALUES ('owner', 'Owner', 'owner@migration.test'), ('member', 'Member', 'member@migration.test')");
      const { rows: [organization] } = await client.query<{ id: string }>("INSERT INTO organizations (name) VALUES ('Migration Organization') RETURNING id");
      if (!organization) throw new Error("organization fixture was not created");
      await client.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, 'owner', 'owner'), ($1, 'member', 'member')", [organization.id]);
      await applyMigration(client, "0034_jazzy_scrambler.sql");

      await expect(client.query("SELECT count(*)::int AS count FROM organization_participants WHERE organization_id = $1", [organization.id])).resolves.toMatchObject({ rows: [{ count: 2 }] });
      await expect(client.query("SELECT count(*)::int AS count FROM organization_memberships WHERE organization_id = $1 AND participant_id IS NOT NULL", [organization.id])).resolves.toMatchObject({ rows: [{ count: 2 }] });

      const { rows: [scope] } = await client.query<{ id: string }>("INSERT INTO ledger_scopes (kind, user_id) VALUES ('personal', 'owner') RETURNING id");
      if (!scope) throw new Error("personal scope fixture was not created");
      const { rows: [friend] } = await client.query<{ id: string }>("INSERT INTO friends (ledger_scope_id, name) VALUES ($1, 'Alex') RETURNING id", [scope.id]);
      if (!friend) throw new Error("friend fixture was not created");
      await client.query("INSERT INTO organization_participants (organization_id, source_personal_friend_id, display_name, created_by_user_id) VALUES ($1, $2, 'Alex', 'owner')", [organization.id, friend.id]);
      await expect(client.query("INSERT INTO organization_participants (organization_id, source_personal_friend_id, display_name, created_by_user_id) VALUES ($1, $2, 'Alex', 'owner')", [organization.id, friend.id])).rejects.toMatchObject({ code: "23505" });
      await expect(client.query("INSERT INTO organization_participants (organization_id, user_id, created_by_user_id) VALUES ($1, 'owner', 'owner')", [organization.id])).rejects.toMatchObject({ code: "23505" });
      await client.query("INSERT INTO organization_participants (organization_id, display_name, created_by_user_id) VALUES ($1, 'Alex', 'owner'), ($1, 'Alex', 'owner')", [organization.id]);
    } finally {
      await client.query("DROP SCHEMA public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.end();
    }
  });
});
