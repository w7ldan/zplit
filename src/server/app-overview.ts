import "server-only";

import type { Database } from "@/db/client";
import {
  readLedgerOverviewSummaries,
  type LedgerFinancialOverview,
} from "@/domain/ledger/summary";
import { listGroupOverviewSummaries, type GroupOverviewSummary } from "@/server/groups";
import { listOrganizationOverviewSummaries, type OrganizationOverviewSummary } from "@/server/organizations";

export type AppOverviewOrganization = Omit<OrganizationOverviewSummary, "ledgerScopeId"> & {
  ledgerSummary: LedgerFinancialOverview | null;
};

export type AppOverviewSpaces = {
  groups: GroupOverviewSummary[];
  organizations: AppOverviewOrganization[];
};

export async function readOverviewSpaces(
  database: Database,
  userId: string,
): Promise<AppOverviewSpaces> {
  const [groups, organizations] = await Promise.all([
    listGroupOverviewSummaries(database, userId),
    listOrganizationOverviewSummaries(database, userId),
  ]);
  const ledgerScopeIds = organizations.flatMap((organization) => (
    organization.canViewLedger && organization.ledgerScopeId
      ? [organization.ledgerScopeId]
      : []
  ));
  const ledgerSummaries = await readLedgerOverviewSummaries(database, ledgerScopeIds);
  return {
    groups,
    organizations: organizations.map(({ ledgerScopeId, ...organization }) => ({
      ...organization,
      ledgerSummary: organization.canViewLedger && ledgerScopeId ? ledgerSummaries.get(ledgerScopeId) ?? null : null,
    })),
  };
}
