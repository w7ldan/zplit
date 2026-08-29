import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { MAX_RECEIPT_BYTES, ReceiptFileValidationError, validateReceiptFile } from "@/domain/receipt-file";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import {
  createGroupSettlementProof,
  GroupSettlementProofAlreadyAttachedError,
  GroupSettlementProofPermissionError,
  GroupSettlementProofUnavailableError,
  replaceGroupSettlementProof,
} from "@/server/group-settlement-proofs";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = MAX_RECEIPT_BYTES + 1024 * 1024;
const privateHeaders = () => ({ "Cache-Control": "private, no-store" });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders() });
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "type" in value;
}

async function upload(
  request: Request,
  groupId: string,
  settlementId: string,
  replace: boolean,
) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403, headers: privateHeaders() });
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_REQUEST_BYTES) {
    return json({ error: "Payment proof upload requests must be 6 MiB or smaller." }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ field: "paymentProof", error: "Choose one payment proof image." }, 400);
  }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "paymentProof" || !isUploadFile(entries[0][1])) {
    return json({ field: "paymentProof", error: "Choose one payment proof image." }, 400);
  }

  const file = entries[0][1];
  let validatedFile;
  try {
    validatedFile = validateReceiptFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      mediaType: file.type.trim().toLowerCase(),
    }, "Payment proof");
  } catch (error) {
    return error instanceof ReceiptFileValidationError
      ? json({ field: "paymentProof", error: error.message }, 400)
      : json({ error: "Unable to read this payment proof." }, 400);
  }

  try {
    const paymentProof = replace
      ? await replaceGroupSettlementProof(getDatabase(), groupId, settlementId, session.user.id, validatedFile)
      : await createGroupSettlementProof(getDatabase(), groupId, settlementId, session.user.id, validatedFile);
    return json({ paymentProof });
  } catch (error) {
    if (error instanceof GroupSettlementProofUnavailableError) return json({ error: error.message }, 404);
    if (error instanceof GroupSettlementProofPermissionError) return json({ error: error.message }, 403);
    if (error instanceof GroupSettlementProofAlreadyAttachedError) return json({ error: error.message }, 409);
    return json({ error: replace ? "Unable to replace this payment proof." : "Unable to save this payment proof." }, 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupId: string; settlementId: string }> },
) {
  const { groupId, settlementId } = await params;
  return upload(request, groupId, settlementId, false);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ groupId: string; settlementId: string }> },
) {
  const { groupId, settlementId } = await params;
  return upload(request, groupId, settlementId, true);
}
