import type { Metadata } from "next";
import { unstable_noStore } from "next/cache";
import { resolveDebtorShareLink, DEBTOR_SHARE_UNAVAILABLE } from "@/server/debtor-share-links";
import { getDatabase } from "@/db/client";
import { DebtorStatementView } from "@/components/share/debtor-statement";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Private balance",
  description: "A private, read-only Zplit balance is ready to view.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: {
    title: "Private Zplit balance",
    description: "A private, read-only Zplit balance is ready to view.",
    siteName: "Zplit",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Private Zplit balance",
    description: "A private, read-only Zplit balance is ready to view.",
  },
};

type ShareSearchParams = Record<string, string | string[] | undefined>;

export default async function DebtorSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<ShareSearchParams>;
}) {
  unstable_noStore();
  const { token } = await params;
  const query = searchParams ? await searchParams : {};
  let resolved: Awaited<ReturnType<typeof resolveDebtorShareLink>> = null;
  try {
    resolved = await resolveDebtorShareLink(getDatabase(), token, new Date(), {
      expensePage: query.expensePage,
      repaymentPage: query.repaymentPage,
    });
  } catch {
    // Public resolution has one safe failure state.
  }
  if (resolved) return <DebtorStatementView statement={resolved.statement} expiresAt={resolved.expiresAt} token={token} />;

  return <main className="debtor-statement debtor-statement--unavailable"><div className="editorial-shell debtor-statement__shell"><p className="technical-label">READ-ONLY BALANCE</p><h1>{DEBTOR_SHARE_UNAVAILABLE}</h1></div></main>;
}
