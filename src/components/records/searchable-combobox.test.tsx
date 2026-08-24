import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchableCombobox, type SearchableOption } from "./searchable-combobox";

const active: SearchableOption = { id: "11111111-1111-4111-8111-111111111111", label: "Ari" };
const archived: SearchableOption = { id: "22222222-2222-4222-8222-222222222222", label: "Bima", archived: true };

function renderSelector(options: SearchableOption[] = [active, archived], props: Partial<React.ComponentProps<typeof SearchableCombobox>> = {}) {
  const search = props.search ?? vi.fn().mockResolvedValue(options);
  return {
    search,
    ...render(<form>
      <label id="selector-label" htmlFor="selector">Friend</label>
      <SearchableCombobox id="selector" name="friendId" options={options} search={search} required labelId="selector-label" searchLabel="Search friends" {...props} />
    </form>),
  };
}

async function openSelector() {
  const trigger = screen.getByRole("combobox", { name: "Friend" });
  fireEvent.click(trigger);
  const searchInput = await screen.findByRole("searchbox", { name: "Search friends" });
  await waitFor(() => expect(document.activeElement).toBe(searchInput));
  return { trigger, searchInput, listbox: screen.getByRole("listbox") };
}

describe("SearchableCombobox", () => {
  it("ports the open popup to the dialog layer outside clipped form ancestors", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    const view = render(
      <div className="task-panel__surface">
        <label id="dialog-selector-label" htmlFor="dialog-selector">Outing</label>
        <SearchableCombobox id="dialog-selector" options={[active]} search={vi.fn().mockResolvedValue([active])} labelId="dialog-selector-label" searchLabel="Search outings" />
      </div>,
      { container: dialog },
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Outing" }));
    const listbox = await screen.findByRole("listbox");

    expect(listbox.parentElement).toHaveAttribute("data-portal", "dialog");
    expect(listbox.parentElement?.parentElement).toBe(dialog);
    view.unmount();
    dialog.remove();
  });

  it("uses a non-editable selected-value trigger and keeps search closed", () => {
    renderSelector();
    const trigger = screen.getByRole("combobox", { name: "Friend" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveTextContent("Ari");
    expect(trigger).not.toHaveAttribute("contenteditable");
    expect(screen.queryByRole("searchbox", { name: "Search friends" })).not.toBeInTheDocument();
    expect(document.querySelector('select[name="friendId"]')).toBeInTheDocument();
  });

  it("opens from click and keyboard, focusing a fresh search field", async () => {
    const { search } = renderSelector();
    const trigger = screen.getByRole("combobox", { name: "Friend" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const searchInput = await screen.findByRole("searchbox", { name: "Search friends" });
    await waitFor(() => expect(search).toHaveBeenCalledWith("", active.id));
    expect(document.activeElement).toBe(searchInput);
    fireEvent.keyDown(searchInput, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("searchbox", { name: "Search friends" })).not.toBeInTheDocument();
  });

  it("keeps temporary query text out of the selected form value", async () => {
    const { search } = renderSelector();
    const { searchInput } = await openSelector();
    fireEvent.change(searchInput, { target: { value: "typed text" } });
    expect(searchInput).toHaveValue("typed text");
    expect(document.querySelector('input[name="friendId"]')).not.toBeInTheDocument();
    expect(new FormData(document.querySelector("form")!).get("friendId")).toBe(active.id);
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(search).toHaveBeenLastCalledWith("typed text", active.id);
  });

  it("selects an option, updates the named ID, and restores trigger focus", async () => {
    const onValueChange = vi.fn();
    renderSelector([active, archived], { onValueChange });
    const { searchInput, listbox } = await openSelector();
    fireEvent.click(within(listbox).getByRole("option", { name: "Bima (ARCHIVED)" }));
    const trigger = screen.getByRole("combobox", { name: "Friend" });
    expect(trigger).toHaveTextContent("Bima (ARCHIVED)");
    expect(document.querySelector('select[name="friendId"]')).toHaveValue(archived.id);
    expect(onValueChange).toHaveBeenCalledWith(archived);
    expect(trigger).toHaveFocus();
    expect(searchInput).not.toBeInTheDocument();
  });

  it("caps results at 20 and chooses the active result with Enter", async () => {
    const searched = Array.from({ length: 25 }, (_, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, label: `Search ${index}` }));
    const search = vi.fn().mockResolvedValue(searched);
    renderSelector([active], { search });
    fireEvent.click(screen.getByRole("combobox", { name: "Friend" }));
    const searchInput = await screen.findByRole("searchbox", { name: "Search friends" });
    const listbox = screen.getByRole("listbox");
    await waitFor(() => expect(within(listbox).getByRole("option", { name: "Search 0" })).toBeInTheDocument());
    expect(within(listbox).getAllByRole("option")).toHaveLength(20);
    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(screen.getByRole("combobox", { name: "Friend" })).toHaveTextContent("Search 0");
  });

  it("navigates with ArrowUp, ArrowDown, Home, and End", async () => {
    renderSelector();
    const { searchInput, listbox } = await openSelector();
    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    expect(within(listbox).getByRole("option", { name: "Bima (ARCHIVED)" })).toHaveClass("searchable-combobox__option--active");
    fireEvent.keyDown(searchInput, { key: "Home" });
    expect(within(listbox).getByRole("option", { name: "Ari" })).toHaveClass("searchable-combobox__option--active");
    fireEvent.keyDown(searchInput, { key: "End" });
    expect(within(listbox).getByRole("option", { name: "Bima (ARCHIVED)" })).toHaveClass("searchable-combobox__option--active");
    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(screen.getByRole("combobox", { name: "Friend" })).toHaveTextContent("Bima (ARCHIVED)");
  });

  it("closes on outside pointer interaction", async () => {
    renderSelector();
    await openSelector();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ignores stale responses and keeps an empty result state", async () => {
    let resolveOld!: (value: SearchableOption[]) => void;
    const oldResponse = new Promise<SearchableOption[]>((resolve) => { resolveOld = resolve; });
    const search = vi.fn().mockResolvedValueOnce([active]).mockReturnValueOnce(oldResponse).mockResolvedValueOnce([]);
    renderSelector([active], { search });
    const { searchInput } = await openSelector();
    fireEvent.change(searchInput, { target: { value: "old" } });
    await new Promise((resolve) => setTimeout(resolve, 140));
    await waitFor(() => expect(search).toHaveBeenCalledWith("old", active.id));
    fireEvent.change(searchInput, { target: { value: "new" } });
    await new Promise((resolve) => setTimeout(resolve, 140));
    await waitFor(() => expect(screen.getByText("No matching options.")).toBeInTheDocument());
    resolveOld([archived]);
    await Promise.resolve();
    expect(screen.queryByRole("option", { name: "Bima (ARCHIVED)" })).not.toBeInTheDocument();
  });

  it("recovers a selected option outside the initial result page and preserves archived grouping", async () => {
    const search = vi.fn().mockResolvedValue([active, archived]);
    renderSelector([active], { value: archived.id, search });
    await waitFor(() => expect(search).toHaveBeenCalledWith("", archived.id));
    expect(screen.getByRole("combobox", { name: "Friend" })).toHaveTextContent("Bima (ARCHIVED)");
    const { listbox } = await openSelector();
    expect(within(listbox).getByText("Active friends")).toBeInTheDocument();
    expect(within(listbox).getByText("Archived friends")).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Bima (ARCHIVED)" })).toHaveAttribute("aria-selected", "true");
  });

  it("does not open when disabled and keeps its named value", () => {
    renderSelector([active], { value: active.id, disabled: true });
    const trigger = screen.getByRole("combobox", { name: "Friend" });
    fireEvent.click(trigger);
    expect(screen.queryByRole("searchbox", { name: "Search friends" })).not.toBeInTheDocument();
    expect(new FormData(document.querySelector("form")!).get("friendId")).toBe(active.id);
  });

  it("contains long labels in the trigger and never submits the query", async () => {
    const long = { ...active, label: "A".repeat(240) };
    renderSelector([long, archived]);
    expect(screen.getByRole("combobox", { name: "Friend" })).toHaveTextContent("A".repeat(240));
    expect(document.querySelector('select[name="friendId"]')).toBeInTheDocument();
    expect(document.querySelector('input[name="friendId"]')).not.toBeInTheDocument();
  });
});
