import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { ReceiptFileValidationError, validateReceiptFile } from "@/domain/receipt-file";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import {
  createExpenseReceipt,
  ExpenseReceiptCountError,
  ExpenseReceiptDuplicateError,
  ExpenseReceiptTotalSizeError,
  ExpenseReceiptUnavailableError,
} from "@/server/expense-receipts";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const EXPENSE_UNAVAILABLE = "This expense is no longer available.";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function contentLengthError(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return "A valid Content-Length up to 6 MiB is required.";
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) return "A valid Content-Length up to 6 MiB is required.";
  if (length > MAX_REQUEST_BYTES) return "Receipt upload requests must be 6 MiB or smaller.";
  return null;
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "type" in value;
}

export async function POST(request: Request, { params }: { params: Promise<{ expenseId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "private, no-store" } });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const lengthError = contentLengthError(request);
  if (lengthError) return json({ error: lengthError }, lengthError.startsWith("Receipt upload") ? 413 : 400);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ field: "receipt", error: "Choose one receipt image." }, 400);
  }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "receipt" || !isUploadFile(entries[0][1])) {
    return json({ field: "receipt", error: "Choose one receipt image." }, 400);
  }

  const file = entries[0][1];
  let validatedFile;
  try {
    validatedFile = validateReceiptFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      mediaType: file.type.trim().toLowerCase(),
    });
  } catch (error) {
    if (error instanceof ReceiptFileValidationError) return json({ field: "receipt", error: error.message }, 400);
    return json({ error: "Unable to read this receipt." }, 400);
  }

  const { expenseId } = await params;
  try {
    const receipt = await createExpenseReceipt(getDatabase(), session.user.id, expenseId, validatedFile);
    return json({ receipt });
  } catch (error) {
    if (error instanceof ExpenseReceiptUnavailableError) return new Response(EXPENSE_UNAVAILABLE, { status: 404 });
    if (error instanceof ExpenseReceiptCountError || error instanceof ExpenseReceiptTotalSizeError || error instanceof ExpenseReceiptDuplicateError) {
      return json({ error: error.message }, 409);
    }
    return json({ error: "Unable to save this receipt." }, 500);
  }
}
