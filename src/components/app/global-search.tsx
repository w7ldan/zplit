"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchGlobalRecords as defaultSearch } from "@/app/app/search/actions";
import type { GlobalSearchRecord } from "@/domain/ledger-repository";
import { formatRupiah } from "@/domain/rupiah";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { useUnsavedChangesNavigation } from "@/components/navigation/unsaved-changes";

export type GlobalSearchAction = (query: string) => Promise<GlobalSearchRecord[]>;

const kindLabels: Record<GlobalSearchRecord["kind"], string> = {
  friend: "Friends",
  trip: "Trips",
  outing: "Outings",
  expense: "Expenses",
  repayment: "Repayments",
};

export function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

function hrefFor(record: GlobalSearchRecord) {
  return `/app/${record.kind === "friend" ? "friends" : `${record.kind}s`}/${encodeURIComponent(record.id)}`;
}

function dateLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : <LocalDateTime iso={value} mode="date" />;
}

function recordDetail(record: GlobalSearchRecord) {
  const amount = record.amount === undefined ? "" : formatRupiah(record.amount);
  const date = dateLabel(record.date);
  if (record.kind === "friend") return record.detail || record.context || "";
  if (record.kind === "trip") return [record.detail, record.context].filter(Boolean).join(" · ");
  if (record.kind === "outing") return <>{date}{date && record.context ? " · " : ""}{record.context}</>;
  if (record.kind === "expense") return [amount, record.detail].filter(Boolean).join(" · ");
  return <>{amount}{amount && date ? " · " : ""}{date}</>;
}

export function GlobalSearch({ search = defaultSearch }: { search?: GlobalSearchAction }) {
  const router = useRouter();
  const unsavedChanges = useUnsavedChangesNavigation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchRecord[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);

  const closeSearch = useCallback(() => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    requestRef.current += 1;
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setLoading(false);
    setError("");
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, []);

  const openSearch = useCallback((opener?: HTMLElement | null) => {
    openerRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setOpen(true);
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (open || event.defaultPrevented || event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTextEditingTarget(event.target)) return;
      event.preventDefault();
      openSearch(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [open, openSearch]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("global-search-open");
    inputRef.current?.focus();
    return () => document.body.classList.remove("global-search-open");
  }, [open]);

  function scheduleSearch(value: string) {
    setQuery(value);
    setResults([]);
    setActiveIndex(-1);
    setError("");
    requestRef.current += 1;
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    if (!value.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    searchTimerRef.current = window.setTimeout(() => {
      const request = requestRef.current;
      searchTimerRef.current = null;
      void search(value).then((nextResults) => {
        if (request !== requestRef.current) return;
        setResults(nextResults.slice(0, 20));
        setActiveIndex(nextResults.length > 0 ? 0 : -1);
      }).catch(() => {
        if (request === requestRef.current) setError("Unable to search records.");
      }).finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
    }, 160);
  }

  function selectResult(record: GlobalSearchRecord) {
    if (unsavedChanges && !unsavedChanges.confirmDiscard()) return;
    const href = hrefFor(record);
    closeSearch();
    router.push(href);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => {
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        return results.length === 0 ? -1 : Math.max(0, Math.min(next, results.length - 1));
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex] ?? results[0];
      if (result) selectResult(result);
    }
  }

  return <>
    <button className="global-search-trigger" type="button" data-quick-search-trigger="true" onClick={(event) => openSearch(event.currentTarget)} aria-label="Search records">
      <span>Search</span><kbd>/</kbd>
    </button>
    {open ? <div className="global-search__backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSearch(); }}>
      <section className="global-search__dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title" aria-describedby="global-search-help" onMouseDown={(event) => event.stopPropagation()}>
        <div className="global-search__header">
          <div>
            <p className="technical-label">QUICK SEARCH</p>
            <h2 id="global-search-title">Find a record</h2>
            <p id="global-search-help">Search friends, trips, outings, expenses, and repayments.</p>
          </div>
          <button className="global-search__close" type="button" onClick={closeSearch} aria-label="Close search">Close</button>
        </div>
        <div className="global-search__input-wrap" role="search">
          <label className="sr-only" htmlFor="global-search-input">Search records</label>
          <input ref={inputRef} id="global-search-input" type="search" value={query} onChange={(event) => scheduleSearch(event.target.value)} onKeyDown={handleInputKeyDown} placeholder="Search records" autoComplete="off" aria-controls="global-search-results" aria-activedescendant={activeIndex >= 0 ? `global-search-result-${activeIndex}` : undefined} aria-busy={loading} />
        </div>
        <div id="global-search-results" className="global-search__results" role="listbox" aria-label="Search results" aria-live="polite">
          {query.trim() === "" ? <p className="global-search__prompt">Type to search your ledger.</p> : null}
          {loading ? <p className="global-search__prompt">Searching…</p> : null}
          {!loading && query.trim() !== "" && results.length === 0 && !error ? <p className="global-search__prompt">No matching records.</p> : null}
          {error ? <p className="global-search__error" role="alert">{error}</p> : null}
          {(["friend", "trip", "outing", "expense", "repayment"] as const).map((kind) => {
            const group = results.filter((record) => record.kind === kind);
            if (group.length === 0) return null;
            return <div className="global-search__group" key={kind} role="group" aria-label={kindLabels[kind]}>
              <p className="global-search__group-label">{kindLabels[kind]}</p>
              {group.map((record) => {
                const index = results.indexOf(record);
                const detail = recordDetail(record);
                return <button className={`global-search__result${index === activeIndex ? " global-search__result--active" : ""}`} type="button" role="option" aria-selected={index === activeIndex} id={`global-search-result-${index}`} key={`${record.kind}-${record.id}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectResult(record)}>
                  <span className="global-search__result-title">{record.title}</span>
                  {detail ? <span className="global-search__result-detail">{detail}</span> : null}
                </button>;
              })}
            </div>;
          })}
        </div>
      </section>
    </div> : null}
  </>;
}
