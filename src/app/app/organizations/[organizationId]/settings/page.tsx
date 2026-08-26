import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { RepaymentDestinationsSettings } from "@/components/settings/repayment-destinations-settings";
import { createRepaymentDestinationAction, deleteRepaymentDestinationAction, setRepaymentDestinationOrderAction, updateRepaymentDestinationAction } from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const access = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  const destinations = await access.ledger.listRepaymentDestinations();
  const canManage = access.can("repayment_destinations.manage");
  const entries = destinations.map((destination) => ({ id: destination.id, type: destination.type, name: destination.name, identifier: destination.identifier, accountName: destination.accountName, note: destination.note, shareOnBalanceLinks: destination.shareOnBalanceLinks, updateAction: updateRepaymentDestinationAction.bind(null, organizationId, destination.id), deleteAction: deleteRepaymentDestinationAction.bind(null, organizationId, destination.id) }));
  return <section className="app-page settings-page" id="top"><div className="editorial-shell app-page__layout"><header className="app-page__header"><div><p className="technical-label">Organization settings</p><h1>Settings</h1><p className="app-page__lede">Manage repayment destinations for this Organization.</p></div></header><section className="settings-page__section ledger-section" id="repays-to"><div className="settings-page__section-heading"><div><p className="technical-label">Repays to</p><h2>Repayment destinations</h2><p>Destinations are shared ledger details for this Organization.</p></div><span className="technical-label">{destinations.length} destinations</span></div>{canManage ? <RepaymentDestinationsSettings destinations={entries} createAction={createRepaymentDestinationAction.bind(null, organizationId)} setOrderAction={setRepaymentDestinationOrderAction.bind(null, organizationId)} /> : <div className="record-history__rows">{entries.map((destination) => <div className="record-history__row" key={destination.id}><strong>{destination.name}</strong><span>{destination.identifier}</span></div>)}</div>}</section></div></section>;
}
