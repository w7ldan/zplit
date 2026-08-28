"use client";

import { FormEvent, useRef, useState } from "react";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { ReceiptPreview } from "@/components/records/receipt-preview";

export type ExpenseReceipt = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: string;
};

type ExpenseReceiptsProps = {
  expenseId: string;
  initialReceipts: ExpenseReceipt[];
  basePath?: string;
  canEdit?: boolean;
  readOnlyMessage?: string;
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function ReceiptDate({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? <>Unknown date</> : <LocalDateTime iso={date.toISOString()} mode="date" />;
}

export function ExpenseReceipts({ expenseId, initialReceipts, basePath = "/app/expenses", canEdit = true, readOnlyMessage }: ExpenseReceiptsProps) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [selectedFilename, setSelectedFilename] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const totalBytes = receipts.reduce((total, receipt) => total + receipt.byteSize, 0);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("receipt");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) {
      setError("Choose a receipt image.");
      setStatus("");
      return;
    }

    setUploading(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`${basePath}/${encodeURIComponent(expenseId)}/receipts`, {
        method: "POST",
        body: new FormData(form),
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to save this receipt.");
      setReceipts((current) => [...current, body.receipt as ExpenseReceipt]);
      form.reset();
      setSelectedFilename("");
      setStatus("Receipt uploaded.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to save this receipt.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(receiptId: string) {
    setRemovingId(receiptId);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`${basePath}/${encodeURIComponent(expenseId)}/receipts/${encodeURIComponent(receiptId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Unable to remove this receipt.");
      }
      setReceipts((current) => current.filter((receipt) => receipt.id !== receiptId));
      setPendingRemovalId(null);
      setStatus("Receipt removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove this receipt.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="expense-receipts" aria-labelledby="expense-receipts-heading">
      <p className="technical-label">RECEIPTS</p>
      <div className="expense-receipts__heading">
        <div>
          <h2 id="expense-receipts-heading">Receipts</h2>
          <p>JPEG, PNG, or WebP. Up to 5 MiB each, 5 receipts and 15 MiB total per expense.</p>
        </div>
        <span className="technical-label">{receipts.length}/5 · {formatBytes(totalBytes)}/15 MiB</span>
      </div>
      {!canEdit && readOnlyMessage ? <p className="expense-receipts__readonly">{readOnlyMessage}</p> : null}
      {canEdit ? <form className="expense-receipts__upload" onSubmit={upload}>
        <div className="expense-receipts__file-picker">
          <label className="action-link action-link--quiet" htmlFor="expense-receipt-file">{selectedFilename ? "Change" : "Choose receipt image"}</label>
          {selectedFilename ? <><span className="expense-receipts__filename">{selectedFilename}</span><button className="text-link" type="button" onClick={() => { if (fileInput.current) fileInput.current.value = ""; setSelectedFilename(""); }}>Clear</button></> : null}
        </div>
        <input ref={fileInput} className="expense-receipts__file-input" id="expense-receipt-file" name="receipt" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="expense-receipt-help expense-receipt-error" onChange={(event) => { setSelectedFilename(event.currentTarget.files?.[0]?.name ?? ""); setError(""); }} />
        <p className="expense-receipts__help" id="expense-receipt-help">The file signature is checked before it is stored.</p>
        <p className="expense-receipts__error" id="expense-receipt-error" role={error ? "alert" : undefined} aria-live="polite">{error || "\u00a0"}</p>
        <button className="action-link action-link--primary" type="submit" disabled={uploading || !selectedFilename} aria-busy={uploading}>{uploading ? "Uploading receipt…" : "Upload receipt"}</button>
      </form> : null}
      <p className="expense-receipts__status" role="status" aria-live="polite">{status || "\u00a0"}</p>
      {receipts.length > 0 ? (
        <div className="expense-receipts__list" aria-label="Expense receipts">
          {receipts.map((receipt) => {
            const confirming = pendingRemovalId === receipt.id;
            const removing = removingId === receipt.id;
            return (
              <div className="expense-receipts__row" key={receipt.id}>
                <div className="expense-receipts__details">
                  <strong>{receipt.originalFilename}</strong>
                  <span>{receipt.mediaType} · {formatBytes(receipt.byteSize)} · <ReceiptDate value={receipt.createdAt} /></span>
                </div>
                <div className="expense-receipts__actions">
                  <ReceiptPreview href={`${basePath}/${encodeURIComponent(expenseId)}/receipts/${encodeURIComponent(receipt.id)}`} filename={receipt.originalFilename} mediaType={receipt.mediaType} />
                  {canEdit && confirming ? (
                    <>
                      <button className="text-link expense-receipts__remove" type="button" onClick={() => remove(receipt.id)} disabled={removing} aria-busy={removing}>{removing ? "Removing…" : "Remove"}</button>
                      <button className="text-link" type="button" onClick={() => setPendingRemovalId(null)} disabled={removing}>Cancel</button>
                    </>
                  ) : canEdit ? <button className="text-link expense-receipts__remove" type="button" onClick={() => { setPendingRemovalId(receipt.id); setError(""); }}>Remove</button> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : <p className="expense-receipts__empty">No receipts attached.</p>}
    </section>
  );
}
