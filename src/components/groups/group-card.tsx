import Link from "next/link";
import { GroupAvatar } from "@/components/groups/group-avatar";
import type { GroupSummary } from "@/server/groups";

function roleLabel(role: string) {
  return role[0]?.toUpperCase() + role.slice(1);
}

export function GroupCard({ group }: { group: GroupSummary }) {
  return <Link className="group-card" href={`/app/personal/groups/${group.id}`}><GroupAvatar groupId={group.id} customAvatar={group.avatar} size="md" decorative /><span className="group-card__details"><strong>{group.name}</strong><span>{roleLabel(group.role)} · {group.participantCount} {group.participantCount === 1 ? "participant" : "participants"}</span></span></Link>;
}
