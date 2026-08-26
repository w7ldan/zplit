import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getOrganizationForMember } from "@/server/organizations";
import { OrganizationIdentity } from "@/components/organizations/organization-detail";

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
  const base = `/app/organizations/${organizationId}`;
  const links = [
    ["Overview", base],
    ...(organization.canViewLedger ? [["Friends", `${base}/friends`], ["Trips", `${base}/trips`], ["Outings", `${base}/outings`], ["Expenses", `${base}/expenses`], ["Repayments", `${base}/repayments`]] : []),
    ...(organization.canExport ? [["Exports", `${base}/exports`]] : []),
    ...(organization.canViewLedger ? [["Settings", `${base}/settings`]] : []),
  ];
  return <>
    <header className="organization-context editorial-shell">
      <div className="organization-context__identity"><Link href="/app/organizations" className="organization-detail__back text-link">← Organizations</Link><OrganizationIdentity organization={organization} /><div className="organization-detail__facts"><span><span className="technical-label">ROLE</span>{organization.role[0]?.toUpperCase()}{organization.role.slice(1)}</span><span><span className="technical-label">MEMBERS</span>{organization.memberCount}</span></div></div>
      {organization.description ? <p className="organization-detail__description">{organization.description}</p> : null}
      <nav className="organization-context__nav" aria-label="Organization ledger navigation">{links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</nav>
    </header>
    {children}
  </>;
}
