import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getOrganizationForMember } from "@/server/organizations";
import { getOrganizationChatUnreadCount } from "@/server/chat";
import { OrganizationIdentity, OrganizationNavigation } from "@/components/organizations/organization-detail";
import { zplitVNextFont } from "@/app/fonts";

export const dynamic = "force-dynamic";

export default async function OrganizationLayout({ children, params }: { children: ReactNode; params: Promise<{ organizationId: string }> }) {
  const session = await requireSession();
  const { organizationId } = await params;
  let organization;
  try {
    organization = await getOrganizationForMember(getDatabase(), organizationId, session.user.id);
  } catch {
    notFound();
  }
  const chatUnreadCount = organization.canViewChat
    ? await getOrganizationChatUnreadCount(getDatabase(), organizationId, session.user.id)
    : 0;
  const role = organization.role[0]?.toUpperCase() + organization.role.slice(1);
  return <div className={`zplit-vnext organizations-vnext ${zplitVNextFont.variable}`}>
    <header className="organization-context editorial-shell">
      <div className="organization-context__topline">
        <div className="organization-context__identity">
          <OrganizationIdentity organization={organization} />
          <p className="organization-context__facts">{role} · {organization.memberCount} {organization.memberCount === 1 ? "member" : "members"}</p>
        </div>
        <Link href="/app/organizations" className="organization-detail__back text-link">Organizations</Link>
      </div>
      {organization.description ? <p className="organization-detail__description">{organization.description}</p> : null}
      <OrganizationNavigation organizationId={organizationId} canViewLedger={organization.canViewLedger} canViewChat={organization.canViewChat} chatUnreadCount={chatUnreadCount} canViewPeople={organization.canViewMembers || organization.canViewLedger} canViewSettings={organization.canUpdate || organization.canDelete || organization.canManageRepaymentDestinations || organization.canExport} />
    </header>
    {children}
  </div>;
}
