import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const currentSchemaScripts = [
  "database-smoke.ts",
  "debtor-share-smoke.ts",
  "history-delete-smoke.ts",
  "ownership-smoke.ts",
  "receipt-smoke.ts",
  "recent-activity-smoke.ts",
  "repayment-entry-smoke.ts",
  "shared-receipts-smoke.ts",
  "scale-fixture.ts",
  "production-scale-acceptance.ts",
  "showcase-fixture.ts",
  "overview-scale-smoke.ts",
  "record-pages-scale-smoke.ts",
  "selection-search-scale-smoke.ts",
  "invitation-smoke.ts",
  "record-retrieval-smoke.ts",
  "ledger-scope-smoke.ts",
  "backup-integrity.ts",
] as const;

const directUserArguments = /,\s*(?:userId|ownerUserId|userA|userB|ownerA|ownerB|repositoryOwner|foreignOwner)\s*\)$/;
const identityOwnershipTables = new Map([
  ["ledger-scope-smoke.ts", ["friend_link_requests"]],
  ["backup-integrity.ts", ["friend_link_requests"]],
]);

describe("current-schema script ownership", () => {
  it("uses ledger scopes for repositories and ledger-table SQL", () => {
    for (const filename of currentSchemaScripts) {
      const source = readFileSync(path.join(process.cwd(), "scripts", filename), "utf8");
      for (const call of source.match(/createLedgerRepository\([^\n]*\)/g) ?? []) {
        expect(call, `${filename} passes a user ID to createLedgerRepository`).not.toMatch(directUserArguments);
      }
      for (const line of source.split("\n").filter((line) => line.includes("owner_user_id"))) {
        expect(identityOwnershipTables.get(filename) ?? [], `${filename} has stale current-schema ownership: ${line.trim()}`).toContain(
          line.match(/(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+([a-z_]+)/i)?.[1],
        );
      }
    }
  });
});
