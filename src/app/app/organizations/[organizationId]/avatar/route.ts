import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { AvatarFileValidationError, validateAvatarFile } from "@/domain/avatar-file";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import { AVATAR_READ_HEADERS, MAX_AVATAR_BYTES, normalizeUserAvatar } from "@/server/user-avatars";
import { deleteOrganizationAvatar, getOrganizationAvatar, OrganizationError, saveOrganizationAvatar } from "@/server/organizations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_REQUEST_BYTES = MAX_AVATAR_BYTES + 1024 * 1024;

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
function privateHeaders() { return { "Cache-Control": "private, no-store" }; }
function contentLengthError(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return "A valid Content-Length up to 6 MiB is required.";
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) return "A valid Content-Length up to 6 MiB is required.";
  return length > MAX_REQUEST_BYTES ? "Organization avatar upload requests must be 6 MiB or smaller." : null;
}
function isUploadFile(value: FormDataEntryValue): value is File { return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "type" in value; }
async function session() { return getAuth().api.getSession({ headers: await headers() }); }
function accessStatus(error: unknown) { return error instanceof OrganizationError && error.code === "not_owner" ? 403 : 404; }

export async function GET(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const current = await session();
  if (!current) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  const { organizationId } = await params;
  try {
    const avatar = await getOrganizationAvatar(getDatabase(), organizationId, current.user.id);
    if (!avatar) return new Response("Avatar unavailable.", { status: 404, headers: privateHeaders() });
    const etag = `"${avatar.sha256}"`;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...AVATAR_READ_HEADERS, ETag: etag } });
    return new Response(avatar.content as unknown as BodyInit, { headers: { ...AVATAR_READ_HEADERS, "Content-Type": avatar.mediaType, "Content-Length": String(avatar.byteSize), ETag: etag } });
  } catch (error) { return new Response("Avatar unavailable.", { status: accessStatus(error), headers: privateHeaders() }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const current = await session();
  if (!current) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const lengthError = contentLengthError(request);
  if (lengthError) return json({ error: lengthError }, lengthError.startsWith("Organization avatar") ? 413 : 400);
  let formData: FormData;
  try { formData = await request.formData(); } catch { return json({ field: "avatar", error: "Choose one avatar image." }, 400); }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "avatar" || !isUploadFile(entries[0][1])) return json({ field: "avatar", error: "Choose one avatar image." }, 400);
  try {
    const file = entries[0][1];
    const normalized = await normalizeUserAvatar(validateAvatarFile({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mediaType: file.type.trim().toLowerCase() }));
    const avatar = await saveOrganizationAvatar(getDatabase(), (await params).organizationId, current.user.id, normalized);
    return json({ avatar });
  } catch (error) {
    if (error instanceof AvatarFileValidationError) return json({ field: "avatar", error: error.message }, 400);
    if (error instanceof OrganizationError) return new Response("Organization unavailable.", { status: accessStatus(error), headers: privateHeaders() });
    return json({ error: "Unable to save this avatar." }, 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const current = await session();
  if (!current) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  try { await deleteOrganizationAvatar(getDatabase(), (await params).organizationId, current.user.id); return new Response(null, { status: 204, headers: privateHeaders() }); }
  catch (error) { return new Response("Organization unavailable.", { status: accessStatus(error), headers: privateHeaders() }); }
}
