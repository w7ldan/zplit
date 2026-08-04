import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import { deleteExpenseReceipt, getExpenseReceipt, RECEIPT_READ_HEADERS, RECEIPT_UNAVAILABLE_MESSAGE } from "@/server/expense-receipts";

export const dynamic = "force-dynamic";

const extensionByMediaType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}

export async function GET(_request: Request, { params }: { params: Promise<{ expenseId: string; receiptId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });

  const { expenseId, receiptId } = await params;
  try {
    const receipt = await getExpenseReceipt(getDatabase(), session.user.id, expenseId, receiptId);
    if (!receipt) return new Response(RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
    const extension = extensionByMediaType[receipt.mediaType as keyof typeof extensionByMediaType];
    if (!extension) return new Response(RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
    return new Response(receipt.content as unknown as BodyInit, {
      headers: {
        "Content-Type": receipt.mediaType,
        "Content-Length": String(receipt.byteSize),
        "Content-Disposition": `inline; filename="receipt-${receipt.id}.${extension}"`,
        ...RECEIPT_READ_HEADERS,
      },
    });
  } catch {
    return new Response(RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ expenseId: string; receiptId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });

  const { expenseId, receiptId } = await params;
  try {
    const deleted = await deleteExpenseReceipt(getDatabase(), session.user.id, expenseId, receiptId);
    if (!deleted) return new Response(RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
    return new Response(null, { status: 204, headers: privateHeaders() });
  } catch {
    return new Response(RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
  }
}
