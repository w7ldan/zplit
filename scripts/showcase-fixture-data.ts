import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { detectReceiptMediaType, sha256Hex } from "../src/domain/receipt-file";

export const SHOWCASE_FIXTURE_DATABASE = "zplit_showcase";
export const SHOWCASE_FIXTURE_CONFIRMATION = "showcase-only";
export const SHOWCASE_OWNER_NAME = "Zplit Showcase";
export const SHOWCASE_OWNER_EMAIL = "showcase@zplit.local";
export const SHOWCASE_FIXED_TIMESTAMP = "2026-08-06T09:00:00.000Z";
export const SHOWCASE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const receiptUrl = new URL("./fixtures/showcase-dinner-receipt.png", import.meta.url);
export const SHOWCASE_RECEIPT_PATH = receiptUrl.protocol === "file:" ? fileURLToPath(receiptUrl) : path.resolve(process.cwd(), "scripts/fixtures/showcase-dinner-receipt.png");

export const SHOWCASE_IDS = {
  friends: {
    rani: "5ca5e001-0000-4000-8000-000000000001",
    dimas: "5ca5e001-0000-4000-8000-000000000002",
  },
  outing: "5ca5e002-0000-4000-8000-000000000001",
  expenses: {
    dinner: "5ca5e003-0000-4000-8000-000000000001",
    taxi: "5ca5e003-0000-4000-8000-000000000002",
  },
  shares: {
    dinnerRani: "5ca5e004-0000-4000-8000-000000000001",
    dinnerDimas: "5ca5e004-0000-4000-8000-000000000002",
    taxiRani: "5ca5e004-0000-4000-8000-000000000003",
  },
  repayment: "5ca5e005-0000-4000-8000-000000000001",
  receipt: "5ca5e006-0000-4000-8000-000000000001",
  shareLink: "5ca5e007-0000-4000-8000-000000000001",
} as const;

export type ShowcaseState = 1 | 2 | 3 | 4 | 5 | 6;

export type ShowcaseFriend = {
  id: string;
  ownerUserId: string;
  name: string;
  phoneNumber: null;
  notes: null;
  archivedAt: null;
  createdAt: Date;
  updatedAt: Date;
};

export type ShowcaseOuting = {
  id: string;
  ownerUserId: string;
  title: string;
  occurredAt: Date;
  notes: null;
  createdAt: Date;
  updatedAt: Date;
};

export type ShowcaseExpense = {
  id: string;
  ownerUserId: string;
  outingId: string;
  description: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ShowcaseExpenseShare = {
  id: string;
  ownerUserId: string;
  expenseId: string;
  friendId: string;
  amountOwed: number;
  createdAt: Date;
};

export type ShowcaseRepayment = {
  id: string;
  ownerUserId: string;
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: "bank transfer";
  notes: null;
  createdAt: Date;
};

export type ShowcaseRepaymentAllocation = {
  ownerUserId: string;
  repaymentId: string;
  expenseShareId: string;
  amount: number;
  createdAt: Date;
};

export type ShowcaseReceipt = {
  id: string;
  ownerUserId: string;
  expenseId: string;
  originalFilename: "showcase-dinner-receipt.png";
  mediaType: "image/png";
  byteSize: number;
  sha256: string;
  content: Buffer;
  createdAt: Date;
};

export type ShowcaseFixtureData = {
  state: ShowcaseState;
  ownerUserId: string;
  friends: ShowcaseFriend[];
  outings: ShowcaseOuting[];
  expenses: ShowcaseExpense[];
  expenseShares: ShowcaseExpenseShare[];
  repayments: ShowcaseRepayment[];
  repaymentAllocations: ShowcaseRepaymentAllocation[];
  receipts: ShowcaseReceipt[];
};

function fixedDate() {
  return new Date(SHOWCASE_FIXED_TIMESTAMP);
}

function validatePngStructure(content: Buffer) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (!content.subarray(0, signature.length).equals(signature)) throw new Error("showcase receipt is not a PNG");
  let offset = signature.length;
  let hasHeader = false;
  let hasData = false;
  let hasEnd = false;
  while (offset < content.length) {
    if (offset + 12 > content.length) throw new Error("showcase receipt has a truncated PNG chunk");
    const length = content.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > content.length) throw new Error("showcase receipt has an invalid PNG chunk length");
    const type = content.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      if (length !== 13 || content.readUInt32BE(offset + 8) < 1 || content.readUInt32BE(offset + 12) < 1) throw new Error("showcase receipt has an invalid PNG header");
      hasHeader = true;
    }
    if (type === "IDAT" && length > 0) hasData = true;
    if (type === "IEND") {
      if (length !== 0 || end !== content.length) throw new Error("showcase receipt has an invalid PNG end");
      hasEnd = true;
    }
    offset = end;
  }
  if (!hasHeader || !hasData || !hasEnd) throw new Error("showcase receipt PNG structure is incomplete");
}

function readReceipt(): ShowcaseReceipt {
  const content = readFileSync(SHOWCASE_RECEIPT_PATH);
  if (content.byteLength === 0 || content.byteLength > 5 * 1024 * 1024) throw new Error("showcase receipt byte size is invalid");
  if (detectReceiptMediaType(content) !== "image/png") throw new Error("showcase receipt media type is not image/png");
  validatePngStructure(content);
  return {
    id: SHOWCASE_IDS.receipt,
    ownerUserId: "",
    expenseId: SHOWCASE_IDS.expenses.dinner,
    originalFilename: "showcase-dinner-receipt.png",
    mediaType: "image/png",
    byteSize: content.byteLength,
    sha256: sha256Hex(content),
    content,
    createdAt: fixedDate(),
  };
}

const receipt = readReceipt();

export function parseShowcaseState(value: string | number): ShowcaseState {
  const state = Number(value);
  if (!Number.isInteger(state) || state < 1 || state > 6) throw new Error("showcase state must be an integer from 1 through 6");
  return state as ShowcaseState;
}

export function generateShowcaseFixture(ownerUserId = "showcase-fixture-owner", state: ShowcaseState = 6): ShowcaseFixtureData {
  if (!ownerUserId.trim()) throw new Error("ownerUserId is required");
  const createdAt = fixedDate();
  const friends: ShowcaseFriend[] = [
    { id: SHOWCASE_IDS.friends.rani, ownerUserId, name: "Rani", phoneNumber: null, notes: null, archivedAt: null, createdAt, updatedAt: new Date(createdAt) },
    { id: SHOWCASE_IDS.friends.dimas, ownerUserId, name: "Dimas", phoneNumber: null, notes: null, archivedAt: null, createdAt: new Date(createdAt), updatedAt: new Date(createdAt) },
  ];
  const outings: ShowcaseOuting[] = state >= 2 ? [{ id: SHOWCASE_IDS.outing, ownerUserId, title: "Bandung day out", occurredAt: new Date(createdAt), notes: null, createdAt: new Date(createdAt), updatedAt: new Date(createdAt) }] : [];
  const expenses: ShowcaseExpense[] = state >= 3 ? [
    { id: SHOWCASE_IDS.expenses.dinner, ownerUserId, outingId: SHOWCASE_IDS.outing, description: "Dinner", amount: 240_000, createdAt: new Date(createdAt), updatedAt: new Date(createdAt) },
    { id: SHOWCASE_IDS.expenses.taxi, ownerUserId, outingId: SHOWCASE_IDS.outing, description: "Taxi", amount: 120_000, createdAt: new Date(createdAt), updatedAt: new Date(createdAt) },
  ] : [];
  const expenseShares: ShowcaseExpenseShare[] = state >= 4 ? [
    { id: SHOWCASE_IDS.shares.dinnerRani, ownerUserId, expenseId: SHOWCASE_IDS.expenses.dinner, friendId: SHOWCASE_IDS.friends.rani, amountOwed: 84_000, createdAt: new Date(createdAt) },
    { id: SHOWCASE_IDS.shares.dinnerDimas, ownerUserId, expenseId: SHOWCASE_IDS.expenses.dinner, friendId: SHOWCASE_IDS.friends.dimas, amountOwed: 42_500, createdAt: new Date(createdAt) },
    { id: SHOWCASE_IDS.shares.taxiRani, ownerUserId, expenseId: SHOWCASE_IDS.expenses.taxi, friendId: SHOWCASE_IDS.friends.rani, amountOwed: 42_500, createdAt: new Date(createdAt) },
  ] : [];
  const repayments: ShowcaseRepayment[] = state >= 5 ? [{ id: SHOWCASE_IDS.repayment, ownerUserId, friendId: SHOWCASE_IDS.friends.rani, amount: 126_500, paidAt: new Date(createdAt), paymentMethod: "bank transfer", notes: null, createdAt: new Date(createdAt) }] : [];
  const repaymentAllocations: ShowcaseRepaymentAllocation[] = state >= 5 ? [
    { ownerUserId, repaymentId: SHOWCASE_IDS.repayment, expenseShareId: SHOWCASE_IDS.shares.dinnerRani, amount: 84_000, createdAt: new Date(createdAt) },
    { ownerUserId, repaymentId: SHOWCASE_IDS.repayment, expenseShareId: SHOWCASE_IDS.shares.taxiRani, amount: 42_500, createdAt: new Date(createdAt) },
  ] : [];
  const receipts: ShowcaseReceipt[] = state >= 4 ? [{ ...receipt, ownerUserId, createdAt: new Date(createdAt), content: Buffer.from(receipt.content) }] : [];
  return { state, ownerUserId, friends, outings, expenses, expenseShares, repayments, repaymentAllocations, receipts };
}

export function showcaseTotals(state: ShowcaseState) {
  return {
    totalSpending: state >= 3 ? 360_000 : 0,
    assigned: state >= 4 ? 169_000 : 0,
    ownerPortion: state >= 4 ? 191_000 : state >= 3 ? 360_000 : 0,
    raniOutstanding: state === 4 ? 126_500 : state >= 5 ? 0 : null,
    dimasOutstanding: state >= 4 ? 42_500 : null,
  } as const;
}
