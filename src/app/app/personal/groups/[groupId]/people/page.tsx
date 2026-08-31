import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getGroupForMember, listGroupParticipants } from "@/server/groups";
import { listGroupJoinRequests } from "@/server/group-join-requests";
import { GroupPeople } from "@/components/groups/group-people";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group people" };

export default async function GroupPeoplePage({ params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireSession();
  const { groupId } = await params;
  const database = getDatabase();
  let group;
  try { group = await getGroupForMember(database, groupId, session.user.id); } catch { notFound(); }
  const [participants, requests] = await Promise.all([
    listGroupParticipants(database, groupId, session.user.id),
    group.canManageParticipants ? listGroupJoinRequests(database, groupId, session.user.id) : Promise.resolve({ invitations: [], links: [] }),
  ]);
  return (
    <section className="app-page group-people-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Group people</p>
            <h1>People</h1>
            <p className="app-page__lede">Members keep one durable identity per Group, whether or not they have a Zplit account.</p>
          </div>
        </header>
        <GroupPeople
          groupId={groupId}
          participants={participants}
          pendingInvitations={requests.invitations}
          pendingLinks={requests.links}
          canManageParticipants={group.canManageParticipants}
          canManageRoles={group.canManageRoles}
        />
      </div>
    </section>
  );
}
