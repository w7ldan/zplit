import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseRepositoryShowcaseCommand,
  REPOSITORY_SHOWCASE_DATABASE,
  validateRepositoryShowcaseEnvironment,
} from "./repository-showcase-fixture";
import type { ShowcaseEnvironment } from "./showcase-fixture";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function environment(confirm = "showcase-only"): ShowcaseEnvironment {
  const directory = mkdtempSync(join(tmpdir(), "zplit-repository-showcase-test-"));
  temporaryDirectories.push(directory);
  const files = {
    db: join(directory, "db-password"),
    auth: join(directory, "auth-secret"),
    name: join(directory, "owner-name"),
    email: join(directory, "owner-email"),
    password: join(directory, "owner-password"),
  };
  writeFileSync(files.db, "db-secret");
  writeFileSync(files.auth, "auth-secret");
  writeFileSync(files.name, "Zplit Showcase");
  writeFileSync(files.email, "showcase@zplit.local");
  writeFileSync(files.password, "showcase-password-123");
  return {
    DB_NAME: REPOSITORY_SHOWCASE_DATABASE,
    DB_HOST: "localhost",
    DB_USER: "zplit",
    DB_PASSWORD_FILE: files.db,
    BETTER_AUTH_URL: "http://localhost:3100",
    BETTER_AUTH_SECRET_FILE: files.auth,
    OWNER_NAME_FILE: files.name,
    OWNER_EMAIL_FILE: files.email,
    OWNER_PASSWORD_FILE: files.password,
    ZPLIT_SHOWCASE_CONFIRM: confirm,
  };
}

describe("repository showcase fixture command safety", () => {
  it("accepts only setup, verify, and clear", () => {
    expect(parseRepositoryShowcaseCommand("setup")).toBe("setup");
    expect(parseRepositoryShowcaseCommand("verify")).toBe("verify");
    expect(parseRepositoryShowcaseCommand("clear")).toBe("clear");
    expect(() => parseRepositoryShowcaseCommand("state")).toThrow(/usage/);
  });

  it("keeps the database and mutation guards from the legacy fixture", () => {
    expect(() => validateRepositoryShowcaseEnvironment("setup", { ...environment(), DB_NAME: "zplit_showcase" })).toThrow(`DB_NAME must be ${REPOSITORY_SHOWCASE_DATABASE}`);
    expect(() => validateRepositoryShowcaseEnvironment("clear", environment(""))).toThrow(/ZPLIT_SHOWCASE_CONFIRM/);
    expect(validateRepositoryShowcaseEnvironment("verify", environment("")).ownerEmail).toBe("showcase@zplit.local");
  });
});
