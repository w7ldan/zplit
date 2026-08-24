import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SearchableOption = { id: string; label: string; archived?: boolean; group?: string };
export type SearchableOptionAction = (query: string, selectedId?: string) => Promise<SearchableOption[]>;

type UseSearchableOptionsProps = {
  initialOptions: SearchableOption[];
  search: SearchableOptionAction;
  currentSelectedId: string;
  selectedOption?: SearchableOption;
  pendingOptions: SearchableOption[];
  multiSelect: boolean;
  onOptionsLoaded?: (options: SearchableOption[]) => void;
};

export function mergeSearchableOptions(...groups: SearchableOption[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((option) => !seen.has(option.id) && seen.add(option.id));
}

export function useSearchableOptions({ initialOptions, search, currentSelectedId, selectedOption, pendingOptions, multiSelect, onOptionsLoaded }: UseSearchableOptionsProps) {
  const [query, setQuery] = useState("");
  const [loadedOptions, setLoadedOptions] = useState<SearchableOption[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const allOptions = useMemo(() => mergeSearchableOptions(initialOptions, loadedOptions ?? [], selectedOption ? [selectedOption] : [], pendingOptions), [initialOptions, loadedOptions, pendingOptions, selectedOption]);
  const selected = allOptions.find((option) => option.id === currentSelectedId);
  const options = useMemo(() => (multiSelect ? mergeSearchableOptions(pendingOptions, loadedOptions ?? initialOptions) : loadedOptions ?? initialOptions).slice(0, 20), [initialOptions, loadedOptions, multiSelect, pendingOptions]);

  const loadOptions = useCallback((nextQuery: string) => {
    const request = ++requestRef.current;
    setError("");
    setLoading(true);
    void search(nextQuery, currentSelectedId).then((result) => {
      if (request !== requestRef.current) return;
      const nextOptions = result.slice(0, 20);
      setLoadedOptions(nextOptions);
      onOptionsLoaded?.(nextOptions);
    }).catch(() => {
      if (request === requestRef.current) setError("Unable to load options.");
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
  }, [currentSelectedId, onOptionsLoaded, search]);

  const scheduleSearch = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      loadOptions(nextQuery);
    }, 120);
  }, [loadOptions]);

  const resetSearch = useCallback(() => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    setQuery("");
  }, []);

  const resetOptions = useCallback(() => {
    setLoadedOptions(null);
    setError("");
  }, []);

  const rememberOption = useCallback((option: SearchableOption) => {
    setLoadedOptions((current) => mergeSearchableOptions([option], current ?? []));
  }, []);

  useEffect(() => {
    if (!currentSelectedId || allOptions.some((option) => option.id === currentSelectedId)) return;
    const timer = window.setTimeout(() => loadOptions(""), 0);
    return () => window.clearTimeout(timer);
  }, [allOptions, currentSelectedId, loadOptions]);

  useEffect(() => () => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
  }, []);

  return { allOptions, options, selectedOption: selected, query, error, loading, loadOptions, scheduleSearch, resetSearch, resetOptions, rememberOption };
}
