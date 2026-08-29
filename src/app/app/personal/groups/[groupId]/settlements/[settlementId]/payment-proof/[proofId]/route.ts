import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import {
  deleteGroupSettlementProof,
  getGroupSettlementProof,
  GROUP_SETTLEMENT_PROOF_READ_HEADERS,
  GROUP_SETTLEMENT_PROOF_UNAVAILABLE_MESSAGE,
} from "@/server/group-settlement-proofs";

export const dynamic = "force-dynamic";

const extensionByMediaType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupId: string; settlementId: string; proofId: string }> },
) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
  const { groupId, settlementId, proofId } = await params;
  try {
    const proof = await getGroupSettlementProof(getDatabase(), groupId, settlementId, proofId, session.user.id);
    if (!proof) return new Response(GROUP_SETTLEMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
    const extension = extensionByMediaType[proof.mediaType as keyof typeof extensionByMediaType];
    if (!extension) return new Response(GROUP_SETTLEMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(proof.content as unknown as BodyInit, {
      headers: {
        "Content-Type": proof.mediaType,
        "Content-Length": String(proof.byteSize),
        "Content-Disposition": `${disposition}; filename="payment-proof-${proof.id}.${extension}"`,
        ...GROUP_SETTLEMENT_PROOF_READ_HEADERS,
      },
    });
  } catch {
    return new Response(GROUP_SETTLEMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ groupId: string; settlementId: string; proofId: string }> },
) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
  const { groupId, settlementId, proofId } = await params;
  try {
    const deleted = await deleteGroupSettlementProof(getDatabase(), groupId, settlementId, proofId, session.user.id);
    if (!deleted) return new Response(GROUP_SETTLEMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
    return new Response(null, { status: 204, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
  } catch {
    return new Response(GROUP_SETTLEMENT_PROOF_UNAVAILABLE_MESSAGE, { status: 404, headers: GROUP_SETTLEMENT_PROOF_READ_HEADERS });
  }
}
