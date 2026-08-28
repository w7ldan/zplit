import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { ReceiptFileValidationError, validateReceiptFile } from "@/domain/receipt-file";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import { createGroupExpenseReceipt, GroupExpenseReceiptCountError, GroupExpenseReceiptDuplicateError, GroupExpenseReceiptPermissionError, GroupExpenseReceiptTotalSizeError, GroupExpenseReceiptUnavailableError } from "@/server/group-expense-receipts";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const privateHeaders = () => ({ "Cache-Control": "private, no-store" });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders() });
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "type" in value;
}

export async function POST(request: Request, { params }: { params: Promise<{ groupId: string; expenseId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_REQUEST_BYTES) return json({ error: "Receipt upload requests must be 6 MiB or smaller." }, 413);
  let formData: FormData;
  try { formData = await request.formData(); } catch { return json({ field: "receipt", error: "Choose one receipt image." }, 400); }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "receipt" || !isUploadFile(entries[0][1])) return json({ field: "receipt", error: "Choose one receipt image." }, 400);
  const file = entries[0][1];
  let validated;
  try { validated = validateReceiptFile({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mediaType: file.type.trim().toLowerCase() }); }
  catch (error) { return error instanceof ReceiptFileValidationError ? json({ field: "receipt", error: error.message }, 400) : json({ error: "Unable to read this receipt." }, 400); }
  const { groupId, expenseId } = await params;
  try {
    return json({ receipt: await createGroupExpenseReceipt(getDatabase(), groupId, expenseId, session.user.id, validated) });
  } catch (error) {
    if (error instanceof GroupExpenseReceiptUnavailableError) return json({ error: error.message }, 404);
    if (error instanceof GroupExpenseReceiptPermissionError) return json({ error: error.message }, 403);
    if (error instanceof GroupExpenseReceiptCountError || error instanceof GroupExpenseReceiptTotalSizeError || error instanceof GroupExpenseReceiptDuplicateError) return json({ error: error.message }, 409);
    return json({ error: "Unable to save this receipt." }, 500);
  }
}
