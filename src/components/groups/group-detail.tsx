"use client";

import { AvatarSettings } from "@/components/settings/avatar-settings";
import { GroupAvatar, groupAvatarSeed } from "@/components/groups/group-avatar";
import { GroupForm } from "@/components/groups/group-form";
import type { GroupActionState } from "@/domain/group-contracts";
import { usePathname } from "next/navigation";
import Link from "next/link";

type ProfileAction = (previousState: GroupActionState, formData: FormData) => Promise<GroupActionState>;

export function GroupProfile({ group, action }: { group: { id: string; name: string; description: string | null; avatar: { sha256: string } | null }; action: ProfileAction }) {
  return <div className="group-detail__profile"><h2>Group profile</h2><GroupForm action={action} edit initialValues={{ name: group.name, description: group.description ?? "" }} /><AvatarSettings userId={group.id} defaultAvatarSeed={groupAvatarSeed(group.id)} avatar={group.avatar} endpoint={`/app/personal/groups/${group.id}/avatar`} avatarUrl={(avatar) => `/app/personal/groups/${group.id}/avatar?v=${encodeURIComponent(avatar.sha256)}`}><p className="technical-label">PROFILE IMAGE</p></AvatarSettings></div>;
}

export function GroupIdentity({ group }: { group: { id: string; name: string; avatar: { sha256: string } | null } }) {
  return <div className="group-detail__identity"><GroupAvatar groupId={group.id} customAvatar={group.avatar} size="lg" /><div><p className="technical-label">GROUP</p><h1>{group.name}</h1></div></div>;
}

export function GroupNavigation({ groupId, canManageGroup }: { groupId: string; canManageGroup: boolean }) {
  const pathname = usePathname() ?? "";
  const base = `/app/personal/groups/${groupId}`;
  return <nav className="group-context__nav" aria-label="Group navigation"><Link href={base} aria-current={pathname === base ? "page" : undefined}>Overview</Link><Link href={`${base}/expenses`} aria-current={pathname.startsWith(`${base}/expenses`) ? "page" : undefined}>Expenses</Link><Link href={`${base}/people`} aria-current={pathname.startsWith(`${base}/people`) ? "page" : undefined}>People</Link>{canManageGroup ? <Link href={`${base}/settings`} aria-current={pathname.startsWith(`${base}/settings`) ? "page" : undefined}>Settings</Link> : null}</nav>;
}
