import type { OrganizationCapability } from "@/domain/organization-permissions";

type Session = { user: { id: string } };
type LedgerAccess = { ledger: unknown };

export async function getOrganizationLedgerForSession(organizationId: string, capability: OrganizationCapability, session: Session) {
  const [{ getDatabase }, { requireOrganizationLedgerAccess }] = await Promise.all([import("@/db/client"), import("@/server/organizations")]);
  const database = getDatabase();
  return requireOrganizationLedgerAccess(database, organizationId, session.user.id, capability);
}

export async function assertOrganizationLedgerWritable(organizationId: string) {
  const [{ getDatabase }, { assertOrganizationActiveForOperationalMutation }] = await Promise.all([
    import("@/db/client"),
    import("@/server/organizations"),
  ]);
  await assertOrganizationActiveForOperationalMutation(getDatabase(), organizationId);
}

export function organizationIdFromForm(formData: FormData) {
  const organizationId = formData.get("organizationId");
  return typeof organizationId === "string" && organizationId.trim() ? organizationId : null;
}

export async function assertOrganizationLedgerWritableFromForm(formData: FormData) {
  const organizationId = organizationIdFromForm(formData);
  if (organizationId) await assertOrganizationLedgerWritable(organizationId);
}

export async function getLedgerForAction<T extends LedgerAccess>(session: Session, formData: FormData, capability: OrganizationCapability, personal: () => Promise<T>): Promise<T> {
  const organizationId = formData.get("organizationId");
  if (typeof organizationId !== "string" || !organizationId.trim()) return personal();
  return getOrganizationLedgerForSession(organizationId, capability, session) as unknown as Promise<T>;
}

export function ledgerPath(formData: FormData, personalPath: string) {
  const organizationId = formData.get("organizationId");
  if (typeof organizationId === "string" && organizationId.trim()) return `/app/organizations/${encodeURIComponent(organizationId)}${personalPath === "/app" ? "" : personalPath.startsWith("/app/") ? personalPath.slice(4) : personalPath}`;
  return personalPath.startsWith("/app") ? personalPath : `/app${personalPath}`;
}
