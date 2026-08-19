import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export const MAX_PERCENTAGE_BASIS_POINTS = 1_000_000;

export type ExpenseShareInputRow = {
  friendId: string;
  amountRupiah: string;
};

export type ExpenseShareInputValues = ExpenseShareInputRow[];

export type ExpenseShareInput =
  | { friendId: string; amountOwed: number }
  | { friendId: string; baseAmount: number };

export type ExpenseShareScope = "all" | "selected";

export type ExpenseShareChargeValues = {
  name: string;
  percentage: string;
  scope: ExpenseShareScope;
  friendIds: string[];
};

export type ExpenseShareChargeInput = {
  name: string;
  percentageBasisPoints: number;
  scope: ExpenseShareScope;
  friendIds: string[];
};

export type ExpenseShareFieldErrors = Record<string, string>;

export type ExpenseShareValidationResult =
  | { ok: true; value: ExpenseShareInput[]; values: ExpenseShareInputValues }
  | { ok: false; errors: ExpenseShareFieldErrors; values: ExpenseShareInputValues };

export type ExpenseShareChargesValidationResult =
  | { ok: true; value: ExpenseShareChargeInput[]; values: ExpenseShareChargeValues[] }
  | { ok: false; errors: ExpenseShareFieldErrors; values: ExpenseShareChargeValues[] };

function isCanonicalUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function rowValue(row: unknown, key: keyof ExpenseShareInputRow) {
  const value = row !== null && typeof row === "object" ? (row as Record<string, unknown>)[key] : undefined;
  return { value: typeof value === "string" ? value.trim() : "", valid: typeof value === "string" };
}

function amountError(value: string) {
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(value)) {
    const amount = Number(value.replaceAll(".", ""));
    if (amount === 0) return "Amount must be greater than zero.";
    if (amount > MAX_RUPIAH) return "Amount is too large.";
  }
  return "Enter whole rupiah, such as 84000 or 84.000.";
}

export function validateExpenseShareInput(input: unknown): ExpenseShareValidationResult {
  if (!Array.isArray(input)) return { ok: false, errors: { "row-0": "Share rows are invalid." }, values: [] };
  const rows = input;
  const values = rows.map((row) => ({ friendId: rowValue(row, "friendId").value, amountRupiah: rowValue(row, "amountRupiah").value }));
  const errors: ExpenseShareFieldErrors = {};
  const seen = new Set<string>();
  const normalizedIds: string[] = [];

  values.forEach((row, index) => {
    const errorKey = row.friendId || `row-${index}`;
    const rawRow = rows[index];
    const friendIdValue = rowValue(rawRow, "friendId");
    const amountValue = rowValue(rawRow, "amountRupiah");
    if (!friendIdValue.valid || !isCanonicalUuid(row.friendId)) {
      errors[errorKey] = "Select a valid friend.";
      normalizedIds[index] = "";
      return;
    }

    const friendId = row.friendId.toLowerCase();
    normalizedIds[index] = friendId;
    if (seen.has(friendId)) errors[friendId] = "Each friend can have only one share per expense.";
    seen.add(friendId);
    if (!amountValue.valid || (row.amountRupiah && parseRupiah(row.amountRupiah) === null)) {
      errors[friendId] ??= amountError(row.amountRupiah);
    }
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  return {
    ok: true,
    values,
    value: values.flatMap((row, index) => {
      if (!row.amountRupiah) return [];
      const amountOwed = parseRupiah(row.amountRupiah);
      return amountOwed === null ? [] : [{ friendId: normalizedIds[index], amountOwed }];
    }),
  };
}

export function parsePercentageBasisPoints(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(basisPoints) && basisPoints <= MAX_PERCENTAGE_BASIS_POINTS ? basisPoints : null;
}

export function formatPercentageBasisPoints(basisPoints: number) {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > MAX_PERCENTAGE_BASIS_POINTS) throw new RangeError("Percentage basis points are invalid");
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function chargeValue(value: unknown, key: keyof ExpenseShareChargeValues) {
  const charge = value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof charge === "string" ? charge.trim() : "";
}

export function validateExpenseShareCharges(input: unknown, availableFriendIds?: Iterable<string>): ExpenseShareChargesValidationResult {
  if (!Array.isArray(input)) return { ok: false, errors: { charges: "Charges are invalid." }, values: [] };
  const available = new Set([...(availableFriendIds ?? [])].map((id) => id.toLowerCase()));
  const hasAvailableFriendIds = availableFriendIds !== undefined;
  const values = input.map((charge) => ({
    name: chargeValue(charge, "name"),
    percentage: chargeValue(charge, "percentage"),
    scope: chargeValue(charge, "scope") as ExpenseShareScope,
    friendIds: charge !== null && typeof charge === "object" && Array.isArray((charge as Record<string, unknown>).friendIds)
      ? ((charge as Record<string, unknown>).friendIds as unknown[]).filter((id): id is string => typeof id === "string").map((id) => id.trim().toLowerCase())
      : [],
  }));
  const errors: ExpenseShareFieldErrors = {};
  const value: ExpenseShareChargeInput[] = [];

  values.forEach((charge, index) => {
    const errorKey = `charge-${index}`;
    const basisPoints = parsePercentageBasisPoints(charge.percentage);
    const targetIds = [...new Set(charge.friendIds)];
    if (!charge.name || charge.name.length > 120) errors[errorKey] ??= "Enter a charge name.";
    if (basisPoints === null) errors[errorKey] ??= "Enter a percentage with up to two decimal places.";
    if (charge.scope !== "all" && charge.scope !== "selected") errors[errorKey] ??= "Choose a charge scope.";
    if (targetIds.some((id) => !isCanonicalUuid(id) || (hasAvailableFriendIds && !available.has(id)))) errors[errorKey] ??= "Choose valid selected friends.";
    if (charge.scope === "selected" && targetIds.length === 0) errors[errorKey] ??= "Choose at least one friend for this charge.";
    if (errors[errorKey]) return;
    value.push({ name: charge.name, percentageBasisPoints: basisPoints!, scope: charge.scope, friendIds: charge.scope === "all" ? [] : targetIds });
  });

  return Object.keys(errors).length > 0 ? { ok: false, errors, values } : { ok: true, value, values };
}

export function calculateChargeAmount(baseAmount: number, percentageBasisPoints: number) {
  if (!Number.isSafeInteger(baseAmount) || baseAmount < 0 || !Number.isSafeInteger(percentageBasisPoints) || percentageBasisPoints < 0) throw new RangeError("Charge calculation inputs are invalid");
  return Number((BigInt(baseAmount) * BigInt(percentageBasisPoints) + BigInt(5_000)) / BigInt(10_000));
}

export function calculateShareBreakdown(baseAmount: number, charges: ExpenseShareChargeInput[], friendId: string) {
  if (!Number.isSafeInteger(baseAmount) || baseAmount < 0) throw new RangeError("Base share amount is invalid");
  const normalizedFriendId = friendId.toLowerCase();
  const appliedCharges = charges.flatMap((charge) => {
    if (charge.scope === "selected" && !charge.friendIds.some((id) => id.toLowerCase() === normalizedFriendId)) return [];
    return [{ name: charge.name, percentageBasisPoints: charge.percentageBasisPoints, amount: calculateChargeAmount(baseAmount, charge.percentageBasisPoints) }];
  });
  const finalAmount = BigInt(baseAmount) + appliedCharges.reduce((total, charge) => total + BigInt(charge.amount), BigInt(0));
  if (finalAmount > BigInt(MAX_RUPIAH)) throw new RangeError("Final share amount is too large");
  return { baseAmount, charges: appliedCharges, finalAmount: Number(finalAmount) };
}
