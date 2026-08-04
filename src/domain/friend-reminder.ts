import { formatRupiah } from "./rupiah";

export type FriendReminderInput = {
  friendName: string;
  assignedAmount: number;
  repaidAmount: number;
  outstandingAmount: number;
  balanceUrl: string;
};

function assertAmount(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a safe non-negative whole-rupiah amount`);
}

export function buildFriendReminder(input: FriendReminderInput) {
  if (!input.friendName || !input.balanceUrl) throw new RangeError("Friend reminder identity and URL are required");
  assertAmount(input.assignedAmount, "Assigned amount");
  assertAmount(input.repaidAmount, "Repaid amount");
  assertAmount(input.outstandingAmount, "Outstanding amount");
  if (input.repaidAmount > input.assignedAmount || input.outstandingAmount !== input.assignedAmount - input.repaidAmount) {
    throw new RangeError("Friend reminder totals are inconsistent");
  }

  return [
    `Hi ${input.friendName}, here’s your current Zplit balance.`,
    input.outstandingAmount === 0 ? "Current balance: Settled" : `Still open: ${formatRupiah(input.outstandingAmount)}`,
    `Assigned: ${formatRupiah(input.assignedAmount)}`,
    `Paid back: ${formatRupiah(input.repaidAmount)}`,
    input.balanceUrl,
  ].join("\n");
}

export function normalizeWhatsAppNumber(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input.startsWith("+")) return null;
  const digits = input.slice(1).replace(/[\s().-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) return null;
  return digits;
}

export function buildWhatsAppUrl(phoneNumber: string | null | undefined, reminder: string) {
  const digits = normalizeWhatsAppNumber(phoneNumber);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(reminder)}` : null;
}
