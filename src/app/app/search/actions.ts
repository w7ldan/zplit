"use server";

import { requireSession } from "@/auth/require-session";
import type { GlobalSearchRecord } from "@/domain/ledger-repository";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";

export async function searchGlobalRecords(query = ""): Promise<GlobalSearchRecord[]> {
  const session = await requireSession();
  const { ledger } = await getAuthenticatedLedger(session);
  return ledger.searchGlobalRecords(query);
}
