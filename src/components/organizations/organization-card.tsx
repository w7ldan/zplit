import Link from "next/link";
import type { LedgerFinancialOverview } from "@/domain/ledger/summary";
import { formatRupiah } from "@/domain/rupiah";
import type { OrganizationSummary } from "@/domain/organization-contracts";
import { OrganizationAvatar } from "@/components/organizations/organization-avatar";

function roleLabel(role: string) {
  return role[0]?.toUpperCase() + role.slice(1);
}

function OrganizationCardLedger({ summary }: { summary: LedgerFinancialOverview }) {
  if (summary.totalOutstandingAmount === 0 && summary.totalExpenseAmount === 0 && summary.totalRepaidAmount === 0) {
    return <span>All settled up</span>;
  }

  return summary.totalOutstandingAmount > 0 ? (
    <span>
      <span className="technical-label">OUTSTANDING</span>
      <strong>{formatRupiah(summary.totalOutstandingAmount)}</strong>
    </span>
  ) : (
    <span>
      <span className="technical-label">STATUS</span>
      <strong>Settled up</strong>
    </span>
  );
}

export function OrganizationCard({
  organization,
  ledgerSummary,
}: {
  organization: OrganizationSummary;
  ledgerSummary?: LedgerFinancialOverview | null;
}) {
  return (
    <Link className="organization-card" href={`/app/organizations/${organization.id}`}>
      <OrganizationAvatar
        organizationId={organization.id}
        customAvatar={organization.avatar}
        size="md"
        decorative
      />
      <span className="organization-card__details">
        <strong>{organization.name}</strong>
        <span>
          {roleLabel(organization.role)} · {organization.memberCount}{" "}
          {organization.memberCount === 1 ? "member" : "members"}
        </span>
        {ledgerSummary ? (
          <span className="organization-card__ledger">
            <OrganizationCardLedger summary={ledgerSummary} />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
