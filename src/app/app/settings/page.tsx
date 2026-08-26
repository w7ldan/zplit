import { ThemeControl } from "@/components/theme/theme-provider";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { AvatarSettings } from "@/components/settings/avatar-settings";
import { RepaymentDestinationsSettings } from "@/components/settings/repayment-destinations-settings";
import { UsernameSettings } from "@/components/settings/username-settings";
import { getDatabase } from "@/db/client";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { getUserAvatarMetadata } from "@/server/user-avatars";
import {
  createRepaymentDestinationAction,
  deleteRepaymentDestinationAction,
  setRepaymentDestinationOrderAction,
  updateUsernameAction,
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
  const [destinations, avatar] = await Promise.all([ledger.listRepaymentDestinations(), getUserAvatarMetadata(getDatabase(), user.id)]);
  const query = searchParams ? await searchParams : {};
  const destinationEntries = destinations.map((destination) => ({
    id: destination.id,
    type: destination.type,
    name: destination.name,
    identifier: destination.identifier,
    accountName: destination.accountName,
    note: destination.note,
    shareOnBalanceLinks: destination.shareOnBalanceLinks,
    updateAction: updateRepaymentDestinationAction.bind(null, destination.id),
    deleteAction: deleteRepaymentDestinationAction.bind(null, destination.id),
  }));
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
          <div className="settings-page__profile">
            <div className="settings-page__profile-column settings-page__profile-column--identity">
              <p className="technical-label">Identity</p>
              <AvatarSettings userId={user.id} avatar={avatar}>
                <dl className="settings-page__identity-details-list">
                  <dt>Name</dt><dd className="settings-page__identity-name">{user.name}</dd>
                  <dt>Username</dt><dd><UsernameSettings username={user.username} action={updateUsernameAction} /></dd>
                </dl>
              </AvatarSettings>
            </div>
            <div className="settings-page__profile-column settings-page__profile-column--account">
              <div className="settings-page__profile-block">
                <p className="technical-label">Account</p>
                <dl className="settings-page__account-details"><div><dt>Sign-in email</dt><dd>{user.email}</dd></div></dl>
              </div>
              <div className="settings-page__profile-block settings-page__profile-block--appearance">
                <p className="technical-label">Appearance</p>
                <ThemeControl />
              </div>
            </div>
          </div>
        </section>
        <section className="settings-page__section ledger-section" id="repays-to" aria-labelledby="settings-repayment-heading">
          <div className="settings-page__section-heading"><div><p className="technical-label">Repays to</p><h2 id="settings-repayment-heading">Repayment destinations</h2><p>Choose where friends can repay you. Destinations marked as shared appear on active balance links.</p></div><span className="technical-label">{destinations.length} destinations</span></div>
          <RepaymentDestinationsSettings destinations={destinationEntries} createAction={createRepaymentDestinationAction} setOrderAction={setRepaymentDestinationOrderAction} />
        </section>
      </div>
    </section>
  );
}
