import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createLedgerRepository } from "@/domain/ledger-repository";
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
