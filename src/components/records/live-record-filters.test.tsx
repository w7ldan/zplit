import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRecordFilters } from "./live-record-filters";

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

const baseProps = {
  action: "/app/outings",
  search: { label: "Search outings", placeholder: "Outing title", value: "" },
  selects: [{ name: "assignment", label: "Assignment", value: "", options: [{ value: "", label: "All" }, { value: "assigned", label: "Assigned" }] }],
  month: { label: "Month", value: "" },
  preservedParams: { task: "open", page: "3" },
  resultStatus: "1 outing found.",
};
const browserTimezone = new Date().getTimezoneOffset().toString();
const timezoneQuery = `tz=${browserTimezone}`;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.replace.mockReset();
  window.history.replaceState({}, "", `/app/outings?page=3&task=open&${timezoneQuery}#record-list`);
});

afterEach(() => vi.useRealTimers());

describe("LiveRecordFilters", () => {
  it("does not render a mobile disclosure unless configured", () => {
    render(<LiveRecordFilters {...baseProps} />);
    expect(screen.queryByText("Filters", { selector: "summary" })).not.toBeInTheDocument();
  });

  it("keeps search outside a native disclosure and counts only discrete filters", () => {
    const props = { ...baseProps, mobileDisclosure: { activeCount: 0 }, clearHref: "/app/outings" };
    const view = render(<LiveRecordFilters {...props} />);
    const summary = screen.getByText("Filters", { selector: "summary" });
    const details = summary.parentElement as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByLabelText("Search outings").parentElement).not.toBe(details);
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/app/outings");

    fireEvent.click(summary);
    expect(details.open).toBe(true);
    view.rerender(<LiveRecordFilters {...props} />);
    expect(details.open).toBe(true);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
    view.unmount();

    render(<LiveRecordFilters {...baseProps} mobileDisclosure={{ activeCount: 1 }} />);
    expect(screen.getByText("Filters (1)", { selector: "summary" })).toBeInTheDocument();
    expect((screen.getByText("Filters (1)", { selector: "summary" }).parentElement as HTMLDetailsElement).open).toBe(true);
  });

  it("keeps closed native fields in FormData", () => {
    render(<LiveRecordFilters {...baseProps} mobileDisclosure={{ activeCount: 0 }} />);
    const form = screen.getByRole("search") as HTMLFormElement;
    expect((screen.getByText("Filters", { selector: "summary" }).parentElement as HTMLDetailsElement).open).toBe(false);
    expect(new FormData(form).get("assignment")).toBe("");
    expect(new FormData(form).get("month")).toBe("");
  });

  it("exposes the completed result status as one polite atomic region", () => {
    render(<LiveRecordFilters {...baseProps} resultStatus="12 outings found." />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("12 outings found.");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveClass("sr-only");
  });

  it("updates visibly while typing, debounces one navigation, and has no visible Search button", () => {
    render(<LiveRecordFilters {...baseProps} />);
    const input = screen.getByLabelText("Search outings");
    fireEvent.change(input, { target: { value: "Dinner" } });
    expect(input).toHaveValue("Dinner");
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(274));
    expect(mocks.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith(`/app/outings?task=open&${timezoneQuery}&q=Dinner#record-list`, { scroll: false });
  });

  it("cancels earlier typing, clears immediately, and applies Enter immediately", () => {
    const { rerender } = render(<LiveRecordFilters {...baseProps} />);
    const input = screen.getByLabelText("Search outings");
    fireEvent.change(input, { target: { value: "D" } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: "Dinner" } });
    act(() => vi.advanceTimersByTime(275));
    expect(mocks.replace).toHaveBeenCalledTimes(1);

    mocks.replace.mockReset();
    window.history.replaceState({}, "", "/app/outings?q=Dinner&page=2&task=open#record-list");
    rerender(<LiveRecordFilters {...baseProps} search={{ ...baseProps.search, value: "Dinner" }} />);
    fireEvent.change(screen.getByLabelText("Search outings"), { target: { value: "" } });
    expect(mocks.replace).toHaveBeenCalledWith("/app/outings?task=open#record-list", { scroll: false });

    mocks.replace.mockReset();
    window.history.replaceState({}, "", "/app/outings?page=2&task=open#record-list");
    rerender(<LiveRecordFilters {...baseProps} />);
    const currentInput = screen.getByLabelText("Search outings");
    fireEvent.change(currentInput, { target: { value: "Now" } });
    fireEvent.keyDown(currentInput, { key: "Enter" });
    expect(mocks.replace).toHaveBeenCalledTimes(1);
  });

  it("suppresses interim composition navigation and applies discrete filters immediately", () => {
    render(<LiveRecordFilters {...baseProps} />);
    const input = screen.getByLabelText("Search outings");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "東京" } });
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.replace).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { target: { value: "東京" } });
    act(() => vi.advanceTimersByTime(275));
    expect(mocks.replace).toHaveBeenCalledTimes(1);

    mocks.replace.mockReset();
    window.history.replaceState({}, "", "/app/outings?q=東京&page=4&task=open#record-list");
    fireEvent.change(screen.getByLabelText("Assignment"), { target: { value: "assigned" } });
    expect(mocks.replace).toHaveBeenCalledWith("/app/outings?q=%E6%9D%B1%E4%BA%AC&task=open&assignment=assigned#record-list", { scroll: false });
    mocks.replace.mockReset();
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-04" } });
    expect(mocks.replace).toHaveBeenCalledWith("/app/outings?q=%E6%9D%B1%E4%BA%AC&task=open&assignment=assigned&month=2026-04#record-list", { scroll: false });
  });

  it("keeps a newer draft and its debounce after an older response, including after blur", () => {
    for (const blur of [false, true]) {
      window.history.replaceState({}, "", `/app/outings?page=3&task=open&${timezoneQuery}#record-list`);
      const view = render(<LiveRecordFilters {...baseProps} />);
      const input = screen.getByLabelText("Search outings");
      fireEvent.change(input, { target: { value: "A" } });
      act(() => vi.advanceTimersByTime(275));
      expect(mocks.replace).toHaveBeenCalledTimes(1);

      window.history.replaceState({}, "", `/app/outings?task=open&${timezoneQuery}&q=A#record-list`);
      fireEvent.change(input, { target: { value: "AB" } });
      if (blur) fireEvent.blur(input);
      view.rerender(<LiveRecordFilters {...baseProps} search={{ ...baseProps.search, value: "A" }} />);
      expect(input).toHaveValue("AB");
      act(() => vi.advanceTimersByTime(274));
      expect(mocks.replace).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(1));
      expect(mocks.replace).toHaveBeenCalledTimes(2);
      expect(mocks.replace).toHaveBeenLastCalledWith(`/app/outings?task=open&${timezoneQuery}&q=AB#record-list`, { scroll: false });

      view.unmount();
      mocks.replace.mockReset();
    }
  });

  it("composes a pending draft with a discrete change and removes page", () => {
    render(<LiveRecordFilters {...baseProps} />);
    fireEvent.change(screen.getByLabelText("Search outings"), { target: { value: "Dinner" } });
    fireEvent.change(screen.getByLabelText("Assignment"), { target: { value: "assigned" } });
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith(`/app/outings?task=open&${timezoneQuery}&q=Dinner&assignment=assigned#record-list`, { scroll: false });
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
  });

  it("retains rapid discrete changes and the current hash", () => {
    const props = {
      ...baseProps,
      action: "/app/expenses",
      selects: [
        ...baseProps.selects,
        { name: "allocation", label: "Allocation", value: "", options: [{ value: "", label: "All" }, { value: "complete", label: "Complete" }] },
      ],
    };
    window.history.replaceState({}, "", `/app/expenses?page=5&task=open&${timezoneQuery}#record-list`);
    render(<LiveRecordFilters {...props} />);
    fireEvent.change(screen.getByLabelText("Search outings"), { target: { value: "Dinner" } });
    fireEvent.change(screen.getByLabelText("Assignment"), { target: { value: "assigned" } });
    fireEvent.change(screen.getByLabelText("Allocation"), { target: { value: "complete" } });
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-04" } });
    expect(mocks.replace).toHaveBeenCalledTimes(3);
    expect(mocks.replace).toHaveBeenLastCalledWith(`/app/expenses?task=open&${timezoneQuery}&q=Dinner&assignment=assigned&allocation=complete&month=2026-04#record-list`, { scroll: false });
  });

  it("keeps native names and submits direct DOM select changes", () => {
    const props = {
      ...baseProps,
      action: "/app/repayments",
      selects: [
        { name: "outing", label: "Outing", value: "", options: [{ value: "", label: "All outings" }, { value: "outing-a", label: "Dinner" }] },
        { name: "assignment", label: "Assignment", value: "", options: [{ value: "", label: "All" }, { value: "assigned", label: "Assigned" }] },
        { name: "friendId", label: "Friend", value: "", options: [{ value: "", label: "All friends" }, { value: "friend-a", label: "Ada" }] },
        { name: "allocation", label: "Allocation", value: "", options: [{ value: "", label: "All" }, { value: "complete", label: "Complete" }] },
      ],
    };
    render(<LiveRecordFilters {...props} />);
    const form = screen.getByRole("search") as HTMLFormElement;

    for (const [label, name, value] of [["Outing", "outing", "outing-a"], ["Assignment", "assignment", "assigned"], ["Friend", "friendId", "friend-a"], ["Allocation", "allocation", "complete"]]) {
      const select = screen.getByLabelText(label) as HTMLSelectElement;
      expect(select).toHaveAttribute("name", name);
      select.value = value;
      expect(new FormData(form).get(name)).toBe(value);
    }
  });

  it("keeps searchable filter queries local until an option is chosen", async () => {
    const props = {
      ...baseProps,
      selects: [{ name: "outing", label: "Outing", value: "", options: [{ value: "", label: "All outings" }, { value: "outing-a", label: "Dinner" }], search: vi.fn().mockResolvedValue([{ id: "", label: "All outings" }, { id: "outing-a", label: "Dinner" }]) }],
    };
    render(<LiveRecordFilters {...props} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Outing" }));
    const searchInput = document.getElementById("record-filter-outing-search") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "dinner" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: "Dinner" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Dinner" }));
    expect(mocks.replace).toHaveBeenCalledWith(`/app/outings?task=open&${timezoneQuery}&outing=outing-a#record-list`, { scroll: false });
    expect(document.getElementById("record-filter-outing-search")).not.toBeInTheDocument();
  });

  it("removes inactive filters, keeps their native names, and suppresses duplicates", () => {
    window.history.replaceState({}, "", `/app/outings?q=Dinner&assignment=assigned&page=2&${timezoneQuery}#record-list`);
    render(<LiveRecordFilters {...baseProps} search={{ ...baseProps.search, value: "Dinner" }} selects={[{ ...baseProps.selects[0], value: "assigned" }]} />);
    fireEvent.change(screen.getByLabelText("Assignment"), { target: { value: "" } });
    expect(mocks.replace).toHaveBeenCalledWith(`/app/outings?q=Dinner&${timezoneQuery}#record-list`, { scroll: false });
    expect(mocks.replace.mock.calls[0][0]).not.toContain("assignment=");

    mocks.replace.mockReset();
    window.history.replaceState({}, "", `/app/outings?q=Dinner&${timezoneQuery}#record-list`);
    const view = render(<LiveRecordFilters {...baseProps} search={{ ...baseProps.search, value: "Dinner" }} />);
    expect(new FormData(screen.getAllByRole("search").at(-1) as HTMLFormElement).get("assignment")).toBe("");
    fireEvent.change(screen.getAllByLabelText("Search outings").at(-1) as HTMLElement, { target: { value: "Dinner" } });
    act(() => vi.advanceTimersByTime(275));
    expect(mocks.replace).not.toHaveBeenCalled();
    view.unmount();

    window.history.replaceState({}, "", `/app/repayments?q=Cash&allocation=needs&page=2&${timezoneQuery}#record-list`);
    const allocationView = render(<LiveRecordFilters action="/app/repayments" search={{ label: "Search repayments", placeholder: "Friend", value: "Cash" }} selects={[{ name: "allocation", label: "Allocation", value: "needs", options: [{ value: "", label: "All allocation states" }, { value: "needs", label: "Needs allocation" }]}]} />);
    fireEvent.change(screen.getByLabelText("Allocation"), { target: { value: "" } });
    expect(mocks.replace).toHaveBeenCalledWith(`/app/repayments?q=Cash&${timezoneQuery}#record-list`, { scroll: false });
    expect(mocks.replace.mock.calls[0][0]).not.toContain("allocation=");
    allocationView.unmount();
  });

  it("synchronizes controls from external URL changes and cancels work on unmount", () => {
    const { rerender, unmount } = render(<LiveRecordFilters {...baseProps} />);
    const input = screen.getByLabelText("Search outings");
    fireEvent.change(input, { target: { value: "pending" } });
    window.history.replaceState({}, "", "/app/outings?q=Back&assignment=assigned&month=2026-05#record-list");
    fireEvent(window, new PopStateEvent("popstate"));
    rerender(<LiveRecordFilters {...baseProps} search={{ ...baseProps.search, value: "Back" }} selects={[{ ...baseProps.selects[0], value: "assigned" }]} month={{ label: "Month", value: "2026-05" }} />);
    expect(screen.getByLabelText("Search outings")).toHaveValue("Back");
    expect(screen.getByLabelText("Assignment")).toHaveValue("assigned");
    expect(screen.getByLabelText("Month")).toHaveValue("2026-05");
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Apply filters", hidden: true })).not.toBeInTheDocument();
  });

  it("synchronizes the browser timezone once while preserving params, hash, and scroll behavior", () => {
    const getTimezoneOffset = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-420);
    window.history.replaceState({}, "", "/app/outings?q=Dinner&page=2&source=ledger#record-list");
    const view = render(<LiveRecordFilters {...baseProps} />);

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/app/outings?q=Dinner&page=2&source=ledger&tz=-420#record-list", { scroll: false });
    view.rerender(<LiveRecordFilters {...baseProps} />);
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    getTimezoneOffset.mockRestore();
  });

  it("does not navigate when the browser timezone query is already correct", () => {
    render(<LiveRecordFilters {...baseProps} />);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
