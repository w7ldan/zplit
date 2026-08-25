import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { createRealtimeStream } from "@/server/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
  "X-Content-Type-Options": "nosniff",
};

const STREAM_HEADERS = {
  ...PRIVATE_HEADERS,
  "Content-Type": "text/event-stream",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: PRIVATE_HEADERS });

  return new Response(createRealtimeStream(session.user.id, request.signal, Boolean(request.headers.get("last-event-id"))), { headers: STREAM_HEADERS });
}
