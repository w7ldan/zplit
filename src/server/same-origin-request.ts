export const SAME_ORIGIN_ERROR = "Invalid request origin.";

export function normalizeOrigin(value: string | null | undefined) {
  if (!value || value.includes(",")) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request, configuredUrl = process.env.BETTER_AUTH_URL) {
  const expected = normalizeOrigin(configuredUrl);
  const received = normalizeOrigin(request.headers.get("origin"));
  return expected !== null && received !== null && expected === received;
}
