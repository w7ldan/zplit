import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRecordFilters } from "./live-record-filters";

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

const baseProps = {
  action: "/app/outings",
  search: { label: "Search outings", placeholder: "Outing title", value: "" },
  selects: [{ name: "assignment", label: "Assignment", value: "all", options: [{ value: "all", label: "All" }, { value: "assigned", label: "Assigned" }] }],
  month: { label: "Month", value: "" },
  preservedParams: { task: "open", page: "3" },
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.replace.mockReset();
  window.history.replaceState({}, "", "/app/outings?page=3&task=open#record-list");
});

afterEach(() => vi.useRealTimers());

describe("LiveRecordFilters", () => {
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
    expect(mocks.replace).toHaveBeenCalledWith("/app/outings?task=open&q=Dinner#record-list", { scroll: false });
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
    expect(mocks.replace).toHaveBeenCalledWith("/app/outings?q=%E6%9D%B1%E4%BA%AC&task=open&month=2026-04#record-list", { scroll: false });
  });

  it("synchronizes controls from external URL changes and cancels work on unmount", () => {
    const { rerender, unmount } = render(<LiveRecordFilters {...baseProps} />);
    const input = screen.getByLabelText("Search outings");
    fireEvent.change(input, { target: { value: "pending" } });
    rerender(<LiveRecordFilters {...baseProps} search={{ ...baseProps.search, value: "Back" }} selects={[{ ...baseProps.selects[0], value: "assigned" }]} month={{ label: "Month", value: "2026-05" }} />);
    expect(screen.getByLabelText("Search outings")).toHaveValue("Back");
    expect(screen.getByLabelText("Assignment")).toHaveValue("assigned");
    expect(screen.getByLabelText("Month")).toHaveValue("2026-05");
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Apply filters", hidden: true })).not.toBeInTheDocument();
  });
});
