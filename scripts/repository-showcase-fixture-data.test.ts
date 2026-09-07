import { describe, expect, it } from "vitest";
import {
  REPOSITORY_SHOWCASE_ACCOUNTS,
  REPOSITORY_SHOWCASE_EXPECTATIONS,
  REPOSITORY_SHOWCASE_IDS,
  generateRepositoryShowcaseFixture,
} from "./repository-showcase-fixture-data";

const users = { ari: "user-ari", nadia: "user-nadia", reno: "user-reno", mika: "user-mika" } as const;

describe("repository showcase fixture data", () => {
  it("uses the synthetic local account universe and fixed cross-product IDs", () => {
    const fixture = generateRepositoryShowcaseFixture(users);
    const repeat = generateRepositoryShowcaseFixture(users);
    const stable = (value: typeof fixture) => JSON.stringify({ ...value, personal: { ...value.personal, receipt: { ...value.personal.receipt, content: value.personal.receipt.content.byteLength } } });
    expect(stable(fixture)).toBe(stable(repeat));
    expect(Object.values(REPOSITORY_SHOWCASE_ACCOUNTS).every(({ email }) => email.endsWith("@zplit.local"))).toBe(true);
    expect(fixture.personal.friends.map(({ linkedUserId }) => linkedUserId)).toEqual([users.nadia, users.reno, users.mika]);
    expect(fixture.group.participants.map(({ userId }) => userId)).toEqual([users.ari, users.nadia, users.reno, users.mika]);
    expect(fixture.organization.ledgerScope).toMatchObject({ kind: "organization", organizationId: REPOSITORY_SHOWCASE_IDS.organization.organization, userId: null });
  });

  it("represents non-zero personal, group, and organization balances", () => {
    const fixture = generateRepositoryShowcaseFixture(users);
    expect(fixture.personal.expenses.reduce((total, expense) => total + expense.amount, 0)).toBe(REPOSITORY_SHOWCASE_EXPECTATIONS.personal.spending);
    expect(fixture.personal.expenseShares.reduce((total, share) => total + share.amountOwed, 0)).toBe(REPOSITORY_SHOWCASE_EXPECTATIONS.personal.assigned);
    expect(fixture.personal.repayments.reduce((total, repayment) => total + repayment.amount, 0)).toBe(REPOSITORY_SHOWCASE_EXPECTATIONS.personal.repaid);
    expect(fixture.group.settlement).toMatchObject({ state: "confirmed", amount: REPOSITORY_SHOWCASE_EXPECTATIONS.group.settled });
    expect(fixture.group.settlementApplication).toMatchObject({ appliedAmount: REPOSITORY_SHOWCASE_EXPECTATIONS.group.settled });
    expect(fixture.organization.expenses.reduce((total, expense) => total + expense.amount, 0)).toBe(REPOSITORY_SHOWCASE_EXPECTATIONS.organization.spending);
    expect(fixture.organization.repayment.amount).toBe(REPOSITORY_SHOWCASE_EXPECTATIONS.organization.repaid);
  });

  it("keeps the private share deliberately scoped to Nadia and one receipt", () => {
    const fixture = generateRepositoryShowcaseFixture(users);
    expect(fixture.personal.shareLink.friendId).toBe(REPOSITORY_SHOWCASE_IDS.personal.friends.nadia);
    expect(fixture.personal.shareLink.expenseId).toBe(REPOSITORY_SHOWCASE_IDS.personal.expenses.lunch);
    expect(fixture.personal.shareLink.receiptId).toBe(REPOSITORY_SHOWCASE_IDS.personal.shareReceipt);
    expect(fixture.personal.receipt.expenseId).toBe(REPOSITORY_SHOWCASE_IDS.personal.expenses.lunch);
  });
});
