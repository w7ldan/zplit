"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { DebtorShareActionState } from "@/app/app/friends/[friendId]/share-actions";
import { buildFriendReminder, buildWhatsAppUrl } from "@/domain/friend-reminder";

type ShareAction = (
  previousState: DebtorShareActionState,
  formData: FormData,
) => Promise<DebtorShareActionState>;

type ShareStatus = {
  status: "none" | "active" | "expired" | "revoked";
  expiresAt: string | null;
};

const initialDebtorShareActionState: DebtorShareActionState = { error: "", link: null, statement: null, revoked: false };

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

function RefreshAfterAction({ revision }: { revision: number }) {
  const router = useRouter();
  useEffect(() => router.refresh(), [router, revision]);
  return null;
}

export function FriendShareLink({ status, phoneNumber, createAction, revokeAction }: { status: ShareStatus; phoneNumber: string | null; createAction: ShareAction; revokeAction: ShareAction }) {
  const [visibleResult, setVisibleResult] = useState<Pick<DebtorShareActionState, "link" | "statement"> | null>(null);
  const [currentStatus, setCurrentStatus] = useState(status.status);
  const [error, setError] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const [reminderCopied, setReminderCopied] = useState(false);
  const [, createFormAction] = useActionState(async (previousState: DebtorShareActionState, formData: FormData) => {
    setError("");
    const result = await createAction(previousState, formData);
    if (result.error) {
      setError(result.error);
      return result;
    }
    if (!result.link) return result;
    setVisibleResult({ link: result.link, statement: result.statement });
    setCurrentStatus("active");
    setCopied(false);
    setReminderCopied(false);
    setRefreshRevision((current) => current + 1);
    return result;
  }, initialDebtorShareActionState);
  const [, revokeFormAction] = useActionState(async (previousState: DebtorShareActionState, formData: FormData) => {
    setError("");
    const result = await revokeAction(previousState, formData);
    if (result.error) {
      setError(result.error);
      return result;
    }
    if (!result.revoked) return result;
    setVisibleResult(null);
    setCurrentStatus("revoked");
    setCopied(false);
    setReminderCopied(false);
    setRefreshRevision((current) => current + 1);
    return result;
  }, initialDebtorShareActionState);
  const shareUrl = visibleResult?.link && typeof window !== "undefined" ? `${window.location.origin}/share/${visibleResult.link.token}` : null;
  const currentExpiry = currentStatus === "active" || currentStatus === "expired" ? visibleResult?.link?.expiresAt ?? status.expiresAt : null;
  const expiry = formatExpiry(currentExpiry);
  const reminder = shareUrl && visibleResult?.statement ? buildFriendReminder({ ...visibleResult.statement, balanceUrl: shareUrl }) : null;
  const whatsappUrl = reminder ? buildWhatsAppUrl(phoneNumber, reminder) : null;

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

  async function copyReminder() {
    if (!reminder) return;
    try {
      await navigator.clipboard.writeText(reminder);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = reminder;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setReminderCopied(true);
  }

  function openWhatsApp() {
    if (whatsappUrl) window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="friend-share" aria-labelledby="friend-share-heading">
      {refreshRevision ? <RefreshAfterAction revision={refreshRevision} /> : null}
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
          <SubmitButton replace={currentStatus === "active" || currentStatus === "expired"} />
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
          {visibleResult?.link ? <p className="technical-label">Expires {formatExpiry(visibleResult.link.expiresAt)}</p> : null}
          {reminder ? (
            <div className="friend-share__reminder" aria-label="WhatsApp reminder">
              <p><strong>Reminder ready.</strong></p>
              <p className="friend-share__reminder-copy">{reminder}</p>
              <div className="friend-share__actions">
                <button className="action-link action-link--quiet" type="button" onClick={copyReminder}>{reminderCopied ? "Copied" : "Copy reminder"}</button>
                {whatsappUrl ? <button className="action-link action-link--quiet" type="button" onClick={openWhatsApp}>Open WhatsApp</button> : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
