"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { DebtorShareActionState } from "@/app/app/friends/[friendId]/share-actions";

type ShareAction = (
  previousState: DebtorShareActionState,
  formData: FormData,
) => Promise<DebtorShareActionState>;

type ShareStatus = {
  status: "none" | "active" | "expired" | "revoked";
  expiresAt: string | null;
};

const initialDebtorShareActionState: DebtorShareActionState = { error: "", link: null, revoked: false };

function formatExpiry(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function SubmitButton({ replace }: { replace: boolean }) {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Working…" : replace ? "Replace balance link" : "Create balance link"}</button>;
}

function RevokeButton() {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--quiet" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Revoking…" : "Revoke link"}</button>;
}

export function FriendShareLink({ status, createAction, revokeAction }: { status: ShareStatus; createAction: ShareAction; revokeAction: ShareAction }) {
  const [createState, createFormAction] = useActionState(createAction, initialDebtorShareActionState);
  const [revokeState, revokeFormAction] = useActionState(revokeAction, initialDebtorShareActionState);
  const [copied, setCopied] = useState(false);
  const shareUrl = createState.link && typeof window !== "undefined" ? `${window.location.origin}/share/${createState.link.token}` : null;
  const currentStatus = createState.link ? "active" : revokeState.revoked ? "revoked" : status.status;
  const currentExpiry = createState.link?.expiresAt ?? status.expiresAt;
  const expiry = formatExpiry(currentExpiry);
  const error = createState.error || revokeState.error;

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const input = document.getElementById("friend-share-link") as HTMLInputElement | null;
      input?.select();
      document.execCommand("copy");
    }
    setCopied(true);
  }

  return (
    <section className="friend-share" aria-labelledby="friend-share-heading">
      <div className="friend-share__heading">
        <div>
          <p className="technical-label">Share balance</p>
          <h2 id="friend-share-heading">A private, read-only view</h2>
        </div>
        <span className="friend-share__state">{currentStatus === "none" ? "NONE" : currentStatus.toUpperCase()}</span>
      </div>
      <p className="friend-share__description">This temporary link shows this friend’s balance and itemized shares. It cannot change the ledger.</p>
      {expiry ? <p className="friend-share__expiry">{currentStatus === "expired" ? "Expired" : "Expires"} <time dateTime={currentExpiry ?? undefined}>{expiry}</time></p> : null}
      <div className="friend-share__actions">
        <form action={createFormAction}>
          <SubmitButton replace={currentStatus !== "none"} />
        </form>
        {currentStatus === "active" ? <form action={revokeFormAction}><RevokeButton /></form> : null}
      </div>
      {error ? <p className="friend-share__message" role="alert">{error}</p> : null}
      {shareUrl ? (
        <section className="friend-share__result" aria-label="Balance link ready" role="status">
          <p><strong>Balance link ready.</strong> Save or send this link now.</p>
          <label htmlFor="friend-share-link">Temporary balance link</label>
          <div className="friend-share__copy-row">
            <input id="friend-share-link" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
            <button className="action-link action-link--quiet" type="button" onClick={copyLink}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="friend-share__warning">Save or send this link now. Zplit cannot recover it later.</p>
          {createState.link ? <p className="technical-label">Expires {formatExpiry(createState.link.expiresAt)}</p> : null}
        </section>
      ) : null}
    </section>
  );
}
