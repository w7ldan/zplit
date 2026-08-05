"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { normalizeText } from "@/domain/record-retrieval";

export type LiveRecordSelect = {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
};

export type LiveRecordFiltersProps = {
  action: string;
  search: { name?: string; label: string; placeholder: string; value: string };
  selects?: LiveRecordSelect[];
  month?: { name?: string; label?: string; value: string };
  preservedParams?: Record<string, string | string[] | undefined>;
};

const emptySelects: LiveRecordSelect[] = [];

function valuesOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

export function LiveRecordFilters({ action, search, selects = emptySelects, month, preservedParams = {} }: LiveRecordFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState(search.value);
  const [selectValues, setSelectValues] = useState(() => Object.fromEntries(selects.map((select) => [select.name, select.value])));
  const [monthValue, setMonthValue] = useState(month?.value ?? "");
  const debounceRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const mountedRef = useRef(true);
  const editRevisionRef = useRef(0);
  const navigationRevisionRef = useRef(0);
  const lastUrlRef = useRef<string | null>(null);
  const externalSignature = [search.value, ...selects.map((select) => select.value), month?.value ?? ""].join("\u0000");
  const controlledNames = new Set([search.name ?? "q", ...selects.map((select) => select.name), ...(month ? [month.name ?? "month"] : []), "page"]);

  function cancelDebounce() {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelDebounce();
    };
  }, []);

  useEffect(() => {
    cancelDebounce();
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const browserNavigation = lastUrlRef.current !== null && lastUrlRef.current !== currentUrl;
    if (editRevisionRef.current > navigationRevisionRef.current && !browserNavigation && document.activeElement === document.getElementById(`${search.name ?? "q"}-search`)) return;
    lastUrlRef.current = currentUrl;
    setDraft(search.value);
    setSelectValues(Object.fromEntries(selects.map((select) => [select.name, select.value])));
    setMonthValue(month?.value ?? "");
  }, [externalSignature, month?.value, search.name, search.value, selects]);

  function navigate(changes: Record<string, string | undefined>) {
    const url = new URL(window.location.href);
    const destination = new URL(action, url);
    url.pathname = destination.pathname;
    for (const [name, value] of Object.entries(changes)) {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    if (url.pathname + url.search + url.hash === window.location.pathname + window.location.search + window.location.hash) return;
    navigationRevisionRef.current = editRevisionRef.current;
    lastUrlRef.current = `${url.pathname}${url.search}${url.hash}`;
    startTransition(() => router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false }));
  }

  function applySearch(value: string) {
    cancelDebounce();
    const current = normalizeText(new URL(window.location.href).searchParams.get(search.name ?? "q"));
    if (current === normalizeText(value)) return;
    navigate({ [search.name ?? "q"]: normalizeText(value), page: undefined });
  }

  function scheduleSearch(value: string) {
    cancelDebounce();
    if (!mountedRef.current || composingRef.current) return;
    const normalized = normalizeText(value);
    if (!normalized) {
      applySearch(value);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      if (mountedRef.current && !composingRef.current) applySearch(value);
    }, 275);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    cancelDebounce();
    editRevisionRef.current += 1;
    const data = new FormData(event.currentTarget);
    const changes: Record<string, string | undefined> = { [search.name ?? "q"]: normalizeText(data.get(search.name ?? "q") ?? ""), page: undefined };
    for (const select of selects) changes[select.name] = String(data.get(select.name) ?? "") || undefined;
    if (month) changes[month.name ?? "month"] = String(data.get(month.name ?? "month") ?? "") || undefined;
    navigate(changes);
  }

  return (
    <form className="live-record-filters" action={action} method="get" role="search" onSubmit={submit}>
      {Object.entries(preservedParams).flatMap(([name, value]) => controlledNames.has(name) ? [] : valuesOf(value).map((item, index) => <input key={`${name}-${index}`} type="hidden" name={name} value={item} />))}
      <div className="live-record-filters__search">
        <label htmlFor={`${search.name ?? "q"}-search`}>{search.label}</label>
        <input
          id={`${search.name ?? "q"}-search`}
          name={search.name ?? "q"}
          type="search"
          value={draft}
          placeholder={search.placeholder}
          onChange={(event) => {
            editRevisionRef.current += 1;
            setDraft(event.currentTarget.value);
            cancelDebounce();
            if (!composingRef.current) scheduleSearch(event.currentTarget.value);
          }}
          onCompositionStart={() => { composingRef.current = true; cancelDebounce(); }}
          onCompositionEnd={(event) => { composingRef.current = false; scheduleSearch(event.currentTarget.value); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && !composingRef.current) {
              event.preventDefault();
              editRevisionRef.current += 1;
              applySearch(event.currentTarget.value);
            }
          }}
        />
      </div>
      {selects.map((select) => (
        <div className="live-record-filters__field" key={select.name}>
          <label htmlFor={`record-filter-${select.name}`}>{select.label}</label>
          <select
            id={`record-filter-${select.name}`}
            name={select.name}
            value={selectValues[select.name] ?? select.value}
            onChange={(event) => {
              editRevisionRef.current += 1;
              cancelDebounce();
              const value = event.currentTarget.value;
              setSelectValues((current) => ({ ...current, [select.name]: value }));
              navigate({ [select.name]: value || undefined, page: undefined });
            }}
          >
            {select.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      ))}
      {month ? (
        <div className="live-record-filters__field">
          <label htmlFor={`record-filter-${month.name ?? "month"}`}>{month.label ?? "Month"}</label>
          <input
            id={`record-filter-${month.name ?? "month"}`}
            name={month.name ?? "month"}
            type="month"
            value={monthValue}
            onChange={(event) => {
              editRevisionRef.current += 1;
              cancelDebounce();
              setMonthValue(event.currentTarget.value);
              navigate({ [month.name ?? "month"]: event.currentTarget.value || undefined, page: undefined });
            }}
          />
        </div>
      ) : null}
      <button className="sr-only" type="submit">Apply filters</button>
      {isPending ? <p className="live-record-filters__status" role="status" aria-live="polite">Updating results…</p> : null}
    </form>
  );
}
