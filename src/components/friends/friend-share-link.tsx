"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { DebtorShareActionState } from "@/app/app/friends/[friendId]/share-actions";
import type { EligibleDebtorShareReceiptGroup } from "@/domain/ledger-repository";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { buildFriendReminder, buildWhatsAppUrl } from "@/domain/friend-reminder";

type ShareAction = (previousState: DebtorShareActionState, formData: FormData) => Promise<DebtorShareActionState>;
type ShareStatus = { status: "none" | "active" | "expired" | "revoked"; expiresAt: string | null };
type LinkState = {
  status: ShareStatus["status"];
  link: { token: string; expiresAt: string } | null;
  expiresAt: string | null;
  reminder: string | null;
  selectedReceiptIds: string[];
  copied: boolean;
  reminderCopied: boolean;
  pendingOperation: "create" | "update" | "revoke" | null;
  error: string;
};

const emptyActionState: DebtorShareActionState = { error: "", link: null, statement: null, revoked: false, selectedReceiptIds: [] };

function SubmitButton({ label, pending, disabled }: { label: string; pending: string; disabled: boolean }) {
  return <button className="action-link action-link--primary" type="submit" disabled={disabled} aria-busy={disabled}>{disabled ? pending : label}</button>;
}

export function FriendShareLink({
  status,
  phoneNumber,
  createAction,
  revokeAction,
  updateSelectionAction,
  eligibleReceipts,
  selectedReceiptIds: initialSelectedReceiptIds,
}: {
  status: ShareStatus;
  phoneNumber: string | null;
  createAction: ShareAction;
  revokeAction: ShareAction;
  updateSelectionAction?: ShareAction;
  eligibleReceipts?: EligibleDebtorShareReceiptGroup[];
  selectedReceiptIds?: string[];
}) {
  const [state, setState] = useState<LinkState>({
    status: status.status,
    link: null,
    expiresAt: status.expiresAt,
    reminder: null,
    selectedReceiptIds: initialSelectedReceiptIds ?? [],
    copied: false,
    reminderCopied: false,
    pendingOperation: null,
    error: "",
  });
  const [, startTransition] = useTransition();
  const shareUrl = state.link && typeof window !== "undefined" ? `${window.location.origin}/share/${state.link.token}` : null;
  const expiry = state.status === "active" || state.status === "expired" ? state.expiresAt : null;
  const whatsappUrl = state.reminder ? buildWhatsAppUrl(phoneNumber, state.reminder) : null;

  function setReceiptSelected(receiptId: string, checked: boolean) {
    setState((current) => {
      const next = new Set(current.selectedReceiptIds);
      if (checked) next.add(receiptId); else next.delete(receiptId);
      return { ...current, selectedReceiptIds: [...next] };
    });
  }

  function run(operation: "create" | "update" | "revoke", action: ShareAction, formData: FormData) {
    setState((current) => ({ ...current, pendingOperation: operation, error: "" }));
    startTransition(() => {
      void action(emptyActionState, formData).then((result) => {
        if (result.error) {
          setState((current) => ({ ...current, pendingOperation: null, error: result.error }));
          return;
        }
        if (operation === "revoke") {
          setState((current) => ({ ...current, status: "revoked", link: null, expiresAt: null, reminder: null, selectedReceiptIds: [], copied: false, reminderCopied: false, pendingOperation: null, error: "" }));
          return;
        }
        if (operation === "update") {
          setState((current) => ({ ...current, selectedReceiptIds: result.selectedReceiptIds ?? [], pendingOperation: null, error: "" }));
          return;
        }
        const link = result.link;
        const reminder = link && result.statement && typeof window !== "undefined"
          ? buildFriendReminder({ ...result.statement, balanceUrl: `${window.location.origin}/share/${link.token}` })
          : null;
        setState((current) => ({ ...current, status: "active", link, expiresAt: link?.expiresAt ?? null, reminder, selectedReceiptIds: result.selectedReceiptIds ?? [], copied: false, reminderCopied: false, pendingOperation: null, error: "" }));
      }).catch(() => setState((current) => ({ ...current, pendingOperation: null, error: "Unable to update this balance link." })));
    });
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run("create", createAction, new FormData(event.currentTarget));
  }

  function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    for (const receiptId of state.selectedReceiptIds) formData.append("selectedReceiptId", receiptId);
    run("update", updateSelectionAction ?? createAction, formData);
  }

  function submitRevoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run("revoke", revokeAction, new FormData());
  }

  async function copyLink() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); } catch {
      const input = document.getElementById("friend-share-link") as HTMLInputElement | null;
      input?.select();
      document.execCommand("copy");
    }
    setState((current) => ({ ...current, copied: true }));
  }

  async function copyReminder() {
    if (!state.reminder) return;
    try { await navigator.clipboard.writeText(state.reminder); } catch {
      const textarea = document.createElement("textarea");
      textarea.value = state.reminder;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setState((current) => ({ ...current, reminderCopied: true }));
  }

  return (
    <section className="friend-share" aria-labelledby="friend-share-heading">
      <div className="friend-share__heading"><div><p className="technical-label">Share balance</p><h2 id="friend-share-heading">A private, read-only view</h2></div><span className="friend-share__state">{state.status === "none" ? "NONE" : state.status.toUpperCase()}</span></div>
      <p className="friend-share__description">This temporary link shows this friend’s balance and itemized shares. It cannot change the ledger.</p>
      {expiry ? <p className="friend-share__expiry">{state.status === "expired" ? "Expired" : "Expires"} <LocalDateTime iso={expiry} mode="date" /></p> : null}
      <form id="friend-share-create" onSubmit={submitCreate}>
        <fieldset className="friend-share__receipts">
          <legend>Receipts visible through this link</legend>
          <p>Only the receipts selected here can be opened through this balance link.</p>
          {eligibleReceipts?.length ? eligibleReceipts.map((group) => <div className="friend-share__receipt-group" key={group.expenseId}>
            <h3>{group.expenseDescription}</h3><p>{group.outingTitle}</p>
            {group.receipts.map((receipt) => <label className="friend-share__receipt" key={receipt.id}><input type="checkbox" name="selectedReceiptId" value={receipt.id} checked={state.selectedReceiptIds.includes(receipt.id)} onChange={(event) => setReceiptSelected(receipt.id, event.currentTarget.checked)} /><span><strong>{receipt.originalFilename}</strong><small><LocalDateTime iso={receipt.createdAt.toISOString()} mode="date" /> · {receipt.mediaType}</small></span></label>)}
          </div>) : <p>No eligible receipt images for this friend.</p>}
        </fieldset>
        <div className="friend-share__actions"><SubmitButton label={state.status === "active" || state.status === "expired" ? "Replace balance link" : "Create balance link"} pending="Working…" disabled={state.pendingOperation !== null} /></div>
      </form>
      {state.status === "active" ? <form onSubmit={submitUpdate} className="friend-share__actions"><SubmitButton label="Save receipt visibility" pending="Saving…" disabled={state.pendingOperation !== null} /></form> : null}
      {state.status === "active" ? <form onSubmit={submitRevoke} className="friend-share__actions"><SubmitButton label="Revoke link" pending="Revoking…" disabled={state.pendingOperation !== null} /></form> : null}
      {state.error ? <p className="friend-share__message" role="alert">{state.error}</p> : null}
      {shareUrl ? <section className="friend-share__result" aria-label="Balance link ready" role="status"><p><strong>Balance link ready.</strong> Save or send this link now.</p><label htmlFor="friend-share-link">Temporary balance link</label><div className="friend-share__copy-row"><input id="friend-share-link" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /><button className="action-link action-link--quiet" type="button" onClick={copyLink}>{state.copied ? "Copied" : "Copy"}</button></div><p className="friend-share__warning">Save or send this link now. Zplit cannot recover it later.</p><p className="technical-label">Expires <LocalDateTime iso={state.link?.expiresAt ?? ""} mode="date" /></p>{state.reminder ? <div className="friend-share__reminder" aria-label="WhatsApp reminder"><p><strong>Reminder ready.</strong></p><p className="friend-share__reminder-copy">{state.reminder}</p><div className="friend-share__actions"><button className="action-link action-link--quiet" type="button" onClick={copyReminder}>{state.reminderCopied ? "Copied" : "Copy reminder"}</button>{whatsappUrl ? <button className="action-link action-link--quiet" type="button" onClick={() => window.open(whatsappUrl, "_blank", "noopener,noreferrer")}>Open WhatsApp</button> : null}</div></div> : null}</section> : null}
    </section>
  );
}
