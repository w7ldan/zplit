import { getDatabase } from "@/db/client";
import { getSharedDebtorReceipt, PUBLIC_RECEIPT_UNAVAILABLE } from "@/server/debtor-share-links";
import { RECEIPT_READ_HEADERS } from "@/server/expense-receipts";

export const dynamic = "force-dynamic";

const extensionByMediaType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function unavailable() {
  return new Response(PUBLIC_RECEIPT_UNAVAILABLE, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; publicReceiptId: string }> }) {
  const { token, publicReceiptId } = await params;
  try {
    const receipt = await getSharedDebtorReceipt(getDatabase(), token, publicReceiptId);
    if (!receipt) return unavailable();
    const extension = extensionByMediaType[receipt.mediaType as keyof typeof extensionByMediaType];
    if (!extension) return unavailable();
    return new Response(receipt.content as unknown as BodyInit, {
      headers: {
        "Content-Type": receipt.mediaType,
        "Content-Length": String(receipt.byteSize),
        "Content-Disposition": `inline; filename="receipt-${receipt.id}.${extension}"`,
        ...RECEIPT_READ_HEADERS,
      },
    });
  } catch {
    return unavailable();
  }
}
