import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { closeDatabase, getDatabase } from "@/db/client";
import { expenseShares, expenses, friends, outings, repaymentAllocations, repayments, users } from "@/db/schema";
import { createLedgerRepository } from "@/domain/ledger-repository";

if (process.env.DB_NAME !== "zplit_test") {
  console.error("FAIL");
  process.exit(1);
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ownerA = `record-retrieval-a-${suffix}`;
const ownerB = `record-retrieval-b-${suffix}`;

async function main() {
  const database = getDatabase();
  try {
    await database.insert(users).values([
      { id: ownerA, name: "Smoke A", email: `${ownerA}@invalid.test` },
      { id: ownerB, name: "Smoke B", email: `${ownerB}@invalid.test` },
    ]);
    const ownerRepository = createLedgerRepository(database, ownerA);
    const otherRepository = createLedgerRepository(database, ownerB);
    assert.equal(typeof ownerRepository.listFriends, "function");
    assert.equal(typeof ownerRepository.listOutings, "function");
    assert.equal(typeof ownerRepository.listExpenses, "function");
    assert.equal(typeof ownerRepository.listRepayments, "function");

    const friend = await ownerRepository.createFriend({ name: "Ada %_ Test", phoneNumber: "100%_phone", notes: null });
    await ownerRepository.createFriend({ name: "Bima", phoneNumber: "200", notes: null });
    await otherRepository.createFriend({ name: "Ada %_ Test", phoneNumber: "100%_phone", notes: null });

    const outingRows = [];
    for (let index = 0; index < 21; index += 1) {
      outingRows.push(await ownerRepository.createOuting({
        title: index === 0 ? "Dinner %_ Test" : `Outing ${index}`,
        occurredAt: new Date(Date.UTC(2026, 3, 1 + index)),
        notes: null,
      }));
    }
    const primaryOuting = outingRows[0]!;
    const assignedExpense = await ownerRepository.createExpense({ description: "Meal %_ Test", amount: 1000, outingId: primaryOuting.id });
    const unassignedExpense = await ownerRepository.createExpense({ description: "Coffee", amount: 500, outingId: primaryOuting.id });
    await ownerRepository.replaceExpenseShares(assignedExpense.id, [{ friendId: friend.id, amountOwed: 1000 }]);

    const completeRepayment = await ownerRepository.createRepaymentWithAllocations(
      { friendId: friend.id, amount: 1000, paidAt: new Date("2026-04-20T00:00:00.000Z"), paymentMethod: "Bank%_transfer", notes: null },
      [{ expenseShareId: (await ownerRepository.listExpenseShares(assignedExpense.id))[0]!.id, amount: 1000 }],
    );
    await ownerRepository.createRepayment({ friendId: friend.id, amount: 700, paidAt: new Date("2026-04-21T00:00:00.000Z"), paymentMethod: "Cash", notes: null });

    const friendSearch = await ownerRepository.listFriendRecords({ q: "Ada %_ Test" });
    assert.equal(friendSearch.totalItems, 1);
    assert.equal((await ownerRepository.listFriendRecords({ q: "100%_" })).totalItems, 1);
    assert.equal((await otherRepository.listFriendRecords({ q: "Ada %_ Test" })).totalItems, 1);

    const outingSearch = await ownerRepository.listOutingRecords({ q: "Dinner %_" });
    assert.equal(outingSearch.totalItems, 1);
    assert.equal((await ownerRepository.listOutingRecords({ month: "2026-04" })).totalItems, 21);
    assert.equal(outingSearch.items[0]?.expenseCount, 2);
    assert.equal(outingSearch.items[0]?.expenseTotal, 1500);

    const expenseSearch = await ownerRepository.listExpenseRecords({ q: "Meal %_" });
    assert.equal(expenseSearch.totalItems, 1);
    assert.equal((await ownerRepository.listExpenseRecords({ outingId: primaryOuting.id })).totalItems, 2);
    assert.equal((await ownerRepository.listExpenseRecords({ month: "2026-04" })).totalItems, 2);
    assert.equal((await ownerRepository.listExpenseRecords({ assignment: "assigned" })).totalItems, 1);
    assert.equal((await ownerRepository.listExpenseRecords({ assignment: "unassigned" })).totalItems, 1);
    assert.equal(unassignedExpense.id !== assignedExpense.id, true);

    const repaymentSearch = await ownerRepository.listRepaymentRecords({ q: "Ada" });
    assert.equal(repaymentSearch.totalItems, 2);
    assert.equal((await ownerRepository.listRepaymentRecords({ q: "Bank%_" })).totalItems, 1);
    assert.equal((await ownerRepository.listRepaymentRecords({ friendId: friend.id })).totalItems, 2);
    assert.equal((await ownerRepository.listRepaymentRecords({ month: "2026-04" })).totalItems, 2);
    assert.equal((await ownerRepository.listRepaymentRecords({ allocation: "complete" })).totalItems, 1);
    assert.equal((await ownerRepository.listRepaymentRecords({ allocation: "needs" })).totalItems, 1);
    assert.equal(completeRepayment.id !== "", true);

    const firstOutings = await ownerRepository.listOutingRecords({ page: 1 });
    const secondOutings = await ownerRepository.listOutingRecords({ page: 2 });
    assert.equal(firstOutings.totalItems, 21);
    assert.equal(secondOutings.page, 2);
    assert.equal(new Set([...firstOutings.items, ...secondOutings.items].map((item) => item.id)).size, 21);
    assert.equal((await ownerRepository.listOutingRecords({ page: 999 })).page, 2);
    assert.equal((await ownerRepository.listOutingRecords({ q: "no match", page: 999 })).page, 1);

    console.log(`PASS friends=${friendSearch.totalItems} outings=${firstOutings.totalItems} expenses=2 repayments=${repaymentSearch.totalItems}`);
  } finally {
    await database.delete(repaymentAllocations).where(inArray(repaymentAllocations.ownerUserId, [ownerA, ownerB]));
    await database.delete(expenseShares).where(inArray(expenseShares.ownerUserId, [ownerA, ownerB]));
    await database.delete(repayments).where(inArray(repayments.ownerUserId, [ownerA, ownerB]));
    await database.delete(expenses).where(inArray(expenses.ownerUserId, [ownerA, ownerB]));
    await database.delete(outings).where(inArray(outings.ownerUserId, [ownerA, ownerB]));
    await database.delete(friends).where(inArray(friends.ownerUserId, [ownerA, ownerB]));
    await database.delete(users).where(and(eq(users.id, ownerA), eq(users.email, `${ownerA}@invalid.test`)));
    await database.delete(users).where(and(eq(users.id, ownerB), eq(users.email, `${ownerB}@invalid.test`)));
    await closeDatabase();
  }
}

main().catch(() => {
  console.error("FAIL");
  process.exitCode = 1;
});
