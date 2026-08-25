import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getDatabase } from "@/db/client";
import { AvatarFileValidationError, validateAvatarFile } from "@/domain/avatar-file";
import { isSameOriginRequest, SAME_ORIGIN_ERROR } from "@/server/same-origin-request";
import {
  AVATAR_READ_HEADERS,
  MAX_AVATAR_BYTES,
  deleteUserAvatar,
  getUserAvatarForViewer,
  normalizeUserAvatar,
  saveUserAvatar,
} from "@/server/user-avatars";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = MAX_AVATAR_BYTES + 1024 * 1024;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}

function contentLengthError(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return "A valid Content-Length up to 6 MiB is required.";
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) return "A valid Content-Length up to 6 MiB is required.";
  if (length > MAX_REQUEST_BYTES) return "Avatar upload requests must be 6 MiB or smaller.";
  return null;
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "type" in value;
}

export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });

  const targetUserId = new URL(request.url).searchParams.get("userId")?.trim() || session.user.id;
  const avatar = await getUserAvatarForViewer(getDatabase(), session.user.id, targetUserId);
  if (!avatar) return new Response("Avatar unavailable.", { status: 404, headers: privateHeaders() });
  const etag = `"${avatar.sha256}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...AVATAR_READ_HEADERS, ETag: etag } });
  return new Response(avatar.content as unknown as BodyInit, {
    headers: {
      ...AVATAR_READ_HEADERS,
      "Content-Type": avatar.mediaType,
      "Content-Length": String(avatar.byteSize),
      ETag: etag,
    },
  });
}

export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  const lengthError = contentLengthError(request);
  if (lengthError) return json({ error: lengthError }, lengthError.startsWith("Avatar upload") ? 413 : 400);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ field: "avatar", error: "Choose one avatar image." }, 400);
  }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "avatar" || !isUploadFile(entries[0][1])) return json({ field: "avatar", error: "Choose one avatar image." }, 400);

  const file = entries[0][1];
  let normalized;
  try {
    const validated = validateAvatarFile({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mediaType: file.type.trim().toLowerCase() });
    normalized = await normalizeUserAvatar(validated);
  } catch (error) {
    if (error instanceof AvatarFileValidationError) return json({ field: "avatar", error: error.message }, 400);
    return json({ error: "Unable to read this avatar." }, 400);
  }

  try {
    const avatar = await saveUserAvatar(getDatabase(), session.user.id, normalized);
    return json({ avatar });
  } catch {
    return json({ error: "Unable to save this avatar." }, 500);
  }
}

export async function DELETE(request: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: privateHeaders() });
  if (!isSameOriginRequest(request)) return new Response(SAME_ORIGIN_ERROR, { status: 403 });
  try {
    await deleteUserAvatar(getDatabase(), session.user.id);
    return new Response(null, { status: 204, headers: privateHeaders() });
  } catch {
    return json({ error: "Unable to remove this avatar." }, 500);
  }
}
