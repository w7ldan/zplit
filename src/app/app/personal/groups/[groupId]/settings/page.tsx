import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getGroupForMember } from "@/server/groups";
import { GroupProfile } from "@/components/groups/group-detail";
import { deleteGroupAction, updateGroupAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group settings" };

export default async function GroupSettingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireSession();
  const { groupId } = await params;
  let group;
  try { group = await getGroupForMember(getDatabase(), groupId, session.user.id); } catch { notFound(); }
  return <section className="app-page group-settings-page" id="top"><div className="editorial-shell app-page__layout"><header className="app-page__header"><div><p className="technical-label">Group settings</p><h1>Settings</h1><p className="app-page__lede">Manage this Group’s identity and participant space.</p></div></header>{group.canManageGroup ? <section className="group-detail__section"><GroupProfile group={group} action={updateGroupAction.bind(null, groupId)} /></section> : null}{group.canDelete ? <section className="group-detail__section group-settings__delete"><h2>Delete Group</h2><p>This removes the Group and its current participant records. There is no Group financial history in this stage.</p><form action={deleteGroupAction.bind(null, groupId)}><button className="action-link action-link--quiet" type="submit">Delete group</button></form></section> : <Link className="text-link" href={`/app/personal/groups/${groupId}`}>Back to Group <span aria-hidden="true">→</span></Link>}</div></section>;
}
