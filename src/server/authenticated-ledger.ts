import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createLedgerRepository } from "@/domain/ledger-repository";
import type { OrganizationCapability } from "@/domain/organization-permissions";
import { getPersonalLedgerScopeId } from "@/server/ledger-scopes";

type Session = Awaited<ReturnType<typeof requireSession>>;

export async function getAuthenticatedLedger(session?: Session) {
  const authenticatedSession = session ?? await requireSession();
  const database = getDatabase();
  return {
    user: authenticatedSession.user,
    ledger: createLedgerRepository(database, await getPersonalLedgerScopeId(database, authenticatedSession.user.id)),
  };
}

export async function getAuthenticatedOrganizationLedger(organizationId: string, capability: OrganizationCapability, session?: Session) {
  const authenticatedSession = session ?? await requireSession();
  const database = getDatabase();
  const { requireOrganizationLedgerAccess } = await import("@/server/organizations");
  return {
    user: authenticatedSession.user,
    ...(await requireOrganizationLedgerAccess(database, organizationId, authenticatedSession.user.id, capability)),
  };
}
