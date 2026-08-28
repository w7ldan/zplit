"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { normalizeText } from "@/domain/record-retrieval";
import { SearchableCombobox, type SearchableOptionAction } from "./searchable-combobox";

export type LiveRecordSelect = {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  search?: SearchableOptionAction;
  searchLabel?: string;
};

export type LiveRecordFiltersProps = {
  action: string;
  search: { name?: string; label: string; placeholder: string; value: string };
  selects?: LiveRecordSelect[];
  month?: { name?: string; label?: string; value: string };
  preservedParams?: Record<string, string | string[] | undefined>;
  mobileDisclosure?: { activeCount: number };
  clearHref?: string;
  resultStatus?: string;
};

const emptySelects: LiveRecordSelect[] = [];

function valuesOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

type DiscreteRecordFiltersProps = {
  selects: LiveRecordSelect[];
  month: LiveRecordFiltersProps["month"];
  selectValues: Record<string, string>;
  monthValue: string;
  onSelectChange: (name: string, value: string) => void;
  onMonthChange: (name: string, value: string) => void;
};

function DiscreteRecordFilters({ selects, month, selectValues, monthValue, onSelectChange, onMonthChange }: DiscreteRecordFiltersProps) {
  return <>
    {selects.map((select) => (
      <div className="live-record-filters__field" key={select.name}>
        <label id={"record-filter-" + select.name + "-label"} htmlFor={"record-filter-" + select.name}>{select.label}</label>
        {select.search ? <SearchableCombobox
          id={"record-filter-" + select.name}
          name={select.name}
          value={selectValues[select.name] ?? select.value}
          options={select.options.map((option) => ({ id: option.value, label: option.label }))}
          search={select.search}
          searchLabel={select.searchLabel ?? "Search " + select.label.toLowerCase() + "s"}
          labelId={"record-filter-" + select.name + "-label"}
          onValueChange={(option) => onSelectChange(select.name, option.id)}
        /> : <select
          id={"record-filter-" + select.name}
          name={select.name}
          value={selectValues[select.name] ?? select.value}
          onChange={(event) => onSelectChange(select.name, event.currentTarget.value)}
        >
          {select.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>}
      </div>
    ))}
    {month ? (
      <div className="live-record-filters__field">
        <label htmlFor={"record-filter-" + (month.name ?? "month")}>{month.label ?? "Month"}</label>
        <input
          id={"record-filter-" + (month.name ?? "month")}
          name={month.name ?? "month"}
          type="month"
          value={monthValue}
          onChange={(event) => onMonthChange(month.name ?? "month", event.currentTarget.value)}
        />
      </div>
    ) : null}
  </>;
}

function PreservedRecordParams({ params, controlledNames }: { params: Record<string, string | string[] | undefined>; controlledNames: Set<string> }) {
  return <>{Object.entries(params).flatMap(([name, value]) => controlledNames.has(name) ? [] : valuesOf(value).map((item, index) => <input key={name + "-" + index} type="hidden" name={name} value={item} />))}</>;
}

type LiveRecordSearchProps = {
  search: LiveRecordFiltersProps["search"];
  searchName: string;
  draft: string;
  onChange: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

function LiveRecordSearch({ search, searchName, draft, onChange, onCompositionStart, onCompositionEnd, onKeyDown }: LiveRecordSearchProps) {
  return <div className="live-record-filters__search">
    <label htmlFor={searchName + "-search"}>{search.label}</label>
    <input
      id={searchName + "-search"}
      name={searchName}
      type="search"
      value={draft}
      placeholder={search.placeholder}
      onChange={(event) => onChange(event.currentTarget.value)}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={(event) => onCompositionEnd(event.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  </div>;
}

function RecordFilterDisclosure({ mobileDisclosure, disclosureRef, discreteFilters }: { mobileDisclosure: LiveRecordFiltersProps["mobileDisclosure"]; disclosureRef: React.RefObject<HTMLDetailsElement | null>; discreteFilters: React.ReactNode }) {
  return mobileDisclosure ? <details ref={disclosureRef} className="live-record-filters__disclosure">
    <summary>Filters{mobileDisclosure.activeCount > 0 ? " (" + mobileDisclosure.activeCount + ")" : ""}</summary>
    {discreteFilters}
  </details> : discreteFilters;
}

function LiveRecordStatus({ isPending, resultStatus }: { isPending: boolean; resultStatus: string }) {
  return <p className="live-record-filters__status sr-only" role="status" aria-live="polite" aria-atomic="true">{isPending ? "Updating results…" : resultStatus}</p>;
}

export function LiveRecordFilters({ action, search, selects = emptySelects, month, preservedParams = {}, mobileDisclosure, clearHref, resultStatus = "" }: LiveRecordFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState(search.value);
  const initialSelectValues = Object.fromEntries(selects.map((select) => [select.name, select.value]));
  const [selectValues, setSelectValues] = useState(initialSelectValues);
  const [monthValue, setMonthValue] = useState(month?.value ?? "");
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const initialDisclosureOpenRef = useRef((mobileDisclosure?.activeCount ?? 0) > 0);
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
  const timezoneSyncRef = useRef<number | null>(null);
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
    if (disclosureRef.current) disclosureRef.current.open = initialDisclosureOpenRef.current;
  }, []);

  useEffect(() => {
    if (!month) return;
    const timezoneOffset = new Date().getTimezoneOffset();
    const url = new URL(window.location.href);
    if (url.searchParams.get("tz") === timezoneOffset.toString()) {
      timezoneSyncRef.current = timezoneOffset;
      return;
    }
    if (timezoneSyncRef.current === timezoneOffset) return;
    timezoneSyncRef.current = timezoneOffset;
    url.searchParams.set("tz", timezoneOffset.toString());
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }, [month, router]);

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

  function changeSelect(name: string, value: string) {
    editRevisionRef.current += 1;
    cancelDebounce();
    const nextSelectValues = { ...selectValuesRef.current, [name]: value };
    selectValuesRef.current = nextSelectValues;
    setSelectValues(nextSelectValues);
    navigate({ [name]: value || undefined, page: undefined });
  }

  function changeMonth(name: string, value: string) {
    editRevisionRef.current += 1;
    cancelDebounce();
    monthValueRef.current = value;
    setMonthValue(value);
    navigate({ [name]: value || undefined, page: undefined });
  }

  const discreteFilters = <DiscreteRecordFilters
    selects={selects}
    month={month}
    selectValues={selectValues}
    monthValue={monthValue}
    onSelectChange={changeSelect}
    onMonthChange={changeMonth}
  />;

  function handleSearchChange(value: string) {
    editRevisionRef.current += 1;
    draftRef.current = value;
    setDraft(value);
    cancelDebounce();
    if (!composingRef.current) scheduleSearch(value, editRevisionRef.current);
  }

  function handleCompositionStart() {
    editRevisionRef.current += 1;
    composingRef.current = true;
    cancelDebounce();
  }

  function handleCompositionEnd(value: string) {
    composingRef.current = false;
    scheduleSearch(value);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing && !composingRef.current) {
      event.preventDefault();
      editRevisionRef.current += 1;
      applySearch(event.currentTarget.value);
    }
  }

  return (
    <form className={"live-record-filters" + (mobileDisclosure ? " live-record-filters--mobile-disclosure" : "")} action={action} method="get" role="search" onSubmit={submit}>
      <PreservedRecordParams params={preservedParams} controlledNames={controlledNames} />
      <LiveRecordSearch search={search} searchName={searchName} draft={draft} onChange={handleSearchChange} onCompositionStart={handleCompositionStart} onCompositionEnd={handleCompositionEnd} onKeyDown={handleSearchKeyDown} />
      <RecordFilterDisclosure mobileDisclosure={mobileDisclosure} disclosureRef={disclosureRef} discreteFilters={discreteFilters} />
      {clearHref ? <a className="live-record-filters__clear" href={clearHref}>Clear filters</a> : null}
      <button className="sr-only" type="submit">Apply filters</button>
      <LiveRecordStatus isPending={isPending} resultStatus={resultStatus} />
    </form>
  );

}
