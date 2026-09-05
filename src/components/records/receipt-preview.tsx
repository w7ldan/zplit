"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";

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

export function ReceiptPreview({ href, filename, mediaType, previewLabel = "receipt", triggerLabel = "Preview" }: { href: string; filename: string; mediaType: string; previewLabel?: string; triggerLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [entering, setEntering] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const enterFrameRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const previewable = previewableMediaTypes.has(mediaType);

  const finishClose = useCallback(() => {
    if (!closingRef.current) return;
    if (enterFrameRef.current !== null) {
      window.cancelAnimationFrame(enterFrameRef.current);
      enterFrameRef.current = null;
    }
    closingRef.current = false;
    setClosing(false);
    setEntering(false);
    setOpen(false);
  }, []);

  const closePreview = useCallback(() => {
    if (!open || closingRef.current) return;
    closingRef.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finishClose();
      return;
    }
    setClosing(true);
  }, [finishClose, open]);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current && triggerRef.current?.isConnected) triggerRef.current.focus();
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;

    enterFrameRef.current = window.requestAnimationFrame(() => {
      enterFrameRef.current = null;
      if (!closingRef.current) setEntering(false);
    });

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
        closePreview();
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
      if (enterFrameRef.current !== null) window.cancelAnimationFrame(enterFrameRef.current);
      enterFrameRef.current = null;
      for (const { element, inert, ariaHidden } of background) {
        (element as InertElement).inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = documentOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [closePreview, open]);

  if (!previewable) return <a className="text-link" href={href} target="_blank" rel="noreferrer">Open original</a>;

  return <>
    <button className="text-link expense-receipts__preview-trigger" type="button" onClick={(event) => { triggerRef.current = event.currentTarget; closingRef.current = false; setEntering(true); setClosing(false); setOpen(true); }} aria-label={triggerLabel === "Preview" ? `Preview ${filename}` : triggerLabel}>{triggerLabel}</button>
    {open ? createPortal(
      <div ref={dialogRef} className={`receipt-preview${entering ? " receipt-preview--entering" : ""}${closing ? " receipt-preview--closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(event) => { if (event.target === event.currentTarget) closePreview(); }}>
        <section className="receipt-preview__surface" onTransitionEnd={(event) => { if (closingRef.current && event.target === event.currentTarget && event.propertyName === "transform") finishClose(); }}>
          <header className="receipt-preview__header">
            <h2 id={titleId} title={filename}>{filename}</h2>
            <button className="receipt-preview__close" type="button" onClick={closePreview} aria-label={`Close ${previewLabel} preview`}>Close</button>
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
