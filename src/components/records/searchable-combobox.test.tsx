import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchableCombobox, type SearchableOption } from "./searchable-combobox";

const active: SearchableOption = { id: "11111111-1111-4111-8111-111111111111", label: "Ari" };
const archived: SearchableOption = { id: "22222222-2222-4222-8222-222222222222", label: "Bima", archived: true };

function renderSelector(options: SearchableOption[], value = active.id, search = vi.fn().mockResolvedValue([active, archived]), onValueChange?: (option: SearchableOption) => void) {
  return {
    search,
    ...render(<>
      <label id="selector-label" htmlFor="selector">Friend</label>
      <SearchableCombobox id="selector" name="friendId" value={value} options={options} search={search} required labelId="selector-label" onValueChange={onValueChange} />
    </>),
  };
}

describe("SearchableCombobox", () => {
  it("replaces disjoint searches, caps visible options, and selects the active result with Enter", async () => {
    const searched = Array.from({ length: 25 }, (_, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, label: `Search ${index}` }));
    const search = vi.fn().mockResolvedValue(searched);
    const onValueChange = vi.fn();
    renderSelector([active, archived], active.id, search, onValueChange);
    const input = screen.getByRole("combobox", { name: "Friend" });
    fireEvent.change(input, { target: { value: "Search" } });
    await waitFor(() => expect(within(screen.getByRole("listbox")).getByText("Search 0")).toBeInTheDocument());
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(20);
    expect(within(screen.getByRole("listbox")).queryByRole("option", { name: "Ari" })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith(searched[0]);
  });

  it("shows a true empty search state and ignores stale responses", async () => {
    let resolveFirst!: (value: SearchableOption[]) => void;
    const first = new Promise<SearchableOption[]>((resolve) => { resolveFirst = resolve; });
    const search = vi.fn()
      .mockResolvedValueOnce([active])
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce([]);
    renderSelector([active], active.id, search);
    const input = screen.getByRole("combobox", { name: "Friend" });
    fireEvent.focus(input);
    await waitFor(() => expect(search).toHaveBeenCalledWith("", active.id));
    fireEvent.change(input, { target: { value: "old" } });
    await new Promise((resolve) => setTimeout(resolve, 140));
    await waitFor(() => expect(search).toHaveBeenCalledWith("old", active.id));
    fireEvent.change(input, { target: { value: "new" } });
    await waitFor(() => expect(screen.getByText("No matching options.")).toBeInTheDocument());
    resolveFirst([archived]);
    await Promise.resolve();
    expect(screen.queryByRole("option", { name: "Bima (ARCHIVED)" })).not.toBeInTheDocument();
  });

  it("keeps the native field, exposes combobox relationships, and follows keyboard selection", async () => {
    const onValueChange = vi.fn();
    const search = vi.fn().mockResolvedValue([active, archived]);
    render(<>
      <label id="selector-label" htmlFor="selector">Friend</label>
      <SearchableCombobox id="selector" name="friendId" value={active.id} options={[active, archived]} search={search} required labelId="selector-label" onValueChange={onValueChange} />
    </>);
    const input = screen.getByRole("combobox", { name: "Friend" });
    expect(screen.getByRole("combobox", { name: "Friend" })).toHaveAttribute("aria-controls", "selector-listbox");
    expect(document.querySelector('select[name="friendId"]')).toBeInTheDocument();

    fireEvent.focus(input);
    await waitFor(() => expect(search).toHaveBeenCalledWith("", active.id));
    expect(input).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input, { key: "End" });
    expect(input).toHaveAttribute("aria-activedescendant", `selector-listbox-${archived.id}`);
    fireEvent.keyDown(input, { key: "Home" });
    expect(input).toHaveAttribute("aria-activedescendant", `selector-listbox-${active.id}`);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue(active.label);
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(onValueChange).toHaveBeenCalledWith(active);
    fireEvent.keyDown(input, { key: "Escape" });
  });

  it("loads a selected value that is outside the initial result set", async () => {
    const search = vi.fn().mockResolvedValue([archived]);
    renderSelector([active], archived.id, search);

    await waitFor(() => expect(search).toHaveBeenCalledWith("", archived.id));
    expect(screen.getByRole("combobox", { name: "Friend" })).toHaveValue("Bima (ARCHIVED)");
    expect(screen.getByRole("option", { name: "Bima (ARCHIVED)" })).toBeInTheDocument();
  });

  it("labels archived options separately and keeps long labels inside the option", async () => {
    const long = { ...active, label: "A".repeat(240) };
    renderSelector([long, archived], active.id, vi.fn().mockResolvedValue([long, archived]));
    const input = screen.getByRole("combobox", { name: "Friend" });
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByText("Active friends")).toBeInTheDocument());
    expect(screen.getByText("Archived friends")).toBeInTheDocument();
    expect(within(screen.getByRole("listbox")).getByText(`${"A".repeat(240)}`)).toBeInTheDocument();
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: "Bima (ARCHIVED)" })).toHaveAttribute("aria-selected", "false");
  });
});
