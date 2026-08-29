import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getOrganizationForMember } from "@/server/organizations";
import { OrganizationIdentity, OrganizationNavigation } from "@/components/organizations/organization-detail";

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
  return <>
    <header className="organization-context editorial-shell">
      <Link href="/app/organizations" className="organization-detail__back text-link">← Organizations</Link>
      <div className="organization-context__identity">
        <OrganizationIdentity organization={organization} />
        <div className="organization-context__facts">
          <span>
            <span className="technical-label">ROLE</span>
            {organization.role[0]?.toUpperCase()}
            {organization.role.slice(1)}
          </span>
          <span>
            <span className="technical-label">MEMBERS</span>
            {organization.memberCount}
          </span>
        </div>
      </div>
      {organization.description ? <p className="organization-detail__description">{organization.description}</p> : null}
      <OrganizationNavigation organizationId={organizationId} canViewLedger={organization.canViewLedger} canViewChat={organization.canViewChat} canViewPeople={organization.canViewMembers || organization.canViewLedger} canViewSettings={organization.canUpdate || organization.canDelete || organization.canManageRepaymentDestinations || organization.canExport} />
    </header>
    {children}
  </>;
}
