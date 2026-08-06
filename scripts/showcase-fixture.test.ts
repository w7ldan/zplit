import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseShowcaseCommand,
  redactShowcaseError,
  runShowcaseCommand,
  validateShowcaseCommandEnvironment,
  type ShowcaseEnvironment,
  type ShowcaseFixtureDependencies,
} from "./showcase-fixture";

const temporaryDirectories: string[] = [];
const noConnection: ShowcaseFixtureDependencies = {
  readDatabaseConfig: (() => { throw new Error("connected unexpectedly"); }) as ShowcaseFixtureDependencies["readDatabaseConfig"],
  createPool: (() => { throw new Error("connected unexpectedly"); }) as ShowcaseFixtureDependencies["createPool"],
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function environment(confirm = "showcase-only"): ShowcaseEnvironment {
  const directory = mkdtempSync(join(tmpdir(), "zplit-showcase-test-"));
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
    DB_NAME: "zplit_showcase",
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

describe("showcase fixture command safety", () => {
  it("accepts only the supported commands", () => {
    expect(parseShowcaseCommand("setup")).toBe("setup");
    expect(parseShowcaseCommand("state")).toBe("state");
    expect(parseShowcaseCommand("verify")).toBe("verify");
    expect(parseShowcaseCommand("clear")).toBe("clear");
    expect(() => parseShowcaseCommand("seed")).toThrow(/usage/);
  });

  it("rejects the wrong database before connecting", async () => {
    const env = { ...environment(), DB_NAME: "zplit_scale_test" };
    await expect(runShowcaseCommand("state", 1, env, noConnection)).rejects.toThrow("DB_NAME must be zplit_showcase");
    await expect(runShowcaseCommand("clear", undefined, env, noConnection)).rejects.toThrow("DB_NAME must be zplit_showcase");
  });

  it("requires mutation confirmation but allows read-only verification without it", () => {
    const env = environment("");
    expect(() => validateShowcaseCommandEnvironment("state", 1, env)).toThrow(/ZPLIT_SHOWCASE_CONFIRM/);
    expect(() => validateShowcaseCommandEnvironment("clear", undefined, env)).toThrow(/ZPLIT_SHOWCASE_CONFIRM/);
    expect(validateShowcaseCommandEnvironment("verify", 6, env).ownerEmail).toBe("showcase@zplit.local");
  });

  it("redacts database, auth, and password secrets from errors", () => {
    expect(redactShowcaseError(new Error("db-secret auth-secret showcase-password-123"), ["db-secret", "auth-secret", "showcase-password-123"])).toBe("[redacted] [redacted] [redacted]");
  });
});
