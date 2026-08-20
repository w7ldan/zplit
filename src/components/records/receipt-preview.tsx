"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

const previewableMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type InertElement = HTMLElement & { inert: boolean };

function focusableDescendants(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.closest("[hidden], [aria-hidden='true']"));
}

function downloadHref(href: string) {
  return `${href}${href.includes("?") ? "&" : "?"}download=1`;
}

export function ReceiptPreview({ href, filename, mediaType }: { href: string; filename: string; mediaType: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previewable = previewableMediaTypes.has(mediaType);

  useEffect(() => {
    if (!open) {
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) return;

    const background = [...document.body.children]
      .filter((element): element is HTMLElement => element !== dialog)
      .map((element) => {
        const inertElement = element as InertElement;
        const state = { element, inert: inertElement.inert === true, ariaHidden: element.getAttribute("aria-hidden") };
        inertElement.inert = true;
        element.setAttribute("aria-hidden", "true");
        return state;
      });
    const bodyOverflow = document.body.style.overflow;
    const documentOverflow = document.documentElement.style.overflow;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const focusables = focusableDescendants(dialog);
    (focusables[0] ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const currentFocusables = focusableDescendants(dialog);
      if (currentFocusables.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const active = document.activeElement;
      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];
      if (!dialog.contains(active) || (event.shiftKey ? active === first || active === dialog : active === last || active === dialog)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      for (const { element, inert, ariaHidden } of background) {
        (element as InertElement).inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = documentOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!previewable) return <a className="text-link" href={href} target="_blank" rel="noreferrer">Open original</a>;

  return <>
    <button className="text-link expense-receipts__preview-trigger" type="button" onClick={(event) => { triggerRef.current = event.currentTarget; setOpen(true); }} aria-label={`Preview ${filename}`}>Preview</button>
    {open ? createPortal(
      <div ref={dialogRef} className="receipt-preview" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="receipt-preview__surface">
          <header className="receipt-preview__header">
            <h2 id={titleId} title={filename}>{filename}</h2>
            <button className="receipt-preview__close" type="button" onClick={() => setOpen(false)} aria-label="Close receipt preview">Close</button>
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
      </div>,
      document.body,
    ) : null}
  </>;
}
