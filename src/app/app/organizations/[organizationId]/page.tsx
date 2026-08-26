import { notFound } from "next/navigation";
import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { getOrganizationForMember } from "@/server/organizations";
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
  const summary = organization.canViewLedger ? (await getAuthenticatedOrganizationLedger(organizationId, "ledger.view", session)).ledger.getLedgerOverviewSummary() : null;
  const ledgerSummary = summary ? await summary : null;
  return (
    <section className="app-page organization-detail-page" id="top">
      <div className="editorial-shell app-page__layout">
        {organization.canViewLedger && ledgerSummary ? <section className="organization-detail__section organization-detail__overview" aria-labelledby="organization-ledger-heading"><div><p className="technical-label">OVERVIEW</p><h2 id="organization-ledger-heading">Shared ledger at a glance</h2><p className="organization-detail__supporting-copy">Use this workspace to track shared spending, repayment, and the people connected to it.</p></div><div className="organization-ledger-summary"><div><span className="technical-label">OUTSTANDING</span><strong>{formatRupiah(ledgerSummary.totalOutstandingAmount)}</strong></div><div><span className="technical-label">EXPENSES</span><strong>{formatRupiah(ledgerSummary.totalExpenseAmount)}</strong></div><div><span className="technical-label">REPAID</span><strong>{formatRupiah(ledgerSummary.totalRepaidAmount)}</strong></div></div><nav className="organization-detail__shortcuts" aria-label="Organization shortcuts"><Link href={`/app/organizations/${organizationId}/expenses`}>View expenses</Link><Link href={`/app/organizations/${organizationId}/repayments`}>View repayments</Link><Link href={`/app/organizations/${organizationId}/people`}>View people</Link></nav></section> : <section className="organization-detail__section organization-detail__overview"><p className="organization-detail__supporting-copy">This Organization workspace is ready for the capabilities available to you.</p></section>}
      </div>
    </section>
  );
}
