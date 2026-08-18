"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SearchableOption = { id: string; label: string; archived?: boolean };
export type SearchableOptionAction = (query: string, selectedId?: string) => Promise<SearchableOption[]>;

type SearchableComboboxProps = {
  id: string;
  name?: string;
  value?: string;
  options: SearchableOption[];
  search: SearchableOptionAction;
  required?: boolean;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  labelId: string;
  placeholder?: string;
  searchLabel?: string;
  onValueChange?: (option: SearchableOption) => void;
};

function mergeOptions(...groups: SearchableOption[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((option) => !seen.has(option.id) && seen.add(option.id));
}

function optionLabel(option: SearchableOption) {
  return option.archived ? `${option.label} (ARCHIVED)` : option.label;
}

export function SearchableCombobox({
  id,
  name,
  value,
  options: initialOptions,
  search,
  required = false,
  disabled = false,
  ariaInvalid = false,
  ariaDescribedBy,
  labelId,
  placeholder,
  searchLabel = "Search options",
  onValueChange,
}: SearchableComboboxProps) {
  const [enhanced, setEnhanced] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(value ?? (placeholder ? "" : initialOptions[0]?.id || ""));
  const [selectedOptionState, setSelectedOptionState] = useState<SearchableOption | undefined>(() => initialOptions.find((option) => option.id === (value ?? (placeholder ? "" : initialOptions[0]?.id || ""))));
  const [loadedOptions, setLoadedOptions] = useState<SearchableOption[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const listboxId = `${id}-listbox`;
  const currentSelectedId = value !== undefined ? value : selectedId;
  const allOptions = useMemo(() => mergeOptions(initialOptions, loadedOptions ?? [], selectedOptionState ? [selectedOptionState] : []), [initialOptions, loadedOptions, selectedOptionState]);
  const selectedOption = allOptions.find((option) => option.id === currentSelectedId);
  const options = useMemo(() => (loadedOptions ?? initialOptions).slice(0, 20), [initialOptions, loadedOptions]);
  const nativeOptions = useMemo(() => mergeOptions(selectedOption ? [selectedOption] : [], options).slice(0, 20), [options, selectedOption]);

  // Progressive enhancement toggles the native fallback after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setEnhanced(true), []);

  useEffect(() => () => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
  }, []);

  useEffect(() => {
    function closeOnOutsideInteraction(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideInteraction, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsideInteraction, true);
  }, []);

  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  const loadOptions = useCallback((nextQuery: string) => {
    const request = ++requestRef.current;
    setError("");
    setLoading(true);
    void search(nextQuery, currentSelectedId).then((result) => {
        if (request !== requestRef.current) return;
        const nextOptions = result.slice(0, 20);
        setLoadedOptions(nextOptions);
        const selectedIndex = nextOptions.findIndex((option) => option.id === currentSelectedId);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextOptions.length ? 0 : -1);
      }).catch(() => {
        if (request === requestRef.current) setError("Unable to load options.");
      }).finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, [currentSelectedId, search]);

  useEffect(() => {
    if (!currentSelectedId || allOptions.some((option) => option.id === currentSelectedId)) return;
    const timer = window.setTimeout(() => loadOptions(""), 0);
    return () => window.clearTimeout(timer);
  }, [allOptions, currentSelectedId, loadOptions]);

  function closeMenu(focusTrigger = false) {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function openMenu(direction: "down" | "up" = "down") {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setLoadedOptions(null);
    setError("");
    setActiveIndex(direction === "up" ? Math.max(options.length - 1, 0) : 0);
    loadOptions("");
  }

  function scheduleSearch(nextQuery: string) {
    setQuery(nextQuery);
    setOpen(true);
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      loadOptions(nextQuery);
    }, 120);
  }

  function choose(option: SearchableOption) {
    setSelectedId(option.id);
    setSelectedOptionState(option);
    setLoadedOptions((current) => mergeOptions([option], current ?? []));
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    onValueChange?.(option);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        setActiveIndex(event.key === "ArrowDown" ? 0 : Math.max(0, options.length - 1));
        return;
      }
      setActiveIndex((current) => Math.min(Math.max(current + (event.key === "ArrowDown" ? 1 : -1), 0), Math.max(options.length - 1, 0)));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!open || options.length === 0) return;
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const option = options[activeIndex] ?? options[0];
      if (option) {
        choose(option);
      }
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu(true);
    }
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu(event.key === "ArrowUp" ? "up" : "down");
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && !open) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu(true);
    }
  }

  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined;

  return (
    <div ref={rootRef} className="searchable-combobox" data-enhanced={enhanced ? "true" : undefined}>
      <select
        key={currentSelectedId}
        id={`${id}-native`}
        className="searchable-combobox__native"
        name={disabled || !name ? undefined : name}
        defaultValue={currentSelectedId}
        required={required}
        disabled={disabled}
        aria-labelledby={enhanced ? undefined : labelId}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => {
          const option = allOptions.find((candidate) => candidate.id === event.target.value);
          if (option) choose(option);
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {nativeOptions.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
      </select>
      {disabled && name ? <input type="hidden" name={name} value={currentSelectedId} /> : null}
      <div className="searchable-combobox__custom">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-labelledby={labelId}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={activeOption ? `${listboxId}-${activeOption.id}` : undefined}
          aria-required={required || undefined}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-busy={loading}
          onKeyDown={onTriggerKeyDown}
          onClick={() => { if (open) closeMenu(); else openMenu(); }}
        >
          <span className="searchable-combobox__trigger-label">{selectedOption ? optionLabel(selectedOption) : placeholder ?? ""}</span>
          <span className="searchable-combobox__trigger-icon" aria-hidden="true">▾</span>
        </button>
        {open ? <div className="searchable-combobox__panel">
          <div className="searchable-combobox__search">
            <label className="sr-only" htmlFor={`${id}-search`}>{searchLabel}</label>
            <input
              ref={searchInputRef}
              id={`${id}-search`}
              type="search"
              value={query}
              placeholder={searchLabel}
              autoComplete="off"
              aria-label={searchLabel}
              aria-controls={listboxId}
              aria-activedescendant={activeOption ? `${listboxId}-${activeOption.id}` : undefined}
              aria-busy={loading}
              onChange={(event) => scheduleSearch(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={(event) => {
                if (!event.relatedTarget || !rootRef.current?.contains(event.relatedTarget)) closeMenu();
              }}
            />
          </div>
          <ul id={listboxId} className="searchable-combobox__listbox" role="listbox" aria-label="Matching options">
            {options.map((option, index) => (
              <Fragment key={option.id}>
                {options.some((candidate) => !candidate.archived) && options.some((candidate) => candidate.archived) && (index === 0 || Boolean(options[index - 1]?.archived) !== Boolean(option.archived)) ? <li className="searchable-combobox__group" role="presentation">{option.archived ? "Archived friends" : "Active friends"}</li> : null}
                <li
                  id={`${listboxId}-${option.id}`}
                  role="option"
                  aria-selected={option.id === currentSelectedId}
                  className={index === activeIndex ? "searchable-combobox__option searchable-combobox__option--active" : "searchable-combobox__option"}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span>{optionLabel(option)}</span>
                </li>
              </Fragment>
            ))}
            {options.length === 0 ? <li className="searchable-combobox__empty" role="presentation">No matching options.</li> : null}
            {error ? <li className="searchable-combobox__error" role="alert">{error}</li> : null}
          </ul>
        </div> : null}
      </div>
    </div>
  );
}
