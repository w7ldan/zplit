const PLACEHOLDER_ORIGIN = "https://zplit.invalid";
const MAX_RETURN_TARGET_LENGTH = 2048;
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f-\u009f\\]/;
const INVALID_PERCENT_ESCAPE = /%(?![0-9a-f]{2})/i;
const PERCENT_ESCAPE = /%[0-9a-f]{2}/i;

function containsUnsafeEncoding(value: string) {
  let current = value;
  let firstPass = true;
  while (true) {
    if (CONTROL_OR_BACKSLASH.test(current)) return true;
    if (firstPass && INVALID_PERCENT_ESCAPE.test(current)) return true;
    if (!PERCENT_ESCAPE.test(current)) return false;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return false;
      current = decoded;
      firstPass = false;
    } catch {
      return firstPass;
    }
  }
}

export function validateRepaymentReturnTarget(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RETURN_TARGET_LENGTH) return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || containsUnsafeEncoding(value)) return undefined;

  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return undefined;
  }

  if (
    url.origin !== PLACEHOLDER_ORIGIN ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname !== "zplit.invalid" ||
    url.pathname !== "/app/repayments"
  ) return undefined;

  return value;
}

export function addFriendToRepaymentReturnTarget(target: string, friendId: string) {
  if (!validateRepaymentReturnTarget(target) || typeof friendId !== "string" || !friendId) return undefined;
  const url = new URL(target, PLACEHOLDER_ORIGIN);
  url.searchParams.set("create", "1");
  url.searchParams.set("friendId", friendId);
  return `${url.pathname}${url.search}${url.hash}`;
}
