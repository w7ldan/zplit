import { describe, expect, it } from "vitest";
import { buildFriendReminder, buildWhatsAppUrl, normalizeWhatsAppNumber } from "./friend-reminder";

describe("friend reminders", () => {
  it("uses open wording and current totals", () => {
    const reminder = buildFriendReminder({
      friendName: "Ada",
      assignedAmount: 10_000,
      repaidAmount: 4_000,
      outstandingAmount: 6_000,
      balanceUrl: "https://zplit.example/share/token",
    });
    expect(reminder).toBe([
      "Hi Ada, here’s your current Zplit balance.",
      "Still open: Rp 6.000",
      "Assigned: Rp 10.000",
      "Paid back: Rp 4.000",
      "https://zplit.example/share/token",
    ].join("\n"));
    expect(reminder).not.toMatch(/debtor|overdue|demand|unpaid|immediately/i);
  });

  it("uses settled wording at zero outstanding", () => {
    const reminder = buildFriendReminder({ friendName: "Ada", assignedAmount: 1_000, repaidAmount: 1_000, outstandingAmount: 0, balanceUrl: "https://zplit.example/share/token" });
    expect(reminder).toContain("Current balance: Settled");
    expect(reminder).not.toContain("Still open");
  });

  it("keeps only explicitly international, formatted numbers", () => {
    expect(normalizeWhatsAppNumber("+62 (811) 123-456")).toBe("62811123456");
    expect(normalizeWhatsAppNumber("0811123456")).toBeNull();
    expect(normalizeWhatsAppNumber("+62 811 ext 2")).toBeNull();
    expect(normalizeWhatsAppNumber("+1234567")).toBeNull();
    expect(normalizeWhatsAppNumber("+1234567890123456")).toBeNull();
  });

  it("encodes the reminder into a direct WhatsApp URL", () => {
    const reminder = "Hi Ada\nStill open: Rp 6.000";
    expect(buildWhatsAppUrl("+62 811 123-456", reminder)).toBe(`https://wa.me/62811123456?text=${encodeURIComponent(reminder)}`);
    expect(buildWhatsAppUrl("0811123456", reminder)).toBeNull();
  });
});
