import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getOrganizationForMember, hasOrganizationFinancialHistory } from "@/server/organizations";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { DeleteConfirmationDialog } from "@/components/app/delete-confirmation-dialog";
import { OrganizationProfile } from "@/components/organizations/organization-detail";
import { RepaymentDestinationsSettings } from "@/components/settings/repayment-destinations-settings";
import {
  archiveOrganizationAction,
  deleteOrganizationAction,
  restoreOrganizationAction,
  updateOrganizationAction,
} from "../../actions";
import {
  createRepaymentDestinationAction,
  deleteRepaymentDestinationAction,
  setRepaymentDestinationOrderAction,
  updateRepaymentDestinationAction,
} from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{ error?: string | string[] }>;
}) {
  const session = await requireSession();
  const { organizationId } = await params;
  const query = await searchParams;
  const organization = await getOrganizationForMember(
    getDatabase(),
    organizationId,
    session.user.id,
  );
  const ledgerBlocked = (Array.isArray(query.error) ? query.error[0] : query.error) === "ledger_not_empty";
  const archived = organization.archivedAt !== null;
  const financialHistory = archived ? true : await hasOrganizationFinancialHistory(getDatabase(), organizationId).catch(() => true);
  const canViewDestinations =
    organization.canViewLedger || organization.canManageRepaymentDestinations;
  const canManageDestinations = organization.canManageRepaymentDestinations && !archived;
  const destinationAccess = canViewDestinations
    ? await getAuthenticatedOrganizationLedger(
        organizationId,
        organization.canManageRepaymentDestinations
          ? "repayment_destinations.manage"
          : "ledger.view",
        session,
      )
    : null;
  const destinations = destinationAccess
    ? await destinationAccess.ledger.listRepaymentDestinations()
    : [];
  const entries = destinations.map((destination) => ({
    id: destination.id,
    type: destination.type,
    name: destination.name,
    identifier: destination.identifier,
    accountName: destination.accountName,
    note: destination.note,
    shareOnBalanceLinks: destination.shareOnBalanceLinks,
    updateAction: updateRepaymentDestinationAction.bind(
      null,
      organizationId,
      destination.id,
    ),
    deleteAction: deleteRepaymentDestinationAction.bind(
      null,
      organizationId,
      destination.id,
    ),
  }));
  return (
    <section
      className="app-page settings-page organization-settings-page"
      id="top"
    >
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Organization settings</p>
            <h1>Settings</h1>
            <p className="app-page__lede">
              Manage this Organization’s profile and shared repayment details.
            </p>
          </div>
        </header>
        {organization.canUpdate && !archived ? (
          <section className="settings-page__section organization-settings__profile">
            <OrganizationProfile
              organization={organization}
              action={updateOrganizationAction.bind(null, organizationId)}
            />
          </section>
        ) : null}
        {canViewDestinations ? (
          <section
            className="settings-page__section ledger-section"
            id="repays-to"
          >
            <div className="settings-page__section-heading">
              <div>
                <p className="technical-label">Repays to</p>
                <h2>Repayment destinations</h2>
                <p>
                  Destinations are shared ledger details for this Organization.
                </p>
              </div>
              <span className="technical-label">
                {destinations.length} destinations
              </span>
            </div>
            {canManageDestinations ? (
              <RepaymentDestinationsSettings
                destinations={entries}
                createAction={createRepaymentDestinationAction.bind(
                  null,
                  organizationId,
                )}
                setOrderAction={setRepaymentDestinationOrderAction.bind(
                  null,
                  organizationId,
                )}
              />
            ) : (
              <div className="record-history__rows">
                {entries.map((destination) => (
                  <div className="record-history__row" key={destination.id}>
                    <strong>{destination.name}</strong>
                    <span>{destination.identifier}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
        {organization.canExport ? (
          <section
            className="settings-page__section organization-settings__exports"
            aria-labelledby="organization-exports-heading"
          >
            <div>
              <p className="technical-label">Data</p>
              <h2 id="organization-exports-heading">Export management</h2>
              <p>Download the Organization ledger in the available formats.</p>
            </div>
            <Link
              className="action-link action-link--quiet"
              href={`/app/organizations/${organizationId}/exports`}
            >
              View exports
            </Link>
          </section>
        ) : null}
        {organization.canDelete ? (
          <div className="organization-detail__delete">
            {archived ? (
              <>
                <h2>Archived</h2>
                <p>This organization is archived. Its history is preserved, but new activity is limited.</p>
                <DeleteConfirmationDialog
                  title="Restore organization?"
                  entityName={organization.name}
                  confirmLabel="Restore organization"
                  pendingLabel="Restoring organization…"
                  description={`“${organization.name}” will become active again with its history preserved.`}
                  action={restoreOrganizationAction.bind(null, organizationId)}
                />
              </>
            ) : financialHistory ? (
              <>
                {ledgerBlocked ? (
                  <p className="group-form__field-error" role="alert">
                    This organization cannot be deleted because it has financial history. The records remain untouched.
                  </p>
                ) : null}
                <DeleteConfirmationDialog
                  title="Archive organization?"
                  entityName={organization.name}
                  confirmLabel="Archive organization"
                  pendingLabel="Archiving organization…"
                  description={`“${organization.name}” has financial history, so it will be archived instead of permanently deleted. Its financial records and history will be preserved.`}
                  action={archiveOrganizationAction.bind(null, organizationId)}
                />
              </>
            ) : (
              <DeleteConfirmationDialog
                title="Delete organization?"
                entityName={organization.name}
                confirmLabel="Delete organization"
                pendingLabel="Deleting organization…"
                action={deleteOrganizationAction.bind(null, organizationId)}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
