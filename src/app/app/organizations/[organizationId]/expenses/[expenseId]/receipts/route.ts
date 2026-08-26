import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { ReceiptFileValidationError, validateReceiptFile } from "@/domain/receipt-file";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import { createExpenseReceipt, ExpenseReceiptCountError, ExpenseReceiptDuplicateError, ExpenseReceiptTotalSizeError, ExpenseReceiptUnavailableError } from "@/server/expense-receipts";
import { requireOrganizationLedgerAccess } from "@/server/organizations";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
function isUploadFile(value: FormDataEntryValue): value is File { return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "type" in value; }

export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string; expenseId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const { organizationId, expenseId } = await params;
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_REQUEST_BYTES) return json({ error: "Receipt upload requests must be 6 MiB or smaller." }, 413);
  try {
    const access = await requireOrganizationLedgerAccess(getDatabase(), organizationId, session.user.id, "expenses.edit");
    const formData = await request.formData();
    const entries = [...formData.entries()];
    if (entries.length !== 1 || entries[0]?.[0] !== "receipt" || !isUploadFile(entries[0][1])) return json({ field: "receipt", error: "Choose one receipt image." }, 400);
    const file = entries[0][1];
    const validated = validateReceiptFile({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mediaType: file.type.trim().toLowerCase() });
    return json({ receipt: await createExpenseReceipt(getDatabase(), { ledgerScopeId: access.ledgerScopeId }, expenseId, validated) });
  } catch (error) {
    if (error instanceof ReceiptFileValidationError) return json({ field: "receipt", error: error.message }, 400);
    if (error instanceof ExpenseReceiptUnavailableError) return new Response(error.message, { status: 404 });
    if (error instanceof ExpenseReceiptCountError || error instanceof ExpenseReceiptTotalSizeError || error instanceof ExpenseReceiptDuplicateError) return json({ error: error.message }, 409);
    return json({ error: "Unable to save this receipt." }, 500);
  }
}
