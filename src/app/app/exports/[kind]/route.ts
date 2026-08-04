import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { buildLedgerExportCsv, type LedgerExportKind } from "@/domain/ledger-export";

export const dynamic = "force-dynamic";

const exportKinds = new Set<LedgerExportKind>(["balances.csv", "expense-shares.csv", "repayments.csv"]);

function responseHeaders(filename: string) {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const { kind } = await params;
  if (!exportKinds.has(kind as LedgerExportKind)) return new Response("Not found", { status: 404 });

  const snapshot = await createLedgerRepository(getDatabase(), session.user.id).getLedgerExportSnapshot();
  const csv = buildLedgerExportCsv(kind as LedgerExportKind, snapshot);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `zplit-${kind.slice(0, -4)}-${date}.csv`;
  return new Response(csv, { headers: responseHeaders(filename) });
}
