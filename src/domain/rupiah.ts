export const MAX_RUPIAH = 2_147_483_647;

export function parseRupiah(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const digits = /^\d+$/.test(text) ? text : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replaceAll(".", "") : null;
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= MAX_RUPIAH ? amount : null;
}

export function formatRupiah(amount: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount)}`;
}
