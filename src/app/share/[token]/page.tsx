import type { Metadata } from "next";
import { unstable_noStore } from "next/cache";
import { resolveDebtorShareLink, DEBTOR_SHARE_UNAVAILABLE } from "@/server/debtor-share-links";
import { getDatabase } from "@/db/client";
import { DebtorStatementView } from "@/components/share/debtor-statement";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function DebtorSharePage({ params }: { params: Promise<{ token: string }> }) {
  unstable_noStore();
  const { token } = await params;
  let resolved: Awaited<ReturnType<typeof resolveDebtorShareLink>> = null;
  try {
    resolved = await resolveDebtorShareLink(getDatabase(), token);
  } catch {
    // Public resolution has one safe failure state.
  }
  if (resolved) return <DebtorStatementView statement={resolved.statement} expiresAt={resolved.expiresAt} />;

  return <main className="debtor-statement debtor-statement--unavailable"><div className="editorial-shell debtor-statement__shell"><p className="technical-label">READ-ONLY BALANCE</p><h1>{DEBTOR_SHARE_UNAVAILABLE}</h1></div></main>;
}
