"use client";

import { FormEvent, useRef, useState } from "react";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { ReceiptPreview } from "@/components/records/receipt-preview";

export type RepaymentPaymentProof = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date | string;
};

type RepaymentPaymentProofProps = {
  repaymentId: string;
  initialPaymentProof: RepaymentPaymentProof | null;
  basePath?: string;
  canEdit?: boolean;
  description?: string;
  readOnlyMessage?: string;
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function ProofDate({ value }: { value: Date | string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? <>Unknown date</> : <LocalDateTime iso={date.toISOString()} mode="date" />;
}

function ReadOnlyMessage({ canEdit, message }: { canEdit: boolean; message?: string }) {
  if (canEdit || !message) return null;
  return <p className="expense-receipts__readonly">{message}</p>;
}

export function RepaymentPaymentProof({ repaymentId, initialPaymentProof, basePath = "/app/repayments", canEdit = true, description = "Private to you. JPEG, PNG, or WebP, up to 5 MiB.", readOnlyMessage }: RepaymentPaymentProofProps) {
  const [paymentProof, setPaymentProof] = useState(initialPaymentProof);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("paymentProof");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) {
      setError("Choose a payment proof image.");
      setStatus("");
      return;
    }

    const replacing = paymentProof !== null;
    setUploading(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`${basePath}/${encodeURIComponent(repaymentId)}/payment-proof`, {
        method: replacing ? "PUT" : "POST",
        body: new FormData(form),
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : replacing ? "Unable to replace this payment proof." : "Unable to save this payment proof.");
      setPaymentProof(body.paymentProof as RepaymentPaymentProof);
      form.reset();
      setSelectedFilename("");
      setStatus(replacing ? "Payment proof replaced." : "Payment proof uploaded.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to save this payment proof.");
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!paymentProof) return;
    setRemoving(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`${basePath}/${encodeURIComponent(repaymentId)}/payment-proof/${encodeURIComponent(paymentProof.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Unable to remove this payment proof.");
      }
      setPaymentProof(null);
      setPendingRemoval(false);
      setStatus("Payment proof removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove this payment proof.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="expense-receipts payment-proof" aria-labelledby="repayment-payment-proof-heading">
      <p className="technical-label">PAYMENT PROOF</p>
      <div className="expense-receipts__heading">
        <div>
          <h2 id="repayment-payment-proof-heading">Payment proof</h2>
          <p>{description}</p>
        </div>
      </div>
      <ReadOnlyMessage canEdit={canEdit} message={readOnlyMessage} />
      {canEdit ? <form className="expense-receipts__upload" onSubmit={upload}>
        <div className="expense-receipts__file-picker">
          <label className="action-link action-link--quiet" htmlFor="repayment-payment-proof-file">{selectedFilename ? "Change" : "Choose payment proof image"}</label>
          {selectedFilename ? <><span className="expense-receipts__filename">{selectedFilename}</span><button className="text-link" type="button" onClick={() => { if (fileInput.current) fileInput.current.value = ""; setSelectedFilename(""); }}>Clear</button></> : null}
        </div>
        <input ref={fileInput} className="expense-receipts__file-input" id="repayment-payment-proof-file" name="paymentProof" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="repayment-payment-proof-help repayment-payment-proof-error" onChange={(event) => { setSelectedFilename(event.currentTarget.files?.[0]?.name ?? ""); setError(""); }} />
        <p className="expense-receipts__help" id="repayment-payment-proof-help">The file signature is checked before it is stored.</p>
        <p className="expense-receipts__error" id="repayment-payment-proof-error" role={error ? "alert" : undefined} aria-live="polite">{error || "\u00a0"}</p>
        <button className="action-link action-link--primary" type="submit" disabled={uploading || !selectedFilename} aria-busy={uploading}>{uploading ? paymentProof ? "Replacing payment proof…" : "Uploading payment proof…" : paymentProof ? "Replace payment proof" : "Add payment proof"}</button>
      </form> : null}
      <p className="expense-receipts__status" role="status" aria-live="polite">{status || "\u00a0"}</p>
      {paymentProof ? (
        <div className="expense-receipts__list" aria-label="Repayment payment proof">
          <div className="expense-receipts__row">
            <div className="expense-receipts__details">
              <strong>{paymentProof.originalFilename}</strong>
              <span>{paymentProof.mediaType} · {formatBytes(paymentProof.byteSize)} · <ProofDate value={paymentProof.createdAt} /></span>
            </div>
            <div className="expense-receipts__actions">
              <ReceiptPreview
                href={`${basePath}/${encodeURIComponent(repaymentId)}/payment-proof/${encodeURIComponent(paymentProof.id)}`}
                filename={paymentProof.originalFilename}
                mediaType={paymentProof.mediaType}
                previewLabel="payment proof"
              />
              {canEdit && pendingRemoval ? (
                <>
                  <button className="text-link expense-receipts__remove" type="button" onClick={remove} disabled={removing} aria-busy={removing}>{removing ? "Removing…" : "Remove"}</button>
                  <button className="text-link" type="button" onClick={() => setPendingRemoval(false)} disabled={removing}>Cancel</button>
                </>
              ) : canEdit ? <button className="text-link expense-receipts__remove" type="button" onClick={() => { setPendingRemoval(true); setError(""); }}>Remove</button> : null}
            </div>
          </div>
        </div>
      ) : <p className="expense-receipts__empty">No payment proof attached.</p>}
    </section>
  );
}
