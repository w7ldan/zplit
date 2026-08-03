import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /healthz", () => {
  it("returns only process availability", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ status: "ok" });

    for (const field of [
      "timestamp",
      "version",
      "environment",
      "hostname",
      "database",
      "dependencies",
      "dependencyStatus",
    ]) {
      expect(body).not.toHaveProperty(field);
    }
  });
});
