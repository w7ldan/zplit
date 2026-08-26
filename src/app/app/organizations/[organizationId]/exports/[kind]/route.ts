import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { buildLedgerExportCsv, type LedgerExportKind } from "@/domain/ledger-export";
import { requireOrganizationLedgerAccess } from "@/server/organizations";

export const dynamic = "force-dynamic";
const exportKinds = new Set<LedgerExportKind>(["balances.csv", "expense-shares.csv", "repayments.csv"]);
function responseHeaders(filename: string) { return { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }; }

export async function GET(_request: Request, { params }: { params: Promise<{ organizationId: string; kind: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { organizationId, kind } = await params;
  if (!exportKinds.has(kind as LedgerExportKind)) return new Response("Not found", { status: 404 });
  try {
    const access = await requireOrganizationLedgerAccess(getDatabase(), organizationId, session.user.id, "exports.create");
    const csv = buildLedgerExportCsv(kind as LedgerExportKind, await access.ledger.getLedgerExportSnapshot());
    return new Response(csv, { headers: responseHeaders(`zplit-organization-${kind.slice(0, -4)}-${new Date().toISOString().slice(0, 10)}.csv`) });
  } catch { return new Response("Forbidden", { status: 403 }); }
}
