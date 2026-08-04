import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export type RepaymentAllocationInputRow = {
  expenseShareId: string;
  amountRupiah: string;
};

export type RepaymentAllocationInputValues = RepaymentAllocationInputRow[];

export type RepaymentAllocationInput = {
  expenseShareId: string;
  amount: number;
};

export type RepaymentAllocationFieldErrors = Record<string, string>;

export type RepaymentAllocationValidationResult =
  | { ok: true; value: RepaymentAllocationInput[]; values: RepaymentAllocationInputValues }
  | { ok: false; errors: RepaymentAllocationFieldErrors; values: RepaymentAllocationInputValues };

function isCanonicalUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function rowValue(row: unknown, key: keyof RepaymentAllocationInputRow) {
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

export function validateRepaymentAllocationInput(input: unknown): RepaymentAllocationValidationResult {
  if (!Array.isArray(input)) return { ok: false, errors: { "row-0": "Allocation rows are invalid." }, values: [] };

  const values = input.map((row) => ({
    expenseShareId: rowValue(row, "expenseShareId").value,
    amountRupiah: rowValue(row, "amountRupiah").value,
  }));
  const errors: RepaymentAllocationFieldErrors = {};
  const seen = new Set<string>();
  const normalizedIds: string[] = [];

  values.forEach((row, index) => {
    const idValue = rowValue(input[index], "expenseShareId");
    const amountValue = rowValue(input[index], "amountRupiah");
    const errorKey = row.expenseShareId || `row-${index}`;
    if (!idValue.valid || !isCanonicalUuid(row.expenseShareId.toLowerCase())) {
      errors[errorKey] = "Select a valid expense share.";
      normalizedIds[index] = "";
      return;
    }

    const expenseShareId = row.expenseShareId.toLowerCase();
    normalizedIds[index] = expenseShareId;
    if (seen.has(expenseShareId)) errors[expenseShareId] = "Each expense share can appear only once.";
    seen.add(expenseShareId);
    if (!amountValue.valid || (row.amountRupiah && parseRupiah(row.amountRupiah) === null)) {
      errors[expenseShareId] ??= amountError(row.amountRupiah);
    }
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  return {
    ok: true,
    values,
    value: values.flatMap((row, index) => {
      if (!row.amountRupiah) return [];
      const amount = parseRupiah(row.amountRupiah);
      return amount === null ? [] : [{ expenseShareId: normalizedIds[index]!, amount }];
    }),
  };
}
