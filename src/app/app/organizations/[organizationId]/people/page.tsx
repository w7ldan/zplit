import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getOrganizationForMember } from "@/server/organizations";
import { listOrganizationMembers, listPendingOrganizationInvitations } from "@/server/organization-invitations";
import { listPersonalFriendCandidates } from "@/server/collaboration-candidates";
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
  const database = getDatabase();
  let organization;
  try {
    organization = await getOrganizationForMember(database, organizationId, session.user.id);
  } catch {
    notFound();
  }
  const [members, pendingInvitations, friendCandidates, expenseFriendCandidates] = await Promise.all([
    organization.canViewMembers
      ? listOrganizationMembers(database, organizationId, session.user.id)
      : Promise.resolve(undefined),
    organization.invitationRoles?.length
      ? listPendingOrganizationInvitations(database, organizationId, session.user.id)
      : Promise.resolve([]),
    organization.invitationRoles?.length
      ? listPersonalFriendCandidates(database, session.user.id, { kind: "organization", id: organizationId })
      : Promise.resolve([]),
    organization.canViewLedger && organization.canManageFriends
      ? listPersonalFriendCandidates(
        database,
        session.user.id,
        { kind: "organization_expense_contact", id: organizationId },
      )
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
              Keep members, invitations, and expense contacts in one place.
            </p>
          </div>
        </header>
        <OrganizationMembers
          organizationId={organizationId}
          members={members}
          pendingInvitations={pendingInvitations}
          invitationRoles={organization.invitationRoles ?? []}
          friendCandidates={friendCandidates}
          expenseFriendCandidates={expenseFriendCandidates}
          canViewExpenseContacts={organization.canViewLedger}
          canManageExpenseContacts={organization.canManageFriends}
        />
      </div>
    </section>
  );
}
