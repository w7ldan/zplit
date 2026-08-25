import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { getOrganizationForMember } from "@/server/organizations";
import { OrganizationProfile, OrganizationIdentity } from "@/components/organizations/organization-detail";
import { updateOrganizationAction, deleteOrganizationAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function OrganizationDetailPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const session = await requireSession();
  const { organizationId } = await params;
  let organization;
  try {
    organization = await getOrganizationForMember(getDatabase(), organizationId, session.user.id);
  } catch {
    notFound();
  }
  const update = updateOrganizationAction.bind(null, organizationId);
  return (
    <section className="app-page organization-detail-page" id="top">
      <div className="editorial-shell app-page__layout">
        <Link className="organization-detail__back text-link" href="/app/organizations">← Organizations</Link>
        <div className="organization-detail__header"><OrganizationIdentity organization={organization} /><div className="organization-detail__facts"><span><span className="technical-label">ROLE</span>{organization.role[0]?.toUpperCase()}{organization.role.slice(1)}</span><span><span className="technical-label">MEMBERS</span>{organization.memberCount}</span></div></div>
        {organization.description ? <p className="organization-detail__description">{organization.description}</p> : null}
        <div className="organization-detail__future" aria-label="Organization capabilities"><span className="technical-label">STAGE 7 FOUNDATION</span><p>Ledger, members, and Chat will appear here in later stages.</p></div>
        {organization.canUpdate ? <OrganizationProfile organization={organization} action={update} /> : null}
        {organization.canDelete ? <form className="organization-detail__delete" action={deleteOrganizationAction.bind(null, organizationId)}><button className="action-link action-link--quiet" type="submit">Delete organization</button></form> : null}
      </div>
    </section>
  );
}
