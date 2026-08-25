export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "login",
  "logout",
  "signup",
  "settings",
  "support",
  "system",
  "zplit",
  "inbox",
  "notifications",
  "personal",
  "organizations",
  "groups",
  "share",
]);

export type UsernameResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeUsername(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
}

export function parseUsername(value: unknown): UsernameResult {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN_LENGTH) return { ok: false, error: "Username must be at least 3 characters." };
  if (username.length > USERNAME_MAX_LENGTH) return { ok: false, error: "Username must be no more than 20 characters." };
  if (!/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(username)) return { ok: false, error: "Username must start and end with a letter or number and use only letters, numbers, dots, and underscores." };
  if (/[._]{2}/.test(username)) return { ok: false, error: "Username cannot contain consecutive punctuation." };
  if (RESERVED_USERNAMES.has(username)) return { ok: false, error: "That username is reserved. Choose another." };
  return { ok: true, value: username };
}

export function formatUsername(username: string | null | undefined) {
  return username ? `@${username}` : "Not set";
}

export function formatUserIdentity(name: string, username: string | null | undefined) {
  return username ? `${name} ${formatUsername(username)}` : name;
}
