export function splitBudgetAmount(amount: number, count: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError("Budget amount must be a positive safe integer");
  if (!Number.isSafeInteger(count) || count < 1 || count > 24) throw new RangeError("Budget spread count must be between 1 and 24");
  if (count > amount) throw new RangeError("Budget spread count cannot exceed the amount");

  const base = Math.floor(amount / count);
  const remainder = amount % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
