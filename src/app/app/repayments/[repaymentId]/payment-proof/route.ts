import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { MAX_RECEIPT_BYTES, ReceiptFileValidationError, validateReceiptFile } from "@/domain/receipt-file";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import {
  createRepaymentPaymentProof,
  PAYMENT_PROOF_ALREADY_ATTACHED_MESSAGE,
  RepaymentPaymentProofAlreadyAttachedError,
  RepaymentPaymentProofUnavailableError,
  replaceRepaymentPaymentProof,
} from "@/server/repayment-payment-proofs";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = MAX_RECEIPT_BYTES + 1024 * 1024;
const PAYMENT_PROOF_UNAVAILABLE = "This repayment is no longer available.";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function contentLengthError(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return "A valid Content-Length up to 6 MiB is required.";
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) return "A valid Content-Length up to 6 MiB is required.";
  if (length > MAX_REQUEST_BYTES) return "Payment proof upload requests must be 6 MiB or smaller.";
  return null;
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "type" in value;
}

async function upload(request: Request, repaymentId: string, replace: boolean) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "private, no-store" } });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const lengthError = contentLengthError(request);
  if (lengthError) return json({ error: lengthError }, lengthError.startsWith("Payment proof upload") ? 413 : 400);

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
    if (error instanceof ReceiptFileValidationError) return json({ field: "paymentProof", error: error.message }, 400);
    return json({ error: "Unable to read this payment proof." }, 400);
  }

  try {
    const paymentProof = replace
      ? await replaceRepaymentPaymentProof(getDatabase(), session.user.id, repaymentId, validatedFile)
      : await createRepaymentPaymentProof(getDatabase(), session.user.id, repaymentId, validatedFile);
    return json({ paymentProof });
  } catch (error) {
    if (error instanceof RepaymentPaymentProofUnavailableError) return new Response(PAYMENT_PROOF_UNAVAILABLE, { status: 404 });
    if (error instanceof RepaymentPaymentProofAlreadyAttachedError) return json({ error: PAYMENT_PROOF_ALREADY_ATTACHED_MESSAGE }, 409);
    return json({ error: replace ? "Unable to replace this payment proof." : "Unable to save this payment proof." }, 500);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ repaymentId: string }> }) {
  const { repaymentId } = await params;
  return upload(request, repaymentId, false);
}

export async function PUT(request: Request, { params }: { params: Promise<{ repaymentId: string }> }) {
  const { repaymentId } = await params;
  return upload(request, repaymentId, true);
}
