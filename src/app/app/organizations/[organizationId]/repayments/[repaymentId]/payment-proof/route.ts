import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { MAX_RECEIPT_BYTES, ReceiptFileValidationError, validateReceiptFile } from "@/domain/receipt-file";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import { createRepaymentPaymentProof, PAYMENT_PROOF_ALREADY_ATTACHED_MESSAGE, RepaymentPaymentProofAlreadyAttachedError, RepaymentPaymentProofUnavailableError, replaceRepaymentPaymentProof } from "@/server/repayment-payment-proofs";
import { requireOrganizationLedgerAccess } from "@/server/organizations";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = MAX_RECEIPT_BYTES + 1024 * 1024;
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
function isUploadFile(value: FormDataEntryValue): value is File { return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "type" in value; }

async function upload(request: Request, organizationId: string, repaymentId: string, replace: boolean) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_REQUEST_BYTES) return json({ error: "Payment proof upload requests must be 6 MiB or smaller." }, 413);
  try {
    const access = await requireOrganizationLedgerAccess(getDatabase(), organizationId, session.user.id, "repayments.edit");
    const formData = await request.formData();
    const entries = [...formData.entries()];
    if (entries.length !== 1 || entries[0]?.[0] !== "paymentProof" || !isUploadFile(entries[0][1])) return json({ field: "paymentProof", error: "Choose one payment proof image." }, 400);
    const file = entries[0][1];
    const validated = validateReceiptFile({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mediaType: file.type.trim().toLowerCase() }, "Payment proof");
    const paymentProof = replace ? await replaceRepaymentPaymentProof(getDatabase(), { ledgerScopeId: access.ledgerScopeId }, repaymentId, validated) : await createRepaymentPaymentProof(getDatabase(), { ledgerScopeId: access.ledgerScopeId }, repaymentId, validated);
    return json({ paymentProof });
  } catch (error) {
    if (error instanceof ReceiptFileValidationError) return json({ field: "paymentProof", error: error.message }, 400);
    if (error instanceof RepaymentPaymentProofUnavailableError) return new Response(error.message, { status: 404 });
    if (error instanceof RepaymentPaymentProofAlreadyAttachedError) return json({ error: PAYMENT_PROOF_ALREADY_ATTACHED_MESSAGE }, 409);
    return json({ error: replace ? "Unable to replace this payment proof." : "Unable to save this payment proof." }, 500);
  }
}
export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string; repaymentId: string }> }) { const { organizationId, repaymentId } = await params; return upload(request, organizationId, repaymentId, false); }
export async function PUT(request: Request, { params }: { params: Promise<{ organizationId: string; repaymentId: string }> }) { const { organizationId, repaymentId } = await params; return upload(request, organizationId, repaymentId, true); }
