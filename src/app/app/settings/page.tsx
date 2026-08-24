import { ThemeControl } from "@/components/theme/theme-provider";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { RepaymentDestinationForm } from "@/components/settings/repayment-destination-form";
import { destinationTypeLabel } from "@/domain/repayment-destination";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import {
  createRepaymentDestinationAction,
  deleteRepaymentDestinationAction,
  reorderRepaymentDestinationsAction,
  updateRepaymentDestinationAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

type SettingsSearchParams = { saved?: string | string[]; error?: string | string[] };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<SettingsSearchParams> }) {
  const { user, ledger } = await getAuthenticatedLedger();
  const destinations = await ledger.listRepaymentDestinations();
  const query = searchParams ? await searchParams : {};
  return (
    <section className="app-page settings-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Account settings</p>
            <h1>Settings</h1>
            <p className="app-page__lede">Keep your account context and repayment details in one place.</p>
          </div>
        </header>
        {first(query.saved) === "1" ? <RecordConfirmation queryKey="saved" message="Settings saved." /> : null}
        {first(query.error) === "1" ? <p className="settings-page__error" role="alert">Unable to save that settings change.</p> : null}
        <section className="settings-page__section" aria-labelledby="settings-profile-heading">
          <div className="settings-page__section-heading"><div><p className="technical-label">Profile</p><h2 id="settings-profile-heading">Account context</h2></div></div>
          <dl className="settings-page__profile">
            <div><dt>Name</dt><dd>{user.name}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
          </dl>
        </section>
        <section className="settings-page__section ledger-section" id="repays-to" aria-labelledby="settings-repayment-heading">
          <div className="settings-page__section-heading"><div><p className="technical-label">Repays to</p><h2 id="settings-repayment-heading">Repayment destinations</h2><p>Choose where friends can repay you. Destinations marked as shared appear on active balance links.</p></div><span className="technical-label">{destinations.length} destinations</span></div>
          {destinations.length ? <div className="settings-page__destinations">{destinations.map((destination, index) => <article className="settings-page__destination" key={destination.id}>
            <div className="settings-page__destination-main"><div><h3>{destination.name}</h3><p className="settings-page__identifier">{destination.identifier}</p>{destination.accountName ? <p>{destination.accountName}</p> : null}{destination.note ? <p className="settings-page__note">{destination.note}</p> : null}</div><span className="technical-label">{destinationTypeLabel(destination.type)}</span></div>
            <div className="settings-page__destination-footer"><span>{destination.shareOnBalanceLinks ? "Shown on balance links" : "Not shown on balance links"}</span><div className="settings-page__destination-actions">
              <form action={reorderRepaymentDestinationsAction}><input type="hidden" name="movingId" value={destination.id} /><input type="hidden" name="direction" value="up" />{destinations.map((item) => <input key={item.id} type="hidden" name="destinationId" value={item.id} />)}<button className="text-link" type="submit" disabled={index === 0} aria-label={`Move ${destination.name} up`}>↑</button></form>
              <form action={reorderRepaymentDestinationsAction}><input type="hidden" name="movingId" value={destination.id} /><input type="hidden" name="direction" value="down" />{destinations.map((item) => <input key={item.id} type="hidden" name="destinationId" value={item.id} />)}<button className="text-link" type="submit" disabled={index === destinations.length - 1} aria-label={`Move ${destination.name} down`}>↓</button></form>
              <details><summary className="text-link">Edit</summary><RepaymentDestinationForm action={updateRepaymentDestinationAction.bind(null, destination.id)} mode="edit" idPrefix={`repayment-destination-${destination.id}`} initialValues={{ type: destination.type, name: destination.name, identifier: destination.identifier, accountName: destination.accountName ?? "", note: destination.note ?? "", shareOnBalanceLinks: destination.shareOnBalanceLinks }} /></details>
              <form action={deleteRepaymentDestinationAction.bind(null, destination.id)}><button className="text-link" type="submit">Delete</button></form>
            </div></div>
          </article>)}</div> : <p className="settings-page__empty">No repayment destinations yet.</p>}
          <div className="settings-page__add"><p className="technical-label">Add destination</p><RepaymentDestinationForm action={createRepaymentDestinationAction} /></div>
        </section>
        <section className="settings-page__section" aria-labelledby="settings-appearance-heading">
          <div className="settings-page__section-heading"><div><p className="technical-label">Appearance</p><h2 id="settings-appearance-heading">Theme</h2><p>The same theme preference is available from your account menu.</p></div></div>
          <ThemeControl />
        </section>
      </div>
    </section>
  );
}
