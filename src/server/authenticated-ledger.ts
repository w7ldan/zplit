import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createLedgerRepository } from "@/domain/ledger-repository";

type Session = Awaited<ReturnType<typeof requireSession>>;

export async function getAuthenticatedLedger(session?: Session) {
  const authenticatedSession = session ?? await requireSession();
  return {
    user: authenticatedSession.user,
    ledger: createLedgerRepository(getDatabase(), authenticatedSession.user.id),
  };
}
