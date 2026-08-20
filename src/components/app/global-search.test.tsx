import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { GlobalSearch, isTextEditingTarget, type GlobalSearchAction } from "./global-search";
import { UnsavedChangesProvider, useUnsavedChangesGuard } from "@/components/navigation/unsaved-changes";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/app/search/actions", () => ({ searchGlobalRecords: vi.fn() }));

const records = [
  { kind: "friend" as const, id: "friend-a", title: "Ari" },
  { kind: "trip" as const, id: "trip-a", title: "Bali", detail: "2026-08-01" },
  { kind: "outing" as const, id: "outing-a", title: "Dinner", context: "Bali", date: "2026-08-02T00:00:00.000Z" },
  { kind: "expense" as const, id: "expense-a", title: "Nasi", detail: "Dinner", amount: 42_500 },
  { kind: "repayment" as const, id: "repayment-a", title: "Ari", amount: 42_500, date: "2026-08-03T00:00:00.000Z" },
];

function renderSearch(search: GlobalSearchAction = vi.fn().mockResolvedValue(records)) {
  return render(<GlobalSearch search={search} />);
}

function openSearch() {
  fireEvent.keyDown(document.body, { key: "/" });
  return screen.getByRole("searchbox", { name: "Search records" });
}

function DirtyGuard() {
  useUnsavedChangesGuard(true);
  return null;
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    vi.stubGlobal("confirm", vi.fn());
  });

  it("opens from slash on an ordinary authenticated surface and focuses search", () => {
    renderSearch();
    const input = openSearch();
    expect(input).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Find a record" })).toBeInTheDocument();
  });

  it("ignores slash while typing or editing content", () => {
    renderSearch();
    const input = document.createElement("input");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(input, select, editable);
    for (const target of [input, select, editable]) {
      target.focus();
      fireEvent.keyDown(target, { key: "/" });
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(isTextEditingTarget(input)).toBe(true);
    expect(isTextEditingTarget(editable)).toBe(true);
    input.remove();
    select.remove();
    editable.remove();
  });

  it("closes on Escape and outside interaction, returning focus to the opener", () => {
    renderSearch();
    const trigger = screen.getByRole("button", { name: "Search records" });
    fireEvent.click(trigger);
    const input = screen.getByRole("searchbox", { name: "Search records" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Find a record" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps wheel interaction inside results from closing the search", () => {
    renderSearch();
    openSearch();
    fireEvent.wheel(screen.getByRole("listbox", { name: "Search results" }), { deltaY: 240 });

    expect(screen.getByRole("dialog", { name: "Find a record" })).toBeInTheDocument();
  });

  it("renders grouped owner-search results with concise amount context", async () => {
    const search = vi.fn().mockResolvedValue(records);
    renderSearch(search);
    const input = openSearch();
    fireEvent.change(input, { target: { value: "42.500" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("42.500"));
    expect(screen.getByRole("group", { name: "Friends" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Trips" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Outings" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Expenses" })).toHaveTextContent("Rp 42.500");
    expect(screen.getByRole("group", { name: "Repayments" })).toHaveTextContent("Rp 42.500");
    await waitFor(() => expect(screen.getAllByRole("time")).toHaveLength(2));
    expect(screen.getAllByRole("time").map((time) => time.getAttribute("dateTime"))).toEqual([
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ]);
  });

  it("rejects stale results and enforces the twenty-result client cap", async () => {
    const pending = new Map<string, (value: typeof records) => void>();
    const search = vi.fn((query: string) => new Promise<typeof records>((resolve) => pending.set(query, resolve)));
    renderSearch(search);
    const input = openSearch();
    fireEvent.change(input, { target: { value: "old" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("old"));
    fireEvent.change(input, { target: { value: "new" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("new"));
    pending.get("old")?.([{ kind: "friend", id: "old", title: "Old result" }]);
    pending.get("new")?.(Array.from({ length: 25 }, (_, index) => ({ kind: "friend" as const, id: `friend-${index}`, title: `Friend ${index}` })));
    await waitFor(() => expect(screen.getByText("Friend 0")).toBeInTheDocument());
    expect(screen.queryByText("Friend 24")).not.toBeInTheDocument();
    expect(screen.queryByText("Old result")).not.toBeInTheDocument();
  });

  it("supports Arrow navigation and Enter selection", async () => {
    renderSearch();
    const input = openSearch();
    fireEvent.change(input, { target: { value: "ari" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Ari" })).toBeInTheDocument());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(router.push).toHaveBeenCalledWith("/app/trips/trip-a");
  });

  it("uses the existing unsaved-change confirmation before navigating", async () => {
    vi.mocked(confirm).mockReturnValue(false);
    const search = vi.fn().mockResolvedValue(records);
    render(<UnsavedChangesProvider><DirtyGuard /><GlobalSearch search={search} /></UnsavedChangesProvider>);
    const input = openSearch();
    fireEvent.change(input, { target: { value: "ari" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Ari" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: "Ari" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();

    vi.mocked(confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("option", { name: "Ari" }));
    expect(router.push).toHaveBeenCalledWith("/app/friends/friend-a");
  });

  it("keeps the authenticated overlay mobile-safe and out of public page code", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/app/styles/20-authenticated-shell.css"), "utf8");
    const publicPage = readFileSync(path.resolve(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(styles).toContain("body.global-search-open");
    expect(styles).toContain("max-height: calc(100svh - 1.5rem)");
    expect(styles).toMatch(/\.global-search__backdrop\s*\{[\s\S]*?overflow: hidden;/);
    expect(styles).toMatch(/\.global-search__dialog\s*\{[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\);/);
    expect(styles).toMatch(/\.global-search__results\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/);
    expect(styles).toContain("width: min(38rem, 100%);");
    expect(publicPage).not.toContain("GlobalSearch");
  });
});
