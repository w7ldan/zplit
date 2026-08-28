import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import { deleteGroupExpenseReceipt, getGroupExpenseReceipt, GroupExpenseReceiptPermissionError, GROUP_RECEIPT_UNAVAILABLE_MESSAGE } from "@/server/group-expense-receipts";
import { RECEIPT_READ_HEADERS } from "@/server/expense-receipts";

export const dynamic = "force-dynamic";

const extensionByMediaType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const privateHeaders = () => ({ "Cache-Control": "private, no-store" });

export async function GET(request: Request, { params }: { params: Promise<{ groupId: string; expenseId: string; receiptId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  const { groupId, expenseId, receiptId } = await params;
  try {
    const receipt = await getGroupExpenseReceipt(getDatabase(), groupId, expenseId, receiptId, session.user.id);
    if (!receipt) return new Response(GROUP_RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
    const extension = extensionByMediaType[receipt.mediaType as keyof typeof extensionByMediaType];
    if (!extension) return new Response(GROUP_RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(receipt.content as unknown as BodyInit, { headers: { "Content-Type": receipt.mediaType, "Content-Length": String(receipt.byteSize), "Content-Disposition": `${disposition}; filename="receipt-${receipt.id}.${extension}"`, ...RECEIPT_READ_HEADERS } });
  } catch { return new Response(GROUP_RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() }); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ groupId: string; expenseId: string; receiptId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const { groupId, expenseId, receiptId } = await params;
  try {
    if (!await deleteGroupExpenseReceipt(getDatabase(), groupId, expenseId, receiptId, session.user.id)) return new Response(GROUP_RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
    return new Response(null, { status: 204, headers: privateHeaders() });
  } catch (error) {
    if (error instanceof GroupExpenseReceiptPermissionError) return new Response(error.message, { status: 403, headers: privateHeaders() });
    return new Response(GROUP_RECEIPT_UNAVAILABLE_MESSAGE, { status: 404, headers: privateHeaders() });
  }
}
