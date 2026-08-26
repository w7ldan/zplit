import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getOrganizationForMember } from "@/server/organizations";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { OrganizationProfile } from "@/components/organizations/organization-detail";
import { RepaymentDestinationsSettings } from "@/components/settings/repayment-destinations-settings";
import { deleteOrganizationAction, updateOrganizationAction } from "../../actions";
import { createRepaymentDestinationAction, deleteRepaymentDestinationAction, setRepaymentDestinationOrderAction, updateRepaymentDestinationAction } from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const session = await requireSession();
  const { organizationId } = await params;
  const organization = await getOrganizationForMember(getDatabase(), organizationId, session.user.id);
  const canViewDestinations = organization.canViewLedger || organization.canManageRepaymentDestinations;
  const destinationAccess = canViewDestinations ? await getAuthenticatedOrganizationLedger(organizationId, organization.canManageRepaymentDestinations ? "repayment_destinations.manage" : "ledger.view", session) : null;
  const destinations = destinationAccess ? await destinationAccess.ledger.listRepaymentDestinations() : [];
  const entries = destinations.map((destination) => ({ id: destination.id, type: destination.type, name: destination.name, identifier: destination.identifier, accountName: destination.accountName, note: destination.note, shareOnBalanceLinks: destination.shareOnBalanceLinks, updateAction: updateRepaymentDestinationAction.bind(null, organizationId, destination.id), deleteAction: deleteRepaymentDestinationAction.bind(null, organizationId, destination.id) }));
  return <section className="app-page settings-page organization-settings-page" id="top"><div className="editorial-shell app-page__layout"><header className="app-page__header"><div><p className="technical-label">Organization settings</p><h1>Settings</h1><p className="app-page__lede">Manage this Organization’s profile and shared repayment details.</p></div></header>{organization.canUpdate ? <section className="settings-page__section organization-settings__profile"><OrganizationProfile organization={organization} action={updateOrganizationAction.bind(null, organizationId)} /></section> : null}{canViewDestinations ? <section className="settings-page__section ledger-section" id="repays-to"><div className="settings-page__section-heading"><div><p className="technical-label">Repays to</p><h2>Repayment destinations</h2><p>Destinations are shared ledger details for this Organization.</p></div><span className="technical-label">{destinations.length} destinations</span></div>{organization.canManageRepaymentDestinations ? <RepaymentDestinationsSettings destinations={entries} createAction={createRepaymentDestinationAction.bind(null, organizationId)} setOrderAction={setRepaymentDestinationOrderAction.bind(null, organizationId)} /> : <div className="record-history__rows">{entries.map((destination) => <div className="record-history__row" key={destination.id}><strong>{destination.name}</strong><span>{destination.identifier}</span></div>)}</div>}</section> : null}{organization.canExport ? <section className="settings-page__section organization-settings__exports" aria-labelledby="organization-exports-heading"><div><p className="technical-label">Data</p><h2 id="organization-exports-heading">Export management</h2><p>Download the Organization ledger in the available formats.</p></div><Link className="action-link action-link--quiet" href={`/app/organizations/${organizationId}/exports`}>View exports</Link></section> : null}{organization.canDelete ? <form className="organization-detail__delete" action={deleteOrganizationAction.bind(null, organizationId)}><button className="action-link action-link--quiet" type="submit">Delete organization</button></form> : null}</div></section>;
}
