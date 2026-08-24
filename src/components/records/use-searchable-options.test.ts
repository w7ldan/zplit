import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeSearchableOptions, useSearchableOptions, type SearchableOption } from "./use-searchable-options";

const active: SearchableOption = { id: "active", label: "Ari" };
const archived: SearchableOption = { id: "archived", label: "Bima", archived: true };

function renderOptions(search: (query: string, selectedId?: string) => Promise<SearchableOption[]>, selectedOption?: SearchableOption) {
  return renderHook(() => useSearchableOptions({
    initialOptions: [active],
    search,
    currentSelectedId: selectedOption?.id ?? active.id,
    selectedOption,
    pendingOptions: [],
    multiSelect: false,
  }));
}

afterEach(() => vi.useRealTimers());

describe("useSearchableOptions", () => {
  it("debounces searches by 120ms", async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue([archived]);
    const { result } = renderOptions(search);

    act(() => result.current.scheduleSearch("bim"));
    act(() => vi.advanceTimersByTime(119));
    expect(search).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    await act(async () => { await Promise.resolve(); });

    expect(search).toHaveBeenCalledWith("bim", active.id);
    expect(result.current.options).toEqual([archived]);
  });

  it("lets the newest request win over stale responses", async () => {
    let resolveOld!: (options: SearchableOption[]) => void;
    let resolveNew!: (options: SearchableOption[]) => void;
    const search = vi.fn()
      .mockImplementationOnce(() => new Promise<SearchableOption[]>((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise<SearchableOption[]>((resolve) => { resolveNew = resolve; }));
    const { result } = renderOptions(search);

    act(() => result.current.loadOptions("old"));
    act(() => result.current.loadOptions("new"));
    await act(async () => {
      resolveNew([archived]);
      await Promise.resolve();
    });
    expect(result.current.options).toEqual([archived]);

    await act(async () => {
      resolveOld([active]);
      await Promise.resolve();
    });
    expect(result.current.options).toEqual([archived]);
  });

  it("keeps a selected option recoverable when results omit it and deduplicates merges", async () => {
    const search = vi.fn().mockResolvedValue([active]);
    const { result } = renderOptions(search, archived);

    act(() => result.current.loadOptions(""));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.allOptions).toEqual([active, archived]);
    expect(mergeSearchableOptions([active], [archived, active], [archived])).toEqual([active, archived]);
  });

  it("returns empty results and exposes the existing failure message", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderOptions(search);

    act(() => result.current.loadOptions("none"));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.options).toEqual([]);
    expect(result.current.error).toBe("");

    search.mockRejectedValueOnce(new Error("failed"));
    act(() => result.current.loadOptions("error"));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toBe("Unable to load options.");
  });
});
