import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function metadataTitle(file: string) {
  const source = readFileSync(path.resolve(root, file), "utf8");
  const block = source.match(/export const metadata(?:\s*:\s*Metadata)?\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? "";
  return block.match(/^\s*title:\s*"([^"]+)"/m)?.[1];
}

describe("Repository route metadata contract", () => {
  it("keeps the root default title and child template", () => {
    const source = readFileSync(path.resolve(root, "src/app/layout.tsx"), "utf8");
    expect(source).toContain('default: "Zplit — Shared expenses, clearly settled"');
    expect(source).toContain('template: "%s · Zplit"');
  });

  it("gives every authenticated route and detail route a concise child title", () => {
    const routes = [
      ["src/app/app/page.tsx", "Overview"],
      ["src/app/app/friends/page.tsx", "Friends"],
      ["src/app/app/outings/page.tsx", "Outings"],
      ["src/app/app/trips/page.tsx", "Trips"],
      ["src/app/app/expenses/page.tsx", "Expenses"],
      ["src/app/app/repayments/page.tsx", "Repayments"],
      ["src/app/app/history/page.tsx", "Ledger history"],
      ["src/app/app/invites/page.tsx", "Invitations"],
      ["src/app/app/exports/page.tsx", "Ledger exports"],
      ["src/app/app/friends/[friendId]/page.tsx", "Friend details"],
      ["src/app/app/outings/[outingId]/page.tsx", "Outing details"],
      ["src/app/app/trips/[tripId]/page.tsx", "Trip details"],
      ["src/app/app/expenses/[expenseId]/page.tsx", "Expense details"],
      ["src/app/app/repayments/[repaymentId]/page.tsx", "Repayment details"],
    ] as const;

    for (const [file, title] of routes) {
      expect(metadataTitle(file), file).toBe(title);
      expect(title).not.toBe("Zplit — Shared expenses, clearly settled");
    }
  });

  it("keeps public child titles from double-branding and leaves private metadata generic", () => {
    for (const [file, title] of [["src/app/login/page.tsx", "Sign in"], ["src/app/join/[token]/page.tsx", "Join"], ["src/app/share/[token]/page.tsx", "Private balance"], ["src/app/offline/page.tsx", "Offline"]] as const) {
      expect(metadataTitle(file), file).toBe(title);
      expect(title).not.toContain("Zplit");
    }
  });
});
