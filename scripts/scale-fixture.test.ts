import { describe, expect, it } from "vitest";
import { SCALE_FIXTURE_DATABASE, SCALE_FIXTURE_CONFIRMATION } from "./scale-fixture-data";
import {
  parseScaleCommand,
  redactScaleError,
  runScaleCommand,
  validateScaleCommandEnvironment,
  type ScaleFixtureDependencies,
} from "./scale-fixture";

const noConnection: ScaleFixtureDependencies = {
  readDatabaseConfig: (() => { throw new Error("connected unexpectedly"); }) as ScaleFixtureDependencies["readDatabaseConfig"],
  createPool: (() => { throw new Error("connected unexpectedly"); }) as ScaleFixtureDependencies["createPool"],
};

describe("scale fixture command safety", () => {
  it("parses only the three supported commands", () => {
    expect(parseScaleCommand("seed")).toBe("seed");
    expect(parseScaleCommand("verify")).toBe("verify");
    expect(parseScaleCommand("clear")).toBe("clear");
    expect(() => parseScaleCommand("drop")).toThrow(/usage/);
  });

  it("rejects mutation commands before connecting to the wrong database", async () => {
    const environment = { DB_NAME: "zplit", ZPLIT_SCALE_TEST_CONFIRM: SCALE_FIXTURE_CONFIRMATION, SCALE_TEST_OWNER_EMAIL: "owner@example.com" };
    await expect(runScaleCommand("seed", environment, noConnection)).rejects.toThrow(`DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
    await expect(runScaleCommand("clear", environment, noConnection)).rejects.toThrow(`DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
  });

  it("rejects mutation commands before connecting without confirmation", async () => {
    const environment = { DB_NAME: SCALE_FIXTURE_DATABASE, SCALE_TEST_OWNER_EMAIL: "owner@example.com" };
    await expect(runScaleCommand("seed", environment, noConnection)).rejects.toThrow(/ZPLIT_SCALE_TEST_CONFIRM/);
    await expect(runScaleCommand("clear", environment, noConnection)).rejects.toThrow(/ZPLIT_SCALE_TEST_CONFIRM/);
  });

  it("allows read-only verify without mutation confirmation and requires an owner email", () => {
    expect(validateScaleCommandEnvironment("verify", { DB_NAME: SCALE_FIXTURE_DATABASE, SCALE_TEST_OWNER_EMAIL: "Owner@Example.com" })).toEqual({ ownerEmail: "owner@example.com" });
    expect(() => validateScaleCommandEnvironment("verify", { DB_NAME: SCALE_FIXTURE_DATABASE })).toThrow(/SCALE_TEST_OWNER_EMAIL/);
  });

  it("redacts database secrets from failure text", () => {
    expect(redactScaleError(new Error("password=s3cret connection failed"), ["s3cret"])).toBe("password=[redacted] connection failed");
  });
});
