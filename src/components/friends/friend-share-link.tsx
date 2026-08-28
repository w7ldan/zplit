"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import type { DebtorShareActionState } from "@/app/app/friends/[friendId]/share-actions";
import type { EligibleDebtorShareReceiptGroup } from "@/domain/ledger-repository";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { buildFriendReminder, buildWhatsAppUrl } from "@/domain/friend-reminder";
import { BalanceLinkQr } from "./balance-link-qr";
import { copyLabel, copyText, type CopyStatus } from "@/components/feedback/copy-text";

type ShareAction = (previousState: DebtorShareActionState, formData: FormData) => Promise<DebtorShareActionState>;
type ShareStatus = { status: "none" | "active" | "expired" | "revoked"; expiresAt: string | null };
type ShareLink = { token: string; expiresAt: string };
type LinkRollback = { link: ShareLink; expiresAt: string | null; reminder: string | null };
type LinkState = {
  status: ShareStatus["status"];
  link: ShareLink | null;
  rollback: LinkRollback | null;
  expiresAt: string | null;
  reminder: string | null;
  selectedReceiptIds: string[];
  copyStatus: CopyStatus;
  reminderCopyStatus: CopyStatus;
  pendingOperation: "create" | "update" | "revoke" | null;
  error: string;
};

const emptyActionState: DebtorShareActionState = { error: "", link: null, statement: null, revoked: false, selectedReceiptIds: [] };

function linkViewState(state: LinkState, phoneNumber: string | null) {
  const shareUrl = state.link && typeof window !== "undefined" ? window.location.origin + "/share/" + state.link.token : null;
  return {
    usableShareUrl: state.pendingOperation === "create" ? null : shareUrl,
    expiry: state.status === "active" || state.status === "expired" ? state.expiresAt : null,
    whatsappUrl: state.reminder ? buildWhatsAppUrl(phoneNumber, state.reminder) : null,
  };
}

function SubmitButton({ label, pending, disabled }: { label: string; pending: string; disabled: boolean }) {
  return <button className="action-link action-link--primary" type="submit" disabled={disabled} aria-busy={disabled}>{disabled ? pending : label}</button>;
}

function FriendShareReceiptSelector({ eligibleReceipts, selectedReceiptIds, pending, createLabel, onSubmit, onReceiptChange }: {
  eligibleReceipts?: EligibleDebtorShareReceiptGroup[];
  selectedReceiptIds: string[];
  pending: boolean;
  createLabel: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReceiptChange: (receiptId: string, checked: boolean) => void;
}) {
  return <form id="friend-share-create" onSubmit={onSubmit}>
    <fieldset className="friend-share__receipts">
      <legend>Receipts visible through this link</legend>
      <p>Only the receipts selected here can be opened through this balance link.</p>
      {eligibleReceipts?.length ? eligibleReceipts.map((group) => <div className="friend-share__receipt-group" key={group.expenseId}>
        <h3>{group.expenseDescription}</h3><p>{group.outingTitle}</p>
        {group.receipts.map((receipt) => <label className="friend-share__receipt" key={receipt.id}><input type="checkbox" name="selectedReceiptId" value={receipt.id} checked={selectedReceiptIds.includes(receipt.id)} onChange={(event) => onReceiptChange(receipt.id, event.currentTarget.checked)} /><span><strong>{receipt.originalFilename}</strong><small><LocalDateTime iso={receipt.createdAt.toISOString()} mode="date" /> · {receipt.mediaType}</small></span></label>)}
      </div>) : <p>No eligible receipt images for this friend.</p>}
    </fieldset>
    <div className="friend-share__actions"><SubmitButton label={createLabel} pending="Working…" disabled={pending} /></div>
  </form>;
}

function FriendShareResult({ state, usableShareUrl, whatsappUrl, qrVisible, showQrButton, onCopyLink, onCopyReminder, onOpenQr, onCloseQr }: {
  state: LinkState;
  usableShareUrl: string | null;
  whatsappUrl: string | null;
  qrVisible: boolean;
  showQrButton: React.RefObject<HTMLButtonElement | null>;
  onCopyLink: () => void;
  onCopyReminder: () => void;
  onOpenQr: () => void;
  onCloseQr: () => void;
}) {
  if (!usableShareUrl || state.status !== "active") return null;
  return <section className="friend-share__result" aria-label="Balance link ready" role="status"><p><strong>Balance link ready.</strong> Save or send this link now.</p><label htmlFor="friend-share-link">Temporary balance link</label><div className="friend-share__copy-row"><input id="friend-share-link" readOnly value={usableShareUrl} onFocus={(event) => event.currentTarget.select()} /></div><div className="friend-share__actions" aria-label="Balance link actions"><button className="action-link action-link--primary" type="button" onClick={onCopyLink} aria-label={copyLabel(state.copyStatus, "Copy balance link")}>{copyLabel(state.copyStatus, "Copy balance link")}</button><button className="action-link action-link--quiet" type="button" onClick={() => window.open(usableShareUrl, "_blank", "noopener,noreferrer")} aria-label="Preview as friend (opens in a new tab)">Preview as friend</button><button ref={showQrButton} className="action-link action-link--quiet" type="button" onClick={onOpenQr} aria-expanded={qrVisible} aria-controls="friend-share-qr">Show QR</button></div>{qrVisible ? <BalanceLinkQr url={usableShareUrl} onClose={onCloseQr} /> : null}<p className="friend-share__warning">Save or send this link now. Zplit cannot recover it later.</p><p className="technical-label">Expires <LocalDateTime iso={state.link?.expiresAt ?? ""} mode="date" /></p>{state.reminder ? <div className="friend-share__reminder" aria-label="WhatsApp reminder"><p><strong>Reminder ready.</strong></p><p className="friend-share__reminder-copy">{state.reminder}</p><div className="friend-share__actions"><button className="action-link action-link--quiet" type="button" onClick={onCopyReminder}>{copyLabel(state.reminderCopyStatus, "Copy reminder")}</button>{whatsappUrl ? <button className="action-link action-link--quiet" type="button" onClick={() => window.open(whatsappUrl, "_blank", "noopener,noreferrer")}>Open WhatsApp</button> : null}</div></div> : null}</section>;
}

export function FriendShareLink({
  status,
  phoneNumber,
  createAction,
  revokeAction,
  updateSelectionAction,
  eligibleReceipts,
  selectedReceiptIds: initialSelectedReceiptIds,
  sharedDestinationNames,
}: {
  status: ShareStatus;
  phoneNumber: string | null;
  createAction: ShareAction;
  revokeAction: ShareAction;
  updateSelectionAction?: ShareAction;
  eligibleReceipts?: EligibleDebtorShareReceiptGroup[];
  selectedReceiptIds?: string[];
  sharedDestinationNames?: string[];
}) {
  const [state, setState] = useState<LinkState>({
    status: status.status,
    link: null,
    rollback: null,
    expiresAt: status.expiresAt,
    reminder: null,
    selectedReceiptIds: initialSelectedReceiptIds ?? [],
    copyStatus: "idle",
    reminderCopyStatus: "idle",
    pendingOperation: null,
    error: "",
  });
  const [, startTransition] = useTransition();
  const feedbackTimer = useRef<number | null>(null);
  const temporaryCopyTarget = useRef<HTMLTextAreaElement | null>(null);
  const showQrButton = useRef<HTMLButtonElement>(null);
  const qrWasVisible = useRef(false);
  const [qrVisible, setQrVisible] = useState(false);
  const { usableShareUrl, expiry, whatsappUrl } = linkViewState(state, phoneNumber);

  function clearCopyFeedback() {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = null;
    temporaryCopyTarget.current?.remove();
    temporaryCopyTarget.current = null;
  }

  function scheduleCopyFeedbackReset() {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => {
      temporaryCopyTarget.current?.remove();
      temporaryCopyTarget.current = null;
      setState((current) => ({ ...current, copyStatus: "idle", reminderCopyStatus: "idle" }));
    }, 1800);
  }

  useEffect(() => () => {
    clearCopyFeedback();
  }, []);

  useEffect(() => {
    if (!qrVisible) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setQrVisible(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [qrVisible]);

  useEffect(() => {
    if (!qrVisible && qrWasVisible.current) showQrButton.current?.focus();
    qrWasVisible.current = qrVisible;
  }, [qrVisible]);

  function setReceiptSelected(receiptId: string, checked: boolean) {
    setState((current) => {
      const next = new Set(current.selectedReceiptIds);
      if (checked) next.add(receiptId); else next.delete(receiptId);
      return { ...current, selectedReceiptIds: [...next] };
    });
  }

  function run(operation: "create" | "update" | "revoke", action: ShareAction, formData: FormData) {
    if (operation === "create") setQrVisible(false);
    setState((current) => {
      const rollback = operation === "create" && current.link
        ? { link: current.link, expiresAt: current.expiresAt, reminder: current.reminder }
        : null;
      return {
        ...current,
        link: rollback ? null : current.link,
        rollback,
        expiresAt: rollback ? null : current.expiresAt,
        reminder: rollback ? null : current.reminder,
        copyStatus: rollback ? "idle" : current.copyStatus,
        reminderCopyStatus: rollback ? "idle" : current.reminderCopyStatus,
        pendingOperation: operation,
        error: "",
      };
    });
    startTransition(() => {
      void action(emptyActionState, formData).then((result) => {
        if (result.error) {
          setState((current) => {
            const rollback = operation === "create" && result.replacementCommitted !== true ? current.rollback : null;
            if (operation === "create") {
              return {
                ...current,
                link: rollback?.link ?? null,
                rollback: null,
                expiresAt: rollback?.expiresAt ?? null,
                reminder: rollback?.reminder ?? null,
                copyStatus: "idle",
                reminderCopyStatus: "idle",
                pendingOperation: null,
                error: result.error,
              };
            }
            return { ...current, pendingOperation: null, error: result.error };
          });
          return;
        }
        if (operation === "revoke") {
          setQrVisible(false);
          setState((current) => ({ ...current, status: "revoked", link: null, rollback: null, expiresAt: null, reminder: null, selectedReceiptIds: [], copyStatus: "idle", reminderCopyStatus: "idle", pendingOperation: null, error: "" }));
          return;
        }
        if (operation === "update") {
          setState((current) => ({ ...current, selectedReceiptIds: result.selectedReceiptIds ?? [], pendingOperation: null, error: "" }));
          return;
        }
        const link = result.link;
        setQrVisible(false);
        const reminder = link && result.statement && typeof window !== "undefined"
          ? buildFriendReminder({ ...result.statement, balanceUrl: `${window.location.origin}/share/${link.token}` })
          : null;
        setState((current) => ({ ...current, status: "active", link, rollback: null, expiresAt: link?.expiresAt ?? null, reminder, selectedReceiptIds: result.selectedReceiptIds ?? [], copyStatus: "idle", reminderCopyStatus: "idle", pendingOperation: null, error: "" }));
      }).catch(() => setState((current) => operation === "create"
        ? { ...current, link: null, rollback: null, expiresAt: null, reminder: null, copyStatus: "idle", reminderCopyStatus: "idle", pendingOperation: null, error: "Unable to update this balance link." }
        : { ...current, pendingOperation: null, error: "Unable to update this balance link." }));
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
    if (!usableShareUrl) return;
    clearCopyFeedback();
    const input = document.getElementById("friend-share-link") as HTMLInputElement | null;
    const status = await copyText(usableShareUrl, input);
    setState((current) => ({ ...current, copyStatus: status }));
    scheduleCopyFeedbackReset();
  }

  async function copyReminder() {
    if (!state.reminder) return;
    clearCopyFeedback();
    const textarea = document.createElement("textarea");
    textarea.value = state.reminder;
    textarea.readOnly = true;
    textarea.setAttribute("aria-label", "Reminder text copy fallback");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    const status = await copyText(state.reminder, textarea);
    if (status === "selected") temporaryCopyTarget.current = textarea;
    else textarea.remove();
    setState((current) => ({ ...current, reminderCopyStatus: status }));
    scheduleCopyFeedbackReset();
  }

  const destinationCount = sharedDestinationNames?.length ?? 0;
  const createLabel = state.status === "active" || state.status === "expired" ? "Replace balance link" : "Create balance link";
  return (
    <section className="friend-share" aria-labelledby="friend-share-heading">
      <div className="friend-share__heading"><div><p className="technical-label">Share balance</p><h2 id="friend-share-heading">A private, read-only view</h2></div><span className="friend-share__state">{state.status === "none" ? "NONE" : state.status.toUpperCase()}</span></div>
      <p className="friend-share__description">This temporary link shows this friend’s balance and itemized shares. It cannot change the ledger.</p>
      <section className="friend-share__destinations" aria-labelledby="friend-share-destinations-heading">
        <div><p className="technical-label">Repays to</p><h3 id="friend-share-destinations-heading">{destinationCount ? destinationCount + " repayment destination" + (destinationCount === 1 ? "" : "s") + " will be shown" : "No repayment destination will be shown."}</h3>{destinationCount ? <p>{sharedDestinationNames?.join(" · ")}</p> : null}</div>
        <a className="text-link" href="/app/settings#repays-to">{destinationCount ? "Manage repayment details" : "Add repayment details"}</a>
      </section>
      {expiry ? <p className="friend-share__expiry">{state.status === "expired" ? "Expired" : "Expires"} <LocalDateTime iso={expiry} mode="date" /></p> : null}
      <FriendShareReceiptSelector eligibleReceipts={eligibleReceipts} selectedReceiptIds={state.selectedReceiptIds} pending={state.pendingOperation !== null} createLabel={createLabel} onSubmit={submitCreate} onReceiptChange={setReceiptSelected} />
      {state.status === "active" ? <form onSubmit={submitUpdate} className="friend-share__actions"><SubmitButton label="Save receipt visibility" pending="Saving…" disabled={state.pendingOperation !== null} /></form> : null}
      {state.status === "active" ? <form onSubmit={submitRevoke} className="friend-share__actions"><SubmitButton label="Revoke link" pending="Revoking…" disabled={state.pendingOperation !== null} /></form> : null}
      {state.error ? <p className="friend-share__message" role="alert">{state.error}</p> : null}
      {state.status === "active" && state.pendingOperation === null && !usableShareUrl ? <p className="friend-share__description">This existing link is active, but Zplit cannot recover its URL after this page loads. Replace balance link to issue a new URL; replacing it revokes the current link.</p> : null}
      <FriendShareResult state={state} usableShareUrl={usableShareUrl} whatsappUrl={whatsappUrl} qrVisible={qrVisible} showQrButton={showQrButton} onCopyLink={copyLink} onCopyReminder={copyReminder} onOpenQr={() => setQrVisible(true)} onCloseQr={() => setQrVisible(false)} />
    </section>
  );

}
