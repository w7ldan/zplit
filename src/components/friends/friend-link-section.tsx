"use client";

import { useActionState, useState } from "react";
import { SearchableCombobox, type SearchableOption, type SearchableOptionAction } from "@/components/records/searchable-combobox";
import type { FriendLinkActionState } from "@/app/app/friends/actions";

type FriendLinkStatus =
  | { status: "unlinked" }
  | { status: "pending"; requestId: string; target: { displayName: string; username: string } }
  | { status: "linked"; user: { displayName: string; username: string } };

type FriendLinkAction = (previousState: FriendLinkActionState, formData: FormData) => Promise<FriendLinkActionState>;
type CancelAction = () => Promise<void>;
type UnlinkAction = () => Promise<void>;

function identityParts(label: string) {
  const separator = label.indexOf(" · ");
  return separator === -1 ? { displayName: label, username: "" } : { displayName: label.slice(0, separator), username: label.slice(separator + 3) };
}

function SubmitButton() {
  return <button className="action-link action-link--primary" type="submit">Send request</button>;
}

export function FriendLinkSection({ status, search, action, cancelAction, unlinkAction }: { status: FriendLinkStatus; search: SearchableOptionAction; action: FriendLinkAction; cancelAction?: CancelAction; unlinkAction?: UnlinkAction }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SearchableOption | undefined>();
  const [state, formAction] = useActionState(action, { error: "" });

  if (status.status === "linked") {
    return <section className="friend-link" aria-labelledby="friend-link-heading"><div className="friend-link__heading"><p className="technical-label" id="friend-link-heading">Zplit friend</p><span className="friend-link__state">Active</span></div><p className="friend-link__identity"><strong>{status.user.displayName}</strong><span>@{status.user.username}</span></p>{unlinkAction ? <details className="friend-link__unlink"><summary className="text-link">Unlink</summary><div><p>Unlink @{status.user.username}?</p><p>This removes the Zplit account connection. Existing Friend balances and history remain unchanged.</p><form action={unlinkAction}><button className="action-link action-link--quiet" type="submit">Unlink</button></form></div></details> : null}</section>;
  }

  if (status.status === "pending") {
    return <section className="friend-link" aria-labelledby="friend-link-heading"><div className="friend-link__heading"><p className="technical-label" id="friend-link-heading">Zplit account</p><span className="friend-link__state">Awaiting confirmation</span></div><p className="friend-link__identity"><span>@{status.target.username}</span></p>{cancelAction ? <form action={cancelAction}><button className="text-link" type="submit">Cancel request</button></form> : null}</section>;
  }

  const selectedIdentity = selected ? identityParts(selected.label) : undefined;
  return <section className="friend-link" aria-labelledby="friend-link-heading">
    <div className="friend-link__heading"><p className="technical-label" id="friend-link-heading">Zplit account</p><span className="friend-link__state">Not linked</span></div>
    {!open ? <button className="text-link" type="button" aria-expanded="false" onClick={() => setOpen(true)}>Link Zplit account</button> : <form className="friend-link__disclosure" action={formAction}>
      <label id="friend-link-target-label" htmlFor="friend-link-target">Find by @username</label>
      <SearchableCombobox id="friend-link-target" name="targetUserId" options={[]} search={search} required placeholder="Choose a username" searchLabel="Search @username" labelId="friend-link-target-label" onValueChange={setSelected} />
      {selectedIdentity ? <div className="friend-link__confirm"><p className="technical-label">Link this Friend to</p><strong>{selectedIdentity.displayName}</strong><span>{selectedIdentity.username}</span></div> : null}
      <p className="friend-link__message" role={state.error ? "alert" : undefined}>{state.error || "Search uses @username only."}</p>
      <div className="friend-link__actions"><button className="action-link action-link--quiet" type="button" onClick={() => { setOpen(false); setSelected(undefined); }}>Cancel</button><SubmitButton /></div>
    </form>}
  </section>;
}
