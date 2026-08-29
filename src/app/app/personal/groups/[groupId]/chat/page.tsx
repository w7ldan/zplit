import { notFound } from "next/navigation";
import { ChatPanel } from "@/components/chat/chat-panel";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getGroupChat } from "@/server/chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group chat" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GroupChatPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<{ before?: string | string[] }>;
}) {
  const session = await requireSession();
  const { groupId } = await params;
  const query = await searchParams;
  let chat;
  try {
    chat = await getGroupChat(getDatabase(), groupId, session.user.id, first(query.before));
  } catch {
    notFound();
  }
  const olderHref = chat.nextCursor
    ? `/app/personal/groups/${groupId}/chat?before=${encodeURIComponent(chat.nextCursor)}#chat`
    : null;
  return <ChatPanel chat={chat} title="Chat" olderHref={olderHref} />;
}
