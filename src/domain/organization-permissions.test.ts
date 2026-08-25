import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_CAPABILITIES,
  normalizeCustomCapabilities,
  resolveOrganizationCapabilities,
} from "./organization-permissions";

function capabilities(role: unknown, customCapabilities?: unknown) {
  return [...resolveOrganizationCapabilities(role, customCapabilities)];
}

describe("Organization capability presets", () => {
  it("gives Owner the complete catalog and Admin every non-reserved capability", () => {
    expect(capabilities("owner")).toEqual([...ORGANIZATION_CAPABILITIES]);
    expect(capabilities("admin")).toEqual(ORGANIZATION_CAPABILITIES.filter((capability) => capability !== "organization.delete"));
  });

  it("keeps Treasurer financial and participation access away from settings and moderation", () => {
    const grants = new Set(capabilities("treasurer"));
    expect([...grants]).toEqual([
      "organization.view",
      "members.view",
      "ledger.view",
      "friends.manage",
      "trips.manage",
      "outings.manage",
      "expenses.create",
      "expenses.edit",
      "expenses.delete",
      "repayments.create",
      "repayments.edit",
      "repayments.delete",
      "repayment_destinations.manage",
      "exports.create",
      "chat.view",
      "chat.send",
    ]);
    expect(grants.has("organization.update")).toBe(false);
    expect(grants.has("members.manage")).toBe(false);
    expect(grants.has("roles.manage")).toBe(false);
    expect(grants.has("chat.moderate")).toBe(false);
  });

  it("gives Member read and chat participation without financial mutation", () => {
    const grants = new Set(capabilities("member"));
    expect([...grants]).toEqual(["organization.view", "members.view", "ledger.view", "chat.view", "chat.send"]);
    expect([...grants].some((capability) => capability.startsWith("expenses.") || capability.startsWith("repayments."))).toBe(false);
  });

  it("normalizes Custom grants, ignores malformed values, and filters deletion", () => {
    expect(normalizeCustomCapabilities(["expenses.create", "expenses.create", "unknown", null, { capability: "chat.send" }, "organization.delete", "chat.send"])).toEqual(["expenses.create", "chat.send"]);
    expect(capabilities("custom", ["expenses.create", "unknown", "organization.delete"])).toEqual(["organization.view", "expenses.create"]);
    expect(capabilities("custom", "expenses.create")).toEqual(["organization.view"]);
  });

  it("fails closed for unknown roles", () => {
    expect(capabilities("superuser", ["organization.delete", "organization.update"])).toEqual([]);
  });
});
