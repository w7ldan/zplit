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
  const initialSelectValues = Object.fromEntries(selects.map((select) => [select.name, select.value]));
  const [selectValues, setSelectValues] = useState(initialSelectValues);
  const [monthValue, setMonthValue] = useState(month?.value ?? "");
  const draftRef = useRef(search.value);
  const selectValuesRef = useRef(initialSelectValues);
  const monthValueRef = useRef(month?.value ?? "");
  const debounceRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const mountedRef = useRef(true);
  const editRevisionRef = useRef(0);
  const navigationRevisionRef = useRef(0);
  const expectedUrlRef = useRef<string | null>(null);
  const observedUrlRef = useRef<string | null>(null);
  const ownNavigationUrlsRef = useRef(new Set<string>());
  const browserNavigationRef = useRef(false);
  const externalSignature = [search.value, ...selects.map((select) => select.value), month?.value ?? ""].join("\u0000");
  const controlledNames = new Set([search.name ?? "q", ...selects.map((select) => select.name), ...(month ? [month.name ?? "month"] : []), "page"]);
  const searchName = search.name ?? "q";

  function currentUrl() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function cancelDebounce() {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    const onPopState = () => { browserNavigationRef.current = true; };
    window.addEventListener("popstate", onPopState);
    return () => {
      mountedRef.current = false;
      cancelDebounce();
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    const url = currentUrl();
    const expectedUrl = expectedUrlRef.current;
    const expectedUrlChanged = observedUrlRef.current !== null && observedUrlRef.current !== url;
    const isOwnNavigationUrl = expectedUrl === url || ownNavigationUrlsRef.current.has(url);
    const browserNavigation = browserNavigationRef.current || (expectedUrlChanged && !isOwnNavigationUrl);
    browserNavigationRef.current = false;
    observedUrlRef.current = url;

    const expected = expectedUrl ? new URL(expectedUrl, window.location.href) : null;
    const propsMatchExpected = !expected || (
      (normalizeText(expected.searchParams.get(searchName)) ?? "") === (normalizeText(search.value) ?? "") &&
      selects.every((select) => (expected.searchParams.get(select.name) ?? "") === select.value) &&
      (!month || (expected.searchParams.get(month.name ?? "month") ?? "") === month.value)
    );
    if (!browserNavigation && (editRevisionRef.current > navigationRevisionRef.current || !propsMatchExpected)) return;

    if (browserNavigation) {
      cancelDebounce();
      expectedUrlRef.current = url;
      navigationRevisionRef.current = editRevisionRef.current;
    }
    const nextDraft = search.value;
    const nextSelectValues = Object.fromEntries(selects.map((select) => [select.name, select.value]));
    const nextMonthValue = month?.value ?? "";
    draftRef.current = nextDraft;
    selectValuesRef.current = nextSelectValues;
    monthValueRef.current = nextMonthValue;
    setDraft(nextDraft);
    setSelectValues(nextSelectValues);
    setMonthValue(nextMonthValue);
  }, [externalSignature, month, month?.name, month?.value, search.name, search.value, searchName, selects]);

  function navigate(changes: Record<string, string | undefined>) {
    const url = new URL(window.location.href);
    const destination = new URL(action, url);
    url.pathname = destination.pathname;
    const values: Record<string, string | undefined> = {
      [searchName]: normalizeText(draftRef.current),
      ...selectValuesRef.current,
      ...(month ? { [month.name ?? "month"]: monthValueRef.current } : {}),
    };
    const nextValues: Record<string, string | undefined> = { ...values, ...changes, page: undefined };
    const existingParams = [...url.searchParams.entries()];
    url.search = "";
    const emitted = new Set<string>();
    for (const [name, value] of existingParams) {
      if (controlledNames.has(name)) {
        if (emitted.has(name)) continue;
        emitted.add(name);
        if (nextValues[name]) url.searchParams.set(name, nextValues[name]);
      } else {
        url.searchParams.append(name, value);
      }
    }
    for (const name of controlledNames) if (!emitted.has(name) && nextValues[name]) url.searchParams.set(name, nextValues[name]);
    navigationRevisionRef.current = editRevisionRef.current;
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    expectedUrlRef.current = nextUrl;
    ownNavigationUrlsRef.current.add(nextUrl);
    if (nextUrl === currentUrl()) return;
    startTransition(() => router.replace(nextUrl, { scroll: false }));
  }

  function applySearch(value: string) {
    cancelDebounce();
    draftRef.current = value;
    setDraft(value);
    navigate({ [searchName]: normalizeText(value), page: undefined });
  }

  function scheduleSearch(value: string, revision = editRevisionRef.current) {
    cancelDebounce();
    if (!mountedRef.current || composingRef.current) return;
    const normalized = normalizeText(value);
    if (!normalized) {
      applySearch(value);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      if (mountedRef.current && !composingRef.current && editRevisionRef.current === revision) applySearch(value);
    }, 275);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    cancelDebounce();
    editRevisionRef.current += 1;
    const data = new FormData(event.currentTarget);
    const nextDraft = String(data.get(searchName) ?? "");
    const nextSelectValues = { ...selectValuesRef.current };
    const changes: Record<string, string | undefined> = { [searchName]: normalizeText(nextDraft), page: undefined };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    for (const select of selects) {
      nextSelectValues[select.name] = String(data.get(select.name) ?? "");
      changes[select.name] = nextSelectValues[select.name] || undefined;
    }
    selectValuesRef.current = nextSelectValues;
    setSelectValues(nextSelectValues);
    if (month) {
      const nextMonthValue = String(data.get(month.name ?? "month") ?? "");
      monthValueRef.current = nextMonthValue;
      setMonthValue(nextMonthValue);
      changes[month.name ?? "month"] = nextMonthValue || undefined;
    }
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
            const value = event.currentTarget.value;
            draftRef.current = value;
            setDraft(value);
            cancelDebounce();
            if (!composingRef.current) scheduleSearch(value, editRevisionRef.current);
          }}
          onCompositionStart={() => { editRevisionRef.current += 1; composingRef.current = true; cancelDebounce(); }}
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
              const nextSelectValues = { ...selectValuesRef.current, [select.name]: value };
              selectValuesRef.current = nextSelectValues;
              setSelectValues(nextSelectValues);
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
              monthValueRef.current = event.currentTarget.value;
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
