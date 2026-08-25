import { headers } from "next/headers";
import { getAuth } from "@/auth/runtime";
import { getUnreadNotificationCountForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401, headers: HEADERS });
  const unreadCount = await getUnreadNotificationCountForUser(session.user.id);
  return Response.json({ unreadCount }, { headers: HEADERS });
}
