"use server";

import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createLedgerRepository, type GlobalSearchRecord } from "@/domain/ledger-repository";

export async function searchGlobalRecords(query = ""): Promise<GlobalSearchRecord[]> {
  const session = await requireSession();
  return createLedgerRepository(getDatabase(), session.user.id).searchGlobalRecords(query);
}
