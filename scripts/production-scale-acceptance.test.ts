import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_BUDGETS,
  PRODUCTION_SERVER,
  RESOURCE_GATE,
  SCALE_APP_PATHS,
  validateAcceptanceEnvironment,
  validateResourceGate,
  type ResourceSnapshot,
} from "./production-scale-acceptance";
import { SCALE_FIXTURE_CONFIRMATION, SCALE_FIXTURE_DATABASE } from "./scale-fixture-data";

const passingResources: ResourceSnapshot = {
  availableMemoryBytes: RESOURCE_GATE.minimumAvailableMemoryBytes,
  freeDiskBytes: RESOURCE_GATE.minimumFreeDiskBytes,
  competingProcesses: [],
  recentOomEvents: [],
};

describe("production scale acceptance", () => {
  it("requires the disposable scale database and mutation confirmation", () => {
    expect(validateAcceptanceEnvironment({
      DB_NAME: SCALE_FIXTURE_DATABASE,
      SCALE_TEST_OWNER_EMAIL: "owner@example.com",
      ZPLIT_SCALE_TEST_CONFIRM: SCALE_FIXTURE_CONFIRMATION,
    })).toEqual({ ownerEmail: "owner@example.com" });
    expect(() => validateAcceptanceEnvironment({ DB_NAME: "zplit", SCALE_TEST_OWNER_EMAIL: "owner@example.com", ZPLIT_SCALE_TEST_CONFIRM: SCALE_FIXTURE_CONFIRMATION })).toThrow(SCALE_FIXTURE_DATABASE);
    expect(() => validateAcceptanceEnvironment({ DB_NAME: SCALE_FIXTURE_DATABASE, SCALE_TEST_OWNER_EMAIL: "owner@example.com" })).toThrow("ZPLIT_SCALE_TEST_CONFIRM");
  });

  it("accepts the exact resource thresholds and rejects every gate failure", () => {
    expect(() => validateResourceGate(passingResources)).not.toThrow();
    for (const failure of [
      { ...passingResources, availableMemoryBytes: passingResources.availableMemoryBytes - 1 },
      { ...passingResources, freeDiskBytes: passingResources.freeDiskBytes - 1 },
      { ...passingResources, competingProcesses: ["next build"] },
      { ...passingResources, recentOomEvents: ["Out of memory"] },
    ]) expect(() => validateResourceGate(failure)).toThrow("resource gate failed");
  });

  it("keeps the permanent budgets, page paths, and non-browser runtime check explicit", () => {
    expect(PERFORMANCE_BUDGETS).toEqual({
      overviewSummaryMs: 500,
      recentActivityMs: 100,
      recordPageMs: 300,
      selectorSearchMs: 200,
      selectedFriendContextMs: 300,
    });
    expect(SCALE_APP_PATHS).toEqual(["/app", "/app/friends", "/app/outings", "/app/expenses", "/app/repayments"]);
    expect(PRODUCTION_SERVER).toMatchObject({ host: "127.0.0.1", port: 3001, pageTimeLimitMs: 1500, htmlByteLimit: 500 * 1024 });
    const source = readFileSync(path.resolve(process.cwd(), "scripts/production-scale-acceptance.ts"), "utf8");
    expect(source).not.toMatch(/chromium|playwright/i);
    expect(source).toContain("peakRssBytes");
    expect(source).toContain("readDomainFingerprint");
  });
});
