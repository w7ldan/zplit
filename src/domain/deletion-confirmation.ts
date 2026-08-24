export function parseCascadeConfirmation(formData: FormData): boolean {
  const values = formData.getAll("confirmCascade");
  if (values.length === 0) return false;
  if (values.length !== 1 || values[0] !== "delete-dependents") throw new Error("Cascade confirmation is invalid.");
  return true;
}

export function parseImpactRevision(formData: FormData): string | null {
  const values = formData.getAll("impactRevision");
  if (values.length !== 1 || typeof values[0] !== "string" || !/^[0-9a-f]{64}$/.test(values[0])) return null;
  return values[0];
}
