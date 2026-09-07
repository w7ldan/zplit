import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../src/domain/receipt-file";
import { SHOWCASE_FIXED_TIMESTAMP, SHOWCASE_LINK_TTL_MS } from "./showcase-fixture-data";
import { REPOSITORY_SHOWCASE_ACCOUNTS } from "./showcase-fixture-identities";

export { REPOSITORY_SHOWCASE_ACCOUNTS } from "./showcase-fixture-identities";

const repositoryReceiptUrl = new URL("./fixtures/repository-showcase-lunch-receipt.png", import.meta.url);
export const REPOSITORY_SHOWCASE_RECEIPT_PATH = repositoryReceiptUrl.protocol === "file:"
  ? fileURLToPath(repositoryReceiptUrl)
  : path.resolve(process.cwd(), "scripts/fixtures/repository-showcase-lunch-receipt.png");

export type RepositoryShowcaseAccountKey = keyof typeof REPOSITORY_SHOWCASE_ACCOUNTS;
export type RepositoryShowcaseUserIds = Record<RepositoryShowcaseAccountKey, string>;

export const REPOSITORY_SHOWCASE_IDS = {
  personal: {
    friends: {
      nadia: "5ca5e101-0000-4000-8000-000000000001",
      reno: "5ca5e101-0000-4000-8000-000000000002",
      mika: "5ca5e101-0000-4000-8000-000000000003",
    },
    outing: "5ca5e102-0000-4000-8000-000000000001",
    expenses: {
      train: "5ca5e103-0000-4000-8000-000000000001",
      lunch: "5ca5e103-0000-4000-8000-000000000002",
      coffee: "5ca5e103-0000-4000-8000-000000000003",
      ride: "5ca5e103-0000-4000-8000-000000000004",
    },
    shares: {
      trainNadia: "5ca5e104-0000-4000-8000-000000000001",
      trainReno: "5ca5e104-0000-4000-8000-000000000002",
      lunchNadia: "5ca5e104-0000-4000-8000-000000000003",
      lunchReno: "5ca5e104-0000-4000-8000-000000000004",
      lunchMika: "5ca5e104-0000-4000-8000-000000000005",
      coffeeMika: "5ca5e104-0000-4000-8000-000000000006",
      rideReno: "5ca5e104-0000-4000-8000-000000000007",
    },
    repayments: {
      nadia: "5ca5e105-0000-4000-8000-000000000001",
      reno: "5ca5e105-0000-4000-8000-000000000002",
    },
    allocations: {
      nadiaTrain: "5ca5e106-0000-4000-8000-000000000001",
      renoRide: "5ca5e106-0000-4000-8000-000000000002",
    },
    receipt: "5ca5e107-0000-4000-8000-000000000001",
    shareLink: "5ca5e108-0000-4000-8000-000000000001",
    shareReceipt: "5ca5e109-0000-4000-8000-000000000001",
  },
  group: {
    group: "5ca5e201-0000-4000-8000-000000000001",
    participants: {
      ari: "5ca5e202-0000-4000-8000-000000000001",
      nadia: "5ca5e202-0000-4000-8000-000000000002",
      reno: "5ca5e202-0000-4000-8000-000000000003",
      mika: "5ca5e202-0000-4000-8000-000000000004",
    },
    expenses: {
      train: "5ca5e203-0000-4000-8000-000000000001",
      lunch: "5ca5e203-0000-4000-8000-000000000002",
    },
    shares: {
      trainAri: "5ca5e204-0000-4000-8000-000000000001",
      trainNadia: "5ca5e204-0000-4000-8000-000000000002",
      trainReno: "5ca5e204-0000-4000-8000-000000000003",
      trainMika: "5ca5e204-0000-4000-8000-000000000004",
      lunchAri: "5ca5e204-0000-4000-8000-000000000005",
      lunchNadia: "5ca5e204-0000-4000-8000-000000000006",
      lunchReno: "5ca5e204-0000-4000-8000-000000000007",
      lunchMika: "5ca5e204-0000-4000-8000-000000000008",
    },
    obligations: {
      trainNadia: "5ca5e205-0000-4000-8000-000000000001",
      trainReno: "5ca5e205-0000-4000-8000-000000000002",
      trainMika: "5ca5e205-0000-4000-8000-000000000003",
      lunchNadia: "5ca5e205-0000-4000-8000-000000000004",
      lunchReno: "5ca5e205-0000-4000-8000-000000000005",
      lunchMika: "5ca5e205-0000-4000-8000-000000000006",
    },
    settlement: "5ca5e206-0000-4000-8000-000000000001",
    settlementApplication: "5ca5e207-0000-4000-8000-000000000001",
    chatThread: "5ca5e208-0000-4000-8000-000000000001",
    messages: {
      ari: "5ca5e209-0000-4000-8000-000000000001",
      nadia: "5ca5e209-0000-4000-8000-000000000002",
      reno: "5ca5e209-0000-4000-8000-000000000003",
    },
  },
  organization: {
    organization: "5ca5e301-0000-4000-8000-000000000001",
    ledgerScope: "5ca5e302-0000-4000-8000-000000000001",
    outing: "5ca5e302-0000-4000-8000-000000000002",
    participants: {
      ari: "5ca5e303-0000-4000-8000-000000000001",
      nadia: "5ca5e303-0000-4000-8000-000000000002",
      reno: "5ca5e303-0000-4000-8000-000000000003",
      mika: "5ca5e303-0000-4000-8000-000000000004",
    },
    friends: {
      nadia: "5ca5e304-0000-4000-8000-000000000001",
      reno: "5ca5e304-0000-4000-8000-000000000002",
      mika: "5ca5e304-0000-4000-8000-000000000003",
    },
    expenses: {
      tools: "5ca5e305-0000-4000-8000-000000000001",
      workshop: "5ca5e305-0000-4000-8000-000000000002",
    },
    shares: {
      toolsNadia: "5ca5e306-0000-4000-8000-000000000001",
      toolsReno: "5ca5e306-0000-4000-8000-000000000002",
      toolsMika: "5ca5e306-0000-4000-8000-000000000003",
      workshopNadia: "5ca5e306-0000-4000-8000-000000000004",
      workshopReno: "5ca5e306-0000-4000-8000-000000000005",
      workshopMika: "5ca5e306-0000-4000-8000-000000000006",
    },
    repayment: "5ca5e307-0000-4000-8000-000000000001",
    repaymentAllocation: "5ca5e308-0000-4000-8000-000000000001",
    chatThread: "5ca5e309-0000-4000-8000-000000000001",
    messages: {
      ari: "5ca5e30a-0000-4000-8000-000000000001",
      nadia: "5ca5e30a-0000-4000-8000-000000000002",
      reno: "5ca5e30a-0000-4000-8000-000000000003",
    },
  },
} as const;

export type RepositoryShowcaseFixture = ReturnType<typeof generateRepositoryShowcaseFixture>;

function fixedDate(offsetMinutes = 0) {
  return new Date(new Date(SHOWCASE_FIXED_TIMESTAMP).getTime() + offsetMinutes * 60_000);
}

function readReceipt() {
  const content = readFileSync(REPOSITORY_SHOWCASE_RECEIPT_PATH);
  return {
    id: REPOSITORY_SHOWCASE_IDS.personal.receipt,
    expenseId: REPOSITORY_SHOWCASE_IDS.personal.expenses.lunch,
    originalFilename: "repository-showcase-lunch-receipt.png",
    mediaType: "image/png",
    byteSize: content.byteLength,
    sha256: sha256Hex(content),
    content,
    createdAt: fixedDate(30),
  } as const;
}

export function generateRepositoryShowcaseFixture(users: RepositoryShowcaseUserIds, shareLinkCreatedAt = fixedDate(2)) {
  const createdAt = fixedDate();
  const later = fixedDate(2);
  const bearerCreatedAt = new Date(shareLinkCreatedAt);
  const personal = REPOSITORY_SHOWCASE_IDS.personal;
  const group = REPOSITORY_SHOWCASE_IDS.group;
  const organization = REPOSITORY_SHOWCASE_IDS.organization;
  const receipt = readReceipt();
  return {
    personal: {
      friends: [
        { id: personal.friends.nadia, linkedUserId: users.nadia, name: "Nadia Putri" },
        { id: personal.friends.reno, linkedUserId: users.reno, name: "Reno Mahendra" },
        { id: personal.friends.mika, linkedUserId: users.mika, name: "Mika Santoso" },
      ].map((row) => ({ ...row, ledgerScopeId: "dynamic", phoneNumber: null, notes: null, archivedAt: null, createdAt, updatedAt: createdAt })),
      outing: { id: personal.outing, title: "Bandung Weekend", occurredAt: createdAt, createdAt, updatedAt: createdAt, notes: null },
      expenses: [
        { id: personal.expenses.train, description: "Train tickets", amount: 360_000 },
        { id: personal.expenses.lunch, description: "Lunch at Braga", amount: 270_000 },
        { id: personal.expenses.coffee, description: "Coffee stop", amount: 120_000 },
        { id: personal.expenses.ride, description: "Ride home", amount: 90_000 },
      ].map((row) => ({ ...row, ledgerScopeId: "dynamic", outingId: personal.outing, createdAt, updatedAt: createdAt })),
      expenseShares: [
        { id: personal.shares.trainNadia, expenseId: personal.expenses.train, friendId: personal.friends.nadia, amountOwed: 180_000 },
        { id: personal.shares.trainReno, expenseId: personal.expenses.train, friendId: personal.friends.reno, amountOwed: 90_000 },
        { id: personal.shares.lunchNadia, expenseId: personal.expenses.lunch, friendId: personal.friends.nadia, amountOwed: 90_000 },
        { id: personal.shares.lunchReno, expenseId: personal.expenses.lunch, friendId: personal.friends.reno, amountOwed: 45_000 },
        { id: personal.shares.lunchMika, expenseId: personal.expenses.lunch, friendId: personal.friends.mika, amountOwed: 45_000 },
        { id: personal.shares.coffeeMika, expenseId: personal.expenses.coffee, friendId: personal.friends.mika, amountOwed: 60_000 },
        { id: personal.shares.rideReno, expenseId: personal.expenses.ride, friendId: personal.friends.reno, amountOwed: 45_000 },
      ].map((row) => ({ ...row, ledgerScopeId: "dynamic", baseAmount: row.amountOwed, createdAt })),
      repayments: [
        { id: personal.repayments.nadia, friendId: personal.friends.nadia, amount: 120_000 },
        { id: personal.repayments.reno, friendId: personal.friends.reno, amount: 45_000 },
      ].map((row) => ({ ...row, ledgerScopeId: "dynamic", paidAt: later, paymentMethod: "bank transfer", notes: null, createdAt: later })),
      repaymentAllocations: [
        { repaymentId: personal.repayments.nadia, expenseShareId: personal.shares.trainNadia, amount: 120_000 },
        { repaymentId: personal.repayments.reno, expenseShareId: personal.shares.rideReno, amount: 45_000 },
      ].map((row) => ({ ...row, ledgerScopeId: "dynamic", createdAt: later })),
      receipt,
      shareLink: {
        id: personal.shareLink,
        friendId: personal.friends.nadia,
        receiptId: personal.shareReceipt,
        expenseId: personal.expenses.lunch,
        createdAt: bearerCreatedAt,
        expiresAt: new Date(bearerCreatedAt.getTime() + SHOWCASE_LINK_TTL_MS),
      },
    },
    group: {
      group: { id: group.group, name: "Bandung Weekend", description: "Shared plans and spending for the Bandung weekend.", createdByUserId: users.ari, createdAt, updatedAt: createdAt, archivedAt: null },
      participants: [
        { id: group.participants.ari, userId: users.ari },
        { id: group.participants.nadia, userId: users.nadia },
        { id: group.participants.reno, userId: users.reno },
        { id: group.participants.mika, userId: users.mika },
      ].map((row) => ({ ...row, groupId: group.group, sourcePersonalFriendId: null, displayName: null, label: null, createdAt, updatedAt: createdAt })),
      memberships: [
        { userId: users.ari, participantId: group.participants.ari, role: "owner" },
        { userId: users.nadia, participantId: group.participants.nadia, role: "admin" },
        { userId: users.reno, participantId: group.participants.reno, role: "member" },
        { userId: users.mika, participantId: group.participants.mika, role: "member" },
      ].map((row) => ({ ...row, groupId: group.group, joinedAt: createdAt })),
      expenses: [
        { id: group.expenses.train, description: "Train tickets", occurredAt: createdAt, totalAmount: 480_000 },
        { id: group.expenses.lunch, description: "Lunch at Dago", occurredAt: later, totalAmount: 360_000 },
      ].map((row) => ({ ...row, groupId: group.group, creatorParticipantId: group.participants.ari, payerParticipantId: group.participants.ari, state: "confirmed", confirmedAt: row.occurredAt, createdAt: row.occurredAt, updatedAt: row.occurredAt })),
      shares: [
        { id: group.shares.trainAri, expenseId: group.expenses.train, participantId: group.participants.ari, amount: 180_000 },
        { id: group.shares.trainNadia, expenseId: group.expenses.train, participantId: group.participants.nadia, amount: 120_000 },
        { id: group.shares.trainReno, expenseId: group.expenses.train, participantId: group.participants.reno, amount: 100_000 },
        { id: group.shares.trainMika, expenseId: group.expenses.train, participantId: group.participants.mika, amount: 80_000 },
        { id: group.shares.lunchAri, expenseId: group.expenses.lunch, participantId: group.participants.ari, amount: 120_000 },
        { id: group.shares.lunchNadia, expenseId: group.expenses.lunch, participantId: group.participants.nadia, amount: 80_000 },
        { id: group.shares.lunchReno, expenseId: group.expenses.lunch, participantId: group.participants.reno, amount: 90_000 },
        { id: group.shares.lunchMika, expenseId: group.expenses.lunch, participantId: group.participants.mika, amount: 70_000 },
      ].map((row) => ({ ...row, groupId: group.group, createdAt, updatedAt: createdAt })),
      obligations: [
        { id: group.obligations.trainNadia, sourceExpenseId: group.expenses.train, sourceShareId: group.shares.trainNadia, debtorParticipantId: group.participants.nadia, originalAmount: 120_000 },
        { id: group.obligations.trainReno, sourceExpenseId: group.expenses.train, sourceShareId: group.shares.trainReno, debtorParticipantId: group.participants.reno, originalAmount: 100_000 },
        { id: group.obligations.trainMika, sourceExpenseId: group.expenses.train, sourceShareId: group.shares.trainMika, debtorParticipantId: group.participants.mika, originalAmount: 80_000 },
        { id: group.obligations.lunchNadia, sourceExpenseId: group.expenses.lunch, sourceShareId: group.shares.lunchNadia, debtorParticipantId: group.participants.nadia, originalAmount: 80_000 },
        { id: group.obligations.lunchReno, sourceExpenseId: group.expenses.lunch, sourceShareId: group.shares.lunchReno, debtorParticipantId: group.participants.reno, originalAmount: 90_000 },
        { id: group.obligations.lunchMika, sourceExpenseId: group.expenses.lunch, sourceShareId: group.shares.lunchMika, debtorParticipantId: group.participants.mika, originalAmount: 70_000 },
      ].map((row) => ({ ...row, groupId: group.group, creditorParticipantId: group.participants.ari, voidedAt: null, createdAt })),
      settlement: { id: group.settlement, groupId: group.group, senderParticipantId: group.participants.nadia, recipientParticipantId: group.participants.ari, amount: 80_000, paymentMethod: "bank transfer", state: "confirmed", createdAt: later, confirmedAt: later },
      settlementApplication: { id: group.settlementApplication, groupId: group.group, settlementId: group.settlement, obligationId: group.obligations.trainNadia, appliedAmount: 80_000, createdAt: later },
      chat: {
        thread: { id: group.chatThread, groupId: group.group, organizationId: null, createdAt, updatedAt: later },
        messages: [
          { id: group.messages.ari, senderUserId: users.ari, senderParticipantId: group.participants.ari, body: "Train leaves at 08:10 — I’ll bring the tickets.", createdAt },
          { id: group.messages.nadia, senderUserId: users.nadia, senderParticipantId: group.participants.nadia, body: "The train expense is in the shared records; we can settle after the trip.", createdAt: fixedDate(1) },
          { id: group.messages.reno, senderUserId: users.reno, senderParticipantId: group.participants.reno, body: "I’ll send my share tonight.", createdAt: later },
        ],
        reads: [
          { userId: users.ari, lastReadMessageId: group.messages.reno },
          { userId: users.nadia, lastReadMessageId: group.messages.nadia },
          { userId: users.reno, lastReadMessageId: group.messages.ari },
          { userId: users.mika, lastReadMessageId: group.messages.ari },
        ].map((row) => ({ ...row, threadId: group.chatThread, createdAt, updatedAt: later })),
      },
    },
    organization: {
      organization: { id: organization.organization, name: "Northstar Studio", description: "A managed workspace for studio operations and shared costs.", archivedAt: null, createdAt, updatedAt: createdAt },
      ledgerScope: { id: organization.ledgerScope, kind: "organization", organizationId: organization.organization, userId: null, createdAt },
      participants: [
        { id: organization.participants.ari, userId: users.ari, role: "owner", customCapabilities: [] },
        { id: organization.participants.nadia, userId: users.nadia, role: "treasurer", customCapabilities: [] },
        { id: organization.participants.reno, userId: users.reno, role: "member", customCapabilities: [] },
        { id: organization.participants.mika, userId: users.mika, role: "member", customCapabilities: [] },
      ].map((row) => ({ ...row, organizationId: organization.organization, sourcePersonalFriendId: null, displayName: null, label: null, createdByUserId: users.ari, createdAt })),
      friends: [
        { id: organization.friends.nadia, linkedUserId: users.nadia, sourcePersonalFriendId: personal.friends.nadia, name: "Nadia Putri" },
        { id: organization.friends.reno, linkedUserId: users.reno, sourcePersonalFriendId: personal.friends.reno, name: "Reno Mahendra" },
        { id: organization.friends.mika, linkedUserId: users.mika, sourcePersonalFriendId: personal.friends.mika, name: "Mika Santoso" },
      ].map((row) => ({ ...row, ledgerScopeId: organization.ledgerScope, phoneNumber: null, notes: null, archivedAt: null, createdAt, updatedAt: createdAt })),
      memberships: [
        { userId: users.ari, participantId: organization.participants.ari, role: "owner", customCapabilities: [] },
        { userId: users.nadia, participantId: organization.participants.nadia, role: "treasurer", customCapabilities: [] },
        { userId: users.reno, participantId: organization.participants.reno, role: "member", customCapabilities: [] },
        { userId: users.mika, participantId: organization.participants.mika, role: "member", customCapabilities: [] },
      ].map((row) => ({ ...row, organizationId: organization.organization, joinedAt: createdAt })),
      outing: { id: organization.outing, ledgerScopeId: organization.ledgerScope, tripId: null, title: "Northstar Studio planning", occurredAt: createdAt, notes: null, createdAt, updatedAt: createdAt },
      expenses: [
        { id: organization.expenses.tools, description: "Quarterly design tools", amount: 1_800_000 },
        { id: organization.expenses.workshop, description: "Client workshop lunch", amount: 1_200_000 },
      ].map((row) => ({ ...row, ledgerScopeId: organization.ledgerScope, outingId: organization.outing, createdAt, updatedAt: createdAt })),
      expenseShares: [
        { id: organization.shares.toolsNadia, expenseId: organization.expenses.tools, friendId: organization.friends.nadia, amountOwed: 900_000 },
        { id: organization.shares.toolsReno, expenseId: organization.expenses.tools, friendId: organization.friends.reno, amountOwed: 450_000 },
        { id: organization.shares.toolsMika, expenseId: organization.expenses.tools, friendId: organization.friends.mika, amountOwed: 180_000 },
        { id: organization.shares.workshopNadia, expenseId: organization.expenses.workshop, friendId: organization.friends.nadia, amountOwed: 360_000 },
        { id: organization.shares.workshopReno, expenseId: organization.expenses.workshop, friendId: organization.friends.reno, amountOwed: 240_000 },
        { id: organization.shares.workshopMika, expenseId: organization.expenses.workshop, friendId: organization.friends.mika, amountOwed: 180_000 },
      ].map((row) => ({ ...row, ledgerScopeId: organization.ledgerScope, baseAmount: row.amountOwed, createdAt })),
      repayment: { id: organization.repayment, ledgerScopeId: organization.ledgerScope, friendId: organization.friends.nadia, amount: 300_000, paidAt: later, paymentMethod: "bank transfer", notes: "Northstar Studio reimbursement", createdAt: later },
      repaymentAllocation: { ledgerScopeId: organization.ledgerScope, repaymentId: organization.repayment, expenseShareId: organization.shares.toolsNadia, amount: 300_000, createdAt: later },
      chat: {
        thread: { id: organization.chatThread, organizationId: organization.organization, groupId: null, createdAt, updatedAt: later },
        messages: [
          { id: organization.messages.ari, senderUserId: users.ari, body: "Northstar Studio kickoff is ready. I added the Q3 tool renewal.", createdAt },
          { id: organization.messages.nadia, senderUserId: users.nadia, body: "I’ll review the shared ledger before Friday.", createdAt: fixedDate(1) },
          { id: organization.messages.reno, senderUserId: users.reno, body: "Workshop lunch is in the latest records.", createdAt: later },
        ],
        reads: [
          { userId: users.ari, lastReadMessageId: organization.messages.reno },
          { userId: users.nadia, lastReadMessageId: organization.messages.nadia },
          { userId: users.reno, lastReadMessageId: organization.messages.ari },
          { userId: users.mika, lastReadMessageId: organization.messages.ari },
        ].map((row) => ({ ...row, threadId: organization.chatThread, createdAt, updatedAt: later })),
      },
    },
  };
}

export const REPOSITORY_SHOWCASE_EXPECTATIONS = {
  personal: { spending: 840_000, assigned: 555_000, repaid: 165_000, outstanding: { nadia: 150_000, reno: 135_000, mika: 105_000 } },
  group: { spending: 840_000, outstanding: { nadia: 120_000, reno: 190_000, mika: 150_000 }, settled: 80_000 },
  organization: { spending: 3_000_000, assigned: 2_310_000, repaid: 300_000, outstanding: 2_010_000 },
} as const;
