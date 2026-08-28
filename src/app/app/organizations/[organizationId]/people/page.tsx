import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getOrganizationForMember } from "@/server/organizations";
import { listOrganizationMembers, listPendingOrganizationInvitations } from "@/server/organization-invitations";
import { OrganizationMembers } from "@/components/organizations/organization-members";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization people" };

export default async function OrganizationPeoplePage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const session = await requireSession();
  const { organizationId } = await params;
  let organization;
  try {
    organization = await getOrganizationForMember(getDatabase(), organizationId, session.user.id);
  } catch {
    notFound();
  }
  const [members, pendingInvitations] = await Promise.all([
    organization.canViewMembers
      ? listOrganizationMembers(getDatabase(), organizationId, session.user.id)
      : Promise.resolve(undefined),
    organization.invitationRoles?.length
      ? listPendingOrganizationInvitations(getDatabase(), organizationId, session.user.id)
      : Promise.resolve([]),
  ]);
  return (
    <section className="app-page organization-people-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Organization people</p>
            <h1>People</h1>
            <p className="app-page__lede">
              Keep members, invitations, and ledger contacts in one place.
            </p>
          </div>
        </header>
        <OrganizationMembers
          organizationId={organizationId}
          members={members}
          pendingInvitations={pendingInvitations}
          invitationRoles={organization.invitationRoles ?? []}
        />
        {organization.canViewLedger ? (
          <section
            className="organization-detail__section organization-people__contacts"
            aria-labelledby="organization-contacts-heading"
          >
            <div>
              <p className="technical-label">LEDGER CONTACTS</p>
              <h2 id="organization-contacts-heading">Ledger contacts</h2>
              <p className="organization-detail__supporting-copy">
                These local contacts represent people connected to Organization expenses.
                They are separate from registered members.
              </p>
            </div>
            <Link
              className="action-link action-link--quiet"
              href={`/app/organizations/${organizationId}/friends`}
            >
              Manage ledger contacts
            </Link>
          </section>
        ) : null}
      </div>
    </section>
  );
}
