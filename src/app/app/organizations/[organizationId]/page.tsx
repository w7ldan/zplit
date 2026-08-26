import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { getOrganizationForMember } from "@/server/organizations";
import { listOrganizationMembers, listPendingOrganizationInvitations } from "@/server/organization-invitations";
import { OrganizationProfile } from "@/components/organizations/organization-detail";
import { OrganizationMembers } from "@/components/organizations/organization-members";
import { updateOrganizationAction, deleteOrganizationAction } from "../actions";
import { formatRupiah } from "@/domain/rupiah";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";

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
  const [members, pendingInvitations] = await Promise.all([
    organization.canViewMembers ? listOrganizationMembers(getDatabase(), organizationId, session.user.id) : Promise.resolve(undefined),
    organization.invitationRoles?.length ? listPendingOrganizationInvitations(getDatabase(), organizationId, session.user.id) : Promise.resolve([]),
  ]);
  const summary = organization.canViewLedger ? (await getAuthenticatedOrganizationLedger(organizationId, "ledger.view", session)).ledger.getLedgerOverviewSummary() : null;
  const ledgerSummary = summary ? await summary : null;
  const update = updateOrganizationAction.bind(null, organizationId);
  return (
    <section className="app-page organization-detail-page" id="top">
      <div className="editorial-shell app-page__layout">
        {organization.canViewLedger && ledgerSummary ? <section className="organization-detail__section" aria-labelledby="organization-ledger-heading"><p className="technical-label">LEDGER</p><h2 id="organization-ledger-heading">Organization finances</h2><div className="organization-ledger-summary"><div><span className="technical-label">OUTSTANDING</span><strong>{formatRupiah(ledgerSummary.totalOutstandingAmount)}</strong></div><div><span className="technical-label">EXPENSES</span><strong>{formatRupiah(ledgerSummary.totalExpenseAmount)}</strong></div><div><span className="technical-label">REPAID</span><strong>{formatRupiah(ledgerSummary.totalRepaidAmount)}</strong></div></div></section> : null}
        {organization.canUpdate ? <OrganizationProfile organization={organization} action={update} /> : null}
        {organization.canDelete ? <form className="organization-detail__delete" action={deleteOrganizationAction.bind(null, organizationId)}><button className="action-link action-link--quiet" type="submit">Delete organization</button></form> : null}
        <OrganizationMembers organizationId={organizationId} members={members} pendingInvitations={pendingInvitations} invitationRoles={organization.invitationRoles ?? []} />
      </div>
    </section>
  );
}
