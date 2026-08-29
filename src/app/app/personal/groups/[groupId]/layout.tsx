import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getGroupForMember } from "@/server/groups";
import { GroupIdentity, GroupNavigation } from "@/components/groups/group-detail";

export const dynamic = "force-dynamic";

export default async function GroupLayout({ children, params }: { children: ReactNode; params: Promise<{ groupId: string }> }) {
  const session = await requireSession();
  const { groupId } = await params;
  let group;
  try { group = await getGroupForMember(getDatabase(), groupId, session.user.id); } catch { notFound(); }
  return (
    <>
      <header className="group-context editorial-shell">
        <Link
          href="/app/personal/groups"
          className="group-detail__back text-link"
        >
          ← Personal Groups
        </Link>
        <div className="group-context__identity">
          <GroupIdentity group={group} />
          <div className="group-context__facts">
            <span><span className="technical-label">ROLE</span>{group.role[0]?.toUpperCase()}{group.role.slice(1)}</span>
            <span><span className="technical-label">PARTICIPANTS</span>{group.participantCount}</span>
          </div>
        </div>
        {group.description ? (
          <p className="group-detail__description">{group.description}</p>
        ) : null}
        <GroupNavigation
          groupId={groupId}
          canManageGroup={group.canManageGroup}
        />
      </header>
      {children}
    </>
  );
}
