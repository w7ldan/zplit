import { fireEvent, render, screen } from "@testing-library/react";
import Link from "next/link";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskPanel } from "@/components/app/task-panel";
import { UnsavedChangesProvider, useUnsavedChangesGuard } from "./unsaved-changes";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function GuardedLink({ dirty }: { dirty: boolean }) {
  useUnsavedChangesGuard(dirty);
  return <Link href="/app/friends">Friends</Link>;
}

function GuardedForm({ name, dirty, onSubmit }: { name: string; dirty: boolean; onSubmit: () => void }) {
  const guard = useUnsavedChangesGuard(dirty);
  return (
    <form aria-label={name} onSubmit={(event) => {
      const release = guard?.beginSubmission();
      if (!release) {
        event.preventDefault();
        return;
      }
      onSubmit();
    }}>
      <input aria-label={`${name} draft`} defaultValue="saved" />
      <button type="submit">Save {name}</button>
    </form>
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/app/expenses");
});

describe("unsaved changes guard", () => {
  it("does not ask for clean application navigation", () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    render(<UnsavedChangesProvider><GuardedLink dirty={false} /></UnsavedChangesProvider>);

    fireEvent.click(screen.getByRole("link", { name: "Friends" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("cancels guarded navigation without changing the draft", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<UnsavedChangesProvider><GuardedLink dirty /></UnsavedChangesProvider>);

    fireEvent.click(screen.getByRole("link", { name: "Friends" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Friends" })).toBeInTheDocument();
  });

  it("continues a confirmed navigation exactly once", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<UnsavedChangesProvider><GuardedLink dirty /></UnsavedChangesProvider>);

    fireEvent.click(screen.getByRole("link", { name: "Friends" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledWith("/app/friends");
  });

  it("cancels a form submission when another form is dirty and keeps both drafts", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const expenseSubmit = vi.fn();
    const splitSubmit = vi.fn();
    render(
      <UnsavedChangesProvider>
        <GuardedForm name="expense" dirty onSubmit={expenseSubmit} />
        <GuardedForm name="split" dirty onSubmit={splitSubmit} />
      </UnsavedChangesProvider>,
    );

    fireEvent.change(screen.getByLabelText("expense draft"), { target: { value: "expense draft" } });
    fireEvent.change(screen.getByLabelText("split draft"), { target: { value: "split draft" } });
    fireEvent.submit(screen.getByRole("form", { name: "expense" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(expenseSubmit).not.toHaveBeenCalled();
    expect(splitSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("expense draft")).toHaveValue("expense draft");
    expect(screen.getByLabelText("split draft")).toHaveValue("split draft");
  });

  it("confirms the other form once and submits exactly once in the reverse direction", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const expenseSubmit = vi.fn();
    const splitSubmit = vi.fn();
    render(
      <UnsavedChangesProvider>
        <GuardedForm name="expense" dirty onSubmit={expenseSubmit} />
        <GuardedForm name="split" dirty onSubmit={splitSubmit} />
      </UnsavedChangesProvider>,
    );

    fireEvent.submit(screen.getByRole("form", { name: "split" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(expenseSubmit).not.toHaveBeenCalled();
    expect(splitSubmit).toHaveBeenCalledOnce();
  });

  it("restores a cancelled browser history navigation", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    window.history.replaceState({}, "", "/app/expenses");
    render(<UnsavedChangesProvider><GuardedLink dirty /></UnsavedChangesProvider>);
    window.history.pushState({}, "", "/app/friends");
    fireEvent(window, new PopStateEvent("popstate"));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith("/app/expenses", { scroll: false });
  });

  it("adds beforeunload only while a guard is dirty", () => {
    const view = render(<UnsavedChangesProvider><GuardedLink dirty={false} /></UnsavedChangesProvider>);
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    fireEvent(window, cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    view.rerender(<UnsavedChangesProvider><GuardedLink dirty /></UnsavedChangesProvider>);
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    fireEvent(window, dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    view.unmount();
    const removedEvent = new Event("beforeunload", { cancelable: true });
    fireEvent(window, removedEvent);
    expect(removedEvent.defaultPrevented).toBe(false);
  });

  it("protects a TaskPanel close and preserves it when confirmation is cancelled", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(
      <UnsavedChangesProvider>
        <TaskPanel open title="Expense" description="Details" triggerId="expense-create">
          <GuardedLink dirty />
        </TaskPanel>
      </UnsavedChangesProvider>,
    );

    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(dialog).not.toHaveClass("task-panel--closing");
    expect(dialog.open).toBe(true);
  });

  it("allows a confirmed TaskPanel close without a second prompt", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(
      <UnsavedChangesProvider>
        <TaskPanel open title="Expense" description="Details" triggerId="expense-create">
          <GuardedLink dirty />
        </TaskPanel>
      </UnsavedChangesProvider>,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    fireEvent.transitionEnd(dialog, { propertyName: "transform" });

    expect(window.confirm).toHaveBeenCalledOnce();
    expect((dialog as HTMLDialogElement).open).toBe(false);
  });
});
