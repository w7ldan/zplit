import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import { deleteRepaymentPaymentProof, getRepaymentPaymentProof, PAYMENT_PROOF_READ_HEADERS, PAYMENT_PROOF_UNAVAILABLE_MESSAGE } from "@/server/repayment-payment-proofs";
import { requireOrganizationLedgerAccess } from "@/server/organizations";

export const dynamic = "force-dynamic";
const extensionByMediaType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string; repaymentId: string; proofId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: PAYMENT_PROOF_READ_HEADERS });
  const { organizationId, repaymentId, proofId } = await params;
  try {
    const access = await requireOrganizationLedgerAccess(getDatabase(), organizationId, session.user.id, "ledger.view");
    const proof = await getRepaymentPaymentProof(getDatabase(), { ledgerScopeId: access.ledgerScopeId }, repaymentId, proofId);
    if (!proof) return new Response(PAYMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: PAYMENT_PROOF_READ_HEADERS });
    const extension = extensionByMediaType[proof.mediaType as keyof typeof extensionByMediaType];
    if (!extension) return new Response(PAYMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: PAYMENT_PROOF_READ_HEADERS });
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(proof.content as unknown as BodyInit, { headers: { "Content-Type": proof.mediaType, "Content-Length": String(proof.byteSize), "Content-Disposition": `${disposition}; filename="payment-proof-${proof.id}.${extension}"`, ...PAYMENT_PROOF_READ_HEADERS } });
  } catch { return new Response(PAYMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: PAYMENT_PROOF_READ_HEADERS }); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ organizationId: string; repaymentId: string; proofId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: PAYMENT_PROOF_READ_HEADERS });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const { organizationId, repaymentId, proofId } = await params;
  try {
    const access = await requireOrganizationLedgerAccess(getDatabase(), organizationId, session.user.id, "repayments.edit");
    if (!await deleteRepaymentPaymentProof(getDatabase(), { ledgerScopeId: access.ledgerScopeId }, repaymentId, proofId)) return new Response(PAYMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: PAYMENT_PROOF_READ_HEADERS });
    return new Response(null, { status: 204, headers: PAYMENT_PROOF_READ_HEADERS });
  } catch { return new Response(PAYMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: PAYMENT_PROOF_READ_HEADERS }); }
}
