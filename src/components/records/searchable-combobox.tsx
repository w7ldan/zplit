"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mergeSearchableOptions, useSearchableOptions } from "./use-searchable-options";
import type { SearchableOption, SearchableOptionAction } from "./use-searchable-options";
import { useSearchableComboboxPlacement } from "./searchable-combobox-placement";
export { calculateSearchableComboboxPlacement } from "./searchable-combobox-placement";
export type { SearchableComboboxPlacement } from "./searchable-combobox-placement";

export type { SearchableOption, SearchableOptionAction } from "./use-searchable-options";

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
  multiSelect?: boolean;
  selectedIds?: string[];
  onValuesChange?: (options: SearchableOption[]) => void;
};

function optionLabel(option: SearchableOption) {
  return option.archived ? `${option.label} (ARCHIVED)` : option.label;
}

function optionGroup(options: SearchableOption[], option: SearchableOption) {
  if (option.group) return option.group;
  if (!options.some((candidate) => !candidate.archived) || !options.some((candidate) => candidate.archived)) return undefined;
  return option.archived ? "Archived friends" : "Active friends";
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
  multiSelect = false,
  selectedIds = [],
  onValuesChange,
}: SearchableComboboxProps) {
  const [enhanced, setEnhanced] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(value ?? (placeholder ? "" : initialOptions[0]?.id || ""));
  const [selectedOptionState, setSelectedOptionState] = useState<SearchableOption | undefined>(() => initialOptions.find((option) => option.id === (value ?? (placeholder ? "" : initialOptions[0]?.id || ""))));
  const [pendingIds, setPendingIds] = useState(() => new Set(selectedIds));
  const [pendingOptions, setPendingOptions] = useState<SearchableOption[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedIdsRef = useRef(selectedIds);
  const listboxId = `${id}-listbox`;
  const currentSelectedId = value !== undefined ? value : selectedId;
  const onOptionsLoaded = useCallback((nextOptions: SearchableOption[]) => {
    const selectedIndex = nextOptions.findIndex((option) => option.id === currentSelectedId);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextOptions.length ? 0 : -1);
  }, [currentSelectedId]);
  const {
    allOptions,
    options,
    selectedOption,
    query,
    error,
    loading,
    loadOptions,
    scheduleSearch,
    resetSearch,
    resetOptions,
    rememberOption,
  } = useSearchableOptions({ initialOptions, search, currentSelectedId, selectedOption: selectedOptionState, pendingOptions, multiSelect, onOptionsLoaded });
  const nativeOptions = useMemo(() => mergeSearchableOptions(selectedOption ? [selectedOption] : [], options).slice(0, 20), [options, selectedOption]);
  const { placement, clearPlacement } = useSearchableComboboxPlacement({ open, portalTarget, rootRef, triggerRef, panelRef, options, error, loading });
  const closeMenu = useCallback((focusTrigger = false) => {
    resetSearch();
    setOpen(false);
    clearPlacement();
    setActiveIndex(-1);
    if (multiSelect) {
      setPendingIds(new Set(selectedIdsRef.current));
      setPendingOptions([]);
    }
    if (focusTrigger) triggerRef.current?.focus();
  }, [clearPlacement, multiSelect, resetSearch]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  // Progressive enhancement toggles the native fallback after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setEnhanced(true), []);

  useEffect(() => {
    setPortalTarget(rootRef.current?.closest("dialog") ?? document.body);
  }, []);

  useEffect(() => {
    function closeOnOutsideInteraction(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideInteraction, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsideInteraction, true);
  }, [closeMenu]);

  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  function openMenu(direction: "down" | "up" = "down") {
    if (disabled) return;
    setOpen(true);
    clearPlacement();
    resetSearch();
    resetOptions();
    if (multiSelect) {
      setPendingIds(new Set(selectedIds));
      setPendingOptions([]);
    }
    setActiveIndex(direction === "up" ? Math.max(options.length - 1, 0) : 0);
    loadOptions("");
  }

  function onSearchChange(nextQuery: string) {
    setOpen(true);
    scheduleSearch(nextQuery);
  }

  function choose(option: SearchableOption) {
    if (multiSelect) {
      setPendingIds((current) => {
        const next = new Set(current);
        if (next.has(option.id)) next.delete(option.id);
        else next.add(option.id);
        return next;
      });
      setPendingOptions((current) => mergeSearchableOptions(current, [option]));
      return;
    }
    setSelectedId(option.id);
    setSelectedOptionState(option);
    rememberOption(option);
    resetSearch();
    setOpen(false);
    clearPlacement();
    setActiveIndex(-1);
    onValueChange?.(option);
    triggerRef.current?.focus();
  }

  function applySelections() {
    if (!multiSelect || pendingIds.size === 0) return;
    onValuesChange?.([...pendingIds].flatMap((id) => allOptions.find((option) => option.id === id) ?? []));
    closeMenu(true);
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
  const pendingLabel = pendingIds.size > 0 ? `Add ${pendingIds.size} friend${pendingIds.size === 1 ? "" : "s"}` : "Add friends";
  const panel = open ? <div
    ref={panelRef}
    className="searchable-combobox__panel"
    data-portal={portalTarget instanceof HTMLDialogElement ? "dialog" : "body"}
    data-placement={placement?.direction}
    style={placement ? {
      top: `${placement.top - (portalTarget && portalTarget !== document.body ? portalTarget.getBoundingClientRect().top : 0)}px`,
      left: `${placement.left - (portalTarget && portalTarget !== document.body ? portalTarget.getBoundingClientRect().left : 0)}px`,
      width: `${placement.width}px`,
      maxHeight: `${placement.maxHeight}px`,
    } : { visibility: "hidden" }}
  >
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
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (!event.relatedTarget || (!rootRef.current?.contains(event.relatedTarget) && !panelRef.current?.contains(event.relatedTarget))) closeMenu();
        }}
      />
    </div>
    <ul id={listboxId} className="searchable-combobox__listbox" role="listbox" aria-label="Matching options">
      {options.map((option, index) => (
        <Fragment key={option.id}>
          {optionGroup(options, option) && (index === 0 || optionGroup(options, options[index - 1]!) !== optionGroup(options, option)) ? <li className="searchable-combobox__group" role="presentation">{optionGroup(options, option)}</li> : null}
          <li
            id={`${listboxId}-${option.id}`}
            role="option"
            aria-selected={multiSelect ? pendingIds.has(option.id) : option.id === currentSelectedId}
            className={`${index === activeIndex ? "searchable-combobox__option searchable-combobox__option--active" : "searchable-combobox__option"}${multiSelect && pendingIds.has(option.id) ? " searchable-combobox__option--selected" : ""}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
          >
            <span>{optionLabel(option)}</span>
            {multiSelect && pendingIds.has(option.id) ? <span aria-hidden="true">✓</span> : null}
          </li>
        </Fragment>
      ))}
      {options.length === 0 ? <li className="searchable-combobox__empty" role="presentation">No matching options.</li> : null}
      {error ? <li className="searchable-combobox__error" role="alert">{error}</li> : null}
    </ul>
    {multiSelect ? <button className="searchable-combobox__apply" type="button" disabled={pendingIds.size === 0} onClick={applySelections}>{pendingLabel}</button> : null}
  </div> : null;

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
      </div>
      {portalTarget && panel ? createPortal(panel, portalTarget) : panel}
    </div>
  );
}
