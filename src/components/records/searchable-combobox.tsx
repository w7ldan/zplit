"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SearchableOption = { id: string; label: string; archived?: boolean; group?: string };
export type SearchableOptionAction = (query: string, selectedId?: string) => Promise<SearchableOption[]>;
export type SearchableComboboxPlacement = {
  direction: "down" | "up";
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

type PlacementRect = Pick<DOMRect, "top" | "right" | "bottom" | "left">;
type TriggerRect = PlacementRect & Pick<DOMRect, "width">;

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

function mergeOptions(...groups: SearchableOption[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((option) => !seen.has(option.id) && seen.add(option.id));
}

function optionLabel(option: SearchableOption) {
  return option.archived ? `${option.label} (ARCHIVED)` : option.label;
}

function optionGroup(options: SearchableOption[], option: SearchableOption) {
  if (option.group) return option.group;
  if (!options.some((candidate) => !candidate.archived) || !options.some((candidate) => candidate.archived)) return undefined;
  return option.archived ? "Archived friends" : "Active friends";
}

export function calculateSearchableComboboxPlacement(triggerRect: TriggerRect, boundaryRect: PlacementRect, naturalHeight: number, gap = 4): SearchableComboboxPlacement {
  const boundaryWidth = Math.max(boundaryRect.right - boundaryRect.left, 0);
  const width = Math.min(Math.max(triggerRect.width, 0), boundaryWidth);
  const left = Math.min(Math.max(triggerRect.left, boundaryRect.left), boundaryRect.right - width);
  const below = Math.max(boundaryRect.bottom - triggerRect.bottom - gap, 0);
  const above = Math.max(triggerRect.top - boundaryRect.top - gap, 0);
  const height = Math.max(naturalHeight, 0);
  const direction = below >= height || below >= above ? "down" : "up";
  const available = direction === "down" ? below : above;
  const maxHeight = Math.min(height, available);

  return {
    direction,
    top: direction === "down" ? triggerRect.bottom + gap : triggerRect.top - gap - maxHeight,
    left,
    width,
    maxHeight,
  };
}

function isClippingOverflow(value: string) {
  return value === "auto" || value === "clip" || value === "hidden" || value === "scroll";
}

function getClippingRect(element: HTMLElement) {
  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport?.offsetLeft ?? 0;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const boundary = {
    top: viewportTop,
    right: viewportLeft + (visualViewport?.width ?? window.innerWidth),
    bottom: viewportTop + (visualViewport?.height ?? window.innerHeight),
    left: viewportLeft,
  };

  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    const clipX = isClippingOverflow(style.overflowX || style.overflow);
    const clipY = isClippingOverflow(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const rect = ancestor.getBoundingClientRect();
    if (clipX) {
      boundary.left = Math.max(boundary.left, rect.left);
      boundary.right = Math.min(boundary.right, rect.right);
    }
    if (clipY) {
      boundary.top = Math.max(boundary.top, rect.top);
      boundary.bottom = Math.min(boundary.bottom, rect.bottom);
    }
  }

  return boundary;
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
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(value ?? (placeholder ? "" : initialOptions[0]?.id || ""));
  const [selectedOptionState, setSelectedOptionState] = useState<SearchableOption | undefined>(() => initialOptions.find((option) => option.id === (value ?? (placeholder ? "" : initialOptions[0]?.id || ""))));
  const [pendingIds, setPendingIds] = useState(() => new Set(selectedIds));
  const [pendingOptions, setPendingOptions] = useState<SearchableOption[]>([]);
  const [loadedOptions, setLoadedOptions] = useState<SearchableOption[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [placement, setPlacement] = useState<SearchableComboboxPlacement | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const listboxId = `${id}-listbox`;
  const currentSelectedId = value !== undefined ? value : selectedId;
  const allOptions = useMemo(() => mergeOptions(initialOptions, loadedOptions ?? [], selectedOptionState ? [selectedOptionState] : [], pendingOptions), [initialOptions, loadedOptions, pendingOptions, selectedOptionState]);
  const selectedOption = allOptions.find((option) => option.id === currentSelectedId);
  const options = useMemo(() => (multiSelect ? mergeOptions(pendingOptions, loadedOptions ?? initialOptions) : loadedOptions ?? initialOptions).slice(0, 20), [initialOptions, loadedOptions, multiSelect, pendingOptions]);
  const nativeOptions = useMemo(() => mergeOptions(selectedOption ? [selectedOption] : [], options).slice(0, 20), [options, selectedOption]);

  // Progressive enhancement toggles the native fallback after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setEnhanced(true), []);

  useEffect(() => {
    setPortalTarget(rootRef.current?.closest("dialog") ?? document.body);
  }, []);

  useEffect(() => () => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
  }, []);

  useEffect(() => {
    function closeOnOutsideInteraction(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideInteraction, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsideInteraction, true);
  }, []);

  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !portalTarget) return;

    let frame: number | null = null;
    const schedulePlacement = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const trigger = triggerRef.current;
        const panel = panelRef.current;
        if (!trigger || !panel) return;
        const triggerRect = trigger.getBoundingClientRect();
        const boundaryRect = getClippingRect(rootRef.current ?? trigger);
        const width = Math.min(Math.max(triggerRect.width, 0), Math.max(boundaryRect.right - boundaryRect.left, 0));
        panel.style.width = `${width}px`;
        panel.style.maxHeight = "none";
        setPlacement(calculateSearchableComboboxPlacement(triggerRect, boundaryRect, panel.scrollHeight));
      });
    };

    schedulePlacement();
    window.addEventListener("resize", schedulePlacement);
    window.addEventListener("scroll", schedulePlacement, true);
    window.visualViewport?.addEventListener("resize", schedulePlacement);
    window.visualViewport?.addEventListener("scroll", schedulePlacement);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePlacement);
      window.removeEventListener("scroll", schedulePlacement, true);
      window.visualViewport?.removeEventListener("resize", schedulePlacement);
      window.visualViewport?.removeEventListener("scroll", schedulePlacement);
    };
  }, [error, loading, open, options, portalTarget]);

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
    setPlacement(null);
    setQuery("");
    setActiveIndex(-1);
    if (multiSelect) {
      setPendingIds(new Set(selectedIds));
      setPendingOptions([]);
    }
    if (focusTrigger) triggerRef.current?.focus();
  }

  function openMenu(direction: "down" | "up" = "down") {
    if (disabled) return;
    setOpen(true);
    setPlacement(null);
    setQuery("");
    setLoadedOptions(null);
    setError("");
    if (multiSelect) {
      setPendingIds(new Set(selectedIds));
      setPendingOptions([]);
    }
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
    if (multiSelect) {
      setPendingIds((current) => {
        const next = new Set(current);
        if (next.has(option.id)) next.delete(option.id);
        else next.add(option.id);
        return next;
      });
      setPendingOptions((current) => mergeOptions(current, [option]));
      return;
    }
    setSelectedId(option.id);
    setSelectedOptionState(option);
    setLoadedOptions((current) => mergeOptions([option], current ?? []));
    setQuery("");
    setOpen(false);
    setPlacement(null);
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
        onChange={(event) => scheduleSearch(event.target.value)}
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
