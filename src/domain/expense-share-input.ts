import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export type ExpenseShareInputRow = {
  friendId: string;
  amountRupiah: string;
};

export type ExpenseShareInputValues = ExpenseShareInputRow[];

export type ExpenseShareInput = {
  friendId: string;
  amountOwed: number;
};

export type ExpenseShareFieldErrors = Record<string, string>;

export type ExpenseShareValidationResult =
  | { ok: true; value: ExpenseShareInput[]; values: ExpenseShareInputValues }
  | { ok: false; errors: ExpenseShareFieldErrors; values: ExpenseShareInputValues };

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
