"use client";

import { useEffect, useId, useRef, useState } from "react";

const previewableMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function downloadHref(href: string) {
  return `${href}${href.includes("?") ? "&" : "?"}download=1`;
}

export function ReceiptPreview({ href, filename, mediaType }: { href: string; filename: string; mediaType: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const previewable = previewableMediaTypes.has(mediaType);

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
        }
      };
      document.addEventListener("keydown", closeOnEscape);
      return () => document.removeEventListener("keydown", closeOnEscape);
    }
    if (triggerRef.current?.isConnected) triggerRef.current.focus();
  }, [open]);

  if (!previewable) return <a className="text-link" href={href} target="_blank" rel="noreferrer">Open original</a>;

  return <>
    <button className="text-link expense-receipts__preview-trigger" type="button" onClick={(event) => { triggerRef.current = event.currentTarget; setOpen(true); }} aria-label={`Preview ${filename}`}>Preview</button>
    {open ? <div className="receipt-preview" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="receipt-preview__surface">
        <header className="receipt-preview__header">
          <h2 id={titleId} title={filename}>{filename}</h2>
          <button ref={closeRef} className="receipt-preview__close" type="button" onClick={() => setOpen(false)} aria-label="Close receipt preview">Close</button>
        </header>
        <div className="receipt-preview__body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={href} alt={filename} />
        </div>
        <footer className="receipt-preview__footer">
          <a className="action-link action-link--quiet" href={href} target="_blank" rel="noreferrer">Open original</a>
          <a className="action-link action-link--quiet" href={downloadHref(href)}>Download</a>
        </footer>
      </section>
    </div> : null}
  </>;
}
