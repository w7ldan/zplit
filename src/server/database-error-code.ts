export function databaseCode(error: unknown, includeCause = false): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return includeCause && "cause" in error ? databaseCode(error.cause, true) : undefined;
}
