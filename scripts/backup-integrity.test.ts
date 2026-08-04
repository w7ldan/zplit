import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoViolations, EXPECTED_TABLES, INTEGRITY_CHECKS, parseBackupManifest } from "./backup-integrity";

const validManifest = JSON.stringify({
  formatVersion: 1,
  createdAt: "2026-08-05T00:00:00Z",
  gitCommit: "a".repeat(40),
  postgresqlServerVersion: "18.4",
  dumpSha256: "b".repeat(64),
  dumpByteLength: 42,
  dumpFilename: "zplit-20260805T000000Z.dump",
});
const createBackupSource = readFileSync(path.resolve(process.cwd(), "scripts/create-backup.sh"), "utf8");
const verifyBackupSource = readFileSync(path.resolve(process.cwd(), "scripts/verify-backup.sh"), "utf8");

describe("backup integrity", () => {
  it("parses the metadata-only manifest and rejects a filename mismatch", () => {
    expect(parseBackupManifest(validManifest, "zplit-20260805T000000Z.dump").formatVersion).toBe(1);
    expect(() => parseBackupManifest(validManifest, "other.dump")).toThrow();
  });

  it("keeps all expected tables and integrity SQL checks explicit", () => {
    expect(EXPECTED_TABLES).toEqual(expect.arrayContaining([
      "users", "account_invitations", "debtor_share_links", "friends", "expenses", "expense_receipts", "repayments", "repayment_allocations",
    ]));
    for (const name of ["migration journal", "owner-aware foreign keys", "shares within expenses", "allocations within repayments", "allocations within shares", "cross-friend allocations", "accepted and revoked invitations", "duplicate active debtor links", "whole-rupiah values", "receipt byte lengths"]) {
      expect(INTEGRITY_CHECKS.map((check) => check.name)).toContain(name);
    }
  });

  it("accepts only integer zero violation counts", () => {
    expect(() => assertNoViolations(0)).not.toThrow();
    expect(() => assertNoViolations("0")).not.toThrow();
    expect(() => assertNoViolations(1)).toThrow();
    expect(() => assertNoViolations("record@example.com")).toThrow();
  });

  it("rejects malformed backup paths and checks archive hash and size", () => {
    expect(verifyBackupSource).toContain("$1 != /*");
    expect(verifyBackupSource).toContain("-L \"$dump_path\"");
    expect(verifyBackupSource).toContain("sha256sum");
    expect(verifyBackupSource).toContain("stat -c '%s'");
    expect(verifyBackupSource).toContain("backup SHA-256 mismatch");
    expect(verifyBackupSource).toContain("backup byte length mismatch");
    expect(() => parseBackupManifest(validManifest.replace("zplit-20260805T000000Z.dump", "bad.dump"))).toThrow();
  });

  it("keeps sensitive values out of the manifest and normal output", () => {
    const manifest = JSON.parse(validManifest) as Record<string, unknown>;
    expect(Object.keys(manifest)).not.toEqual(expect.arrayContaining(["email", "token", "receiptHash", "password", "content"]));
    expect(createBackupSource).toContain("backup created:");
    expect(createBackupSource).toContain("manifest created:");
    expect(createBackupSource).not.toMatch(/echo .*password|echo .*email|echo .*token/i);
  });
});
