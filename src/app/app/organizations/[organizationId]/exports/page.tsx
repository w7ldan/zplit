import Link from "next/link";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization exports" };
const exportsList = [["Friend balances", "Assigned, repaid, and outstanding totals.", "balances.csv"], ["Expense shares", "Each friend’s share and allocation state.", "expense-shares.csv"], ["Repayments", "Received and allocated repayment amounts.", "repayments.csv"]] as const;

export default async function OrganizationExportsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  await getAuthenticatedOrganizationLedger(organizationId, "exports.create");
  const base = `/app/organizations/${organizationId}`;
  return <section className="app-page exports-page" id="top"><div className="editorial-shell app-page__layout"><div className="app-page__header"><div><p className="technical-label">Organization exports</p><h1>Exports</h1><p className="app-page__lede">Download this Organization’s ledger data.</p></div></div><div className="exports-list">{exportsList.map(([title, description, kind]) => <div className="exports-row" key={kind}><div><h2>{title}</h2><p>{description}</p></div><Link className="text-link" href={`${base}/exports/${kind}`}>Download CSV <span aria-hidden="true">→</span></Link></div>)}</div></div></section>;
}
