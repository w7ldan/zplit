import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getGroupForMember, listGroupParticipants } from "@/server/groups";
import { listGroupJoinRequests } from "@/server/group-join-requests";
import { GroupPeople } from "@/components/groups/group-people";

export const dynamic = "force-dynamic";

export default async function GroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireSession();
  const { groupId } = await params;
  let group;
  try { group = await getGroupForMember(getDatabase(), groupId, session.user.id); } catch { notFound(); }
  const participants = await listGroupParticipants(getDatabase(), groupId, session.user.id);
  const requests = group.canManageParticipants ? await listGroupJoinRequests(getDatabase(), groupId, session.user.id) : { invitations: [], links: [] };
  return <section className="app-page group-detail-page" id="top"><div className="editorial-shell app-page__layout"><section className="group-detail__section group-detail__overview"><p className="technical-label">PEER-TO-PEER SPACE</p><h2>Shared participants, ready for accounting</h2><p className="group-detail__supporting-copy">Record shared spending here. Confirmed expenses create clear participant-to-participant obligations.</p><div className="group-detail__facts"><span><strong>{group.participantCount}</strong> participants</span><span><strong>{group.memberCount}</strong> registered members</span><span><strong>{group.externalParticipantCount}</strong> external participants</span></div></section><section className="group-detail__section" aria-labelledby="group-people-heading"><div className="group-section-heading"><div><p className="technical-label">PEOPLE</p><h2 id="group-people-heading">People</h2></div><span className="technical-label">Members and external participants</span></div><GroupPeople groupId={groupId} participants={participants} pendingInvitations={requests.invitations} pendingLinks={requests.links} canManageParticipants={group.canManageParticipants} canManageRoles={group.canManageRoles} /></section></div></section>;
}
