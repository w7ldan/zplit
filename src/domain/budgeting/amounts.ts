import { formatRupiah, MAX_RUPIAH } from "@/domain/rupiah";

export { MAX_RUPIAH };

export function parseNonNegativeRupiah(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const digits = /^\d+$/.test(text) ? text : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replaceAll(".", "") : null;
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_RUPIAH ? amount : null;
}

export function formatSignedRupiah(amount: number) {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("Budget derived amount must be a safe Rupiah integer");
  }
  return amount < 0 ? `-${formatRupiah(Math.abs(amount))}` : formatRupiah(amount);
}
