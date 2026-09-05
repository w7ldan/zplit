import { afterEach, describe, expect, it, vi } from "vitest";
import { readDatabaseConfig } from "./migrate";

afterEach(() => vi.unstubAllEnvs());

describe("smoke database safety", () => {
  it.each([undefined, "", "zplit", "zplit_restore_test", "zplit_test_other"])("rejects DB_NAME=%s before reading credentials", (database) => {
    vi.stubEnv("DB_NAME", database);
    vi.stubEnv("DB_PASSWORD_FILE", undefined);
    expect(() => readDatabaseConfig("zplit_test")).toThrow(/DB_NAME/);
  });

  it("requires credentials only after validating the normalized test database name", () => {
    vi.stubEnv("DB_NAME", " zplit_test ");
    vi.stubEnv("DB_PASSWORD_FILE", undefined);
    expect(() => readDatabaseConfig("zplit_test")).toThrow("DB_PASSWORD_FILE is required");
  });
});
