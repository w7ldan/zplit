import { notFound } from "next/navigation";
import { ChatPanel } from "@/components/chat/chat-panel";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getOrganizationChat } from "@/server/chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization General" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrganizationGeneralPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{ before?: string | string[] }>;
}) {
  const session = await requireSession();
  const { organizationId } = await params;
  const query = await searchParams;
  let chat;
  try {
    chat = await getOrganizationChat(getDatabase(), organizationId, session.user.id, first(query.before));
  } catch {
    notFound();
  }
  const olderHref = chat.nextCursor
    ? `/app/organizations/${organizationId}/general?before=${encodeURIComponent(chat.nextCursor)}#chat`
    : null;
  return <ChatPanel chat={chat} title="General" olderHref={olderHref} />;
}
