"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import type { RepaymentAllocationPlan, RepaymentAllocationReversalReceipt } from "@/domain/ledger-repository";
import { formatRupiah, parseRupiah } from "@/domain/rupiah";
import type {
  RepaymentAllocationActionState,
  RepaymentAllocationRemovalActionState,
  RepaymentAllocationUndoState,
} from "@/app/app/repayments/actions";
import { useToast } from "@/components/feedback/toast";
import { ChangedValue } from "@/components/expenses/expense-share-editor";
import { RecordPagination } from "@/components/records/record-pagination";

type RepaymentAllocationAction = (
  previousState: RepaymentAllocationActionState,
  formData: FormData,
) => Promise<RepaymentAllocationActionState>;

type RepaymentAllocationRemovalAction = (
  previousState: RepaymentAllocationRemovalActionState,
  formData: FormData,
) => Promise<RepaymentAllocationRemovalActionState>;

type RepaymentAllocationRemovalActionFactory = (
  repaymentId: string,
  expenseShareId: string,
  previousState: RepaymentAllocationRemovalActionState,
  formData: FormData,
) => Promise<RepaymentAllocationRemovalActionState>;

type RepaymentAllocationEditorProps = {
  action: RepaymentAllocationAction;
  plan: RepaymentAllocationPlan;
  allocationQuery?: string;
  allocationPage?: number;
  removeAction?: RepaymentAllocationRemovalActionFactory;
  undoAction?: (receipt: RepaymentAllocationReversalReceipt) => Promise<RepaymentAllocationUndoState>;
};

const emptyActionState: RepaymentAllocationActionState = { fieldErrors: {}, formError: "", values: [] };
const emptyRemovalActionState: RepaymentAllocationRemovalActionState = { formError: "" };

function initialValues(plan: RepaymentAllocationPlan) {
  return plan.shares.map((share) => ({
    expenseShareId: share.expenseShareId,
    amountRupiah: share.currentAllocation ? share.currentAllocation.toString() : "",
  }));
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="action-link action-link--primary repayment-allocation-editor__submit" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Saving allocations…" : "Save allocations"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <p
      className="repayment-allocation-editor__field-error"
      id={id}
      role={message ? "alert" : undefined}
    >
      {message || "\u00a0"}
    </p>
  );
}

function RemoveAllocationButton({ pending, onRemove }: { pending: boolean; onRemove: () => void }) {
  return (
    <button
      className="action-link action-link--quiet"
      type="button"
      onClick={onRemove}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Removing allocation…" : "Remove allocation"}
    </button>
  );
}

function RemoveAllocationForm({
  action,
  undoAction,
  onRemoved,
  onUndone,
}: {
  action: RepaymentAllocationRemovalAction;
  undoAction: (
    receipt: RepaymentAllocationReversalReceipt,
  ) => Promise<RepaymentAllocationUndoState>;
  onRemoved: (receipt: RepaymentAllocationReversalReceipt) => void;
  onUndone: (receipt: RepaymentAllocationReversalReceipt) => void;
}) {
  const [state, setState] = useState(emptyRemovalActionState);
  const [, startTransition] = useTransition();
  const [removalPending, setRemovalPending] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();
  const handledReceipt = useRef<string | undefined>(undefined);

  const remove = () => {
    if (removalPending || refreshPending) return;
    setRemovalPending(true);
    startTransition(async () => {
      try {
        const result = await action(state, new FormData());
        setState(result);
        if (result.removalReceipt) {
          onRemoved(result.removalReceipt);
          setRefreshPending(true);
          router.refresh();
        }
      } finally {
        setRemovalPending(false);
      }
    });
  };

  useEffect(() => {
    const receipt = state.removalReceipt;
    if (!receipt) return;
    const receiptKey = `${receipt.version}:${receipt.reversalId}:${receipt.allocationId}:${receipt.repaymentId}:${receipt.expenseShareId}:${receipt.friendId}:${receipt.amount}`;
    if (handledReceipt.current === receiptKey) return;
    handledReceipt.current = receiptKey;
    showToast({
      message: "Allocation removed",
      action: {
        label: "Undo",
        onAction: async () => {
          try {
            const result = await undoAction(receipt);
            if (!result.ok) return result.message;
            onUndone(receipt);
            setRefreshPending(false);
            router.refresh();
          } catch {
            return "Undo unavailable: the allocation could not be restored.";
          }
        },
      },
    });
  }, [onUndone, router, showToast, state.removalReceipt, undoAction]);

  return (
    <div>
      <RemoveAllocationButton pending={removalPending || refreshPending} onRemove={remove} />
      {state.formError ? <p className="repayment-allocation-editor__message" role="alert">{state.formError}</p> : null}
    </div>
  );
}

export function RepaymentAllocationEditor({
  action,
  plan,
  allocationQuery,
  allocationPage: requestedAllocationPage,
  removeAction,
  undoAction,
  basePath = "/app",
}: RepaymentAllocationEditorProps & { basePath?: string }) {
  const allocationPage = plan.sharePage ?? {
    items: plan.shares,
    page: requestedAllocationPage ?? 1,
    pageSize: 10,
    totalItems: plan.shares.length,
    totalPages: 1,
  };
  const values = initialValues(plan);
  const [state, formAction] = useActionState(action, {
    ...emptyActionState,
    values,
  });
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>(
    () => Object.fromEntries(values.map((value) => [value.expenseShareId, value.amountRupiah])),
  );
  const visibleCurrentAllocation = plan.shares.reduce((total, share) => total + share.currentAllocation, 0);
  const preservedAllocationAmount = plan.allocatedAmount - visibleCurrentAllocation;
  const allocatedAmount = preservedAllocationAmount + plan.shares.reduce((total, share) => total + (parseRupiah(draftAmounts[share.expenseShareId] ?? "") ?? 0), 0);
  const overAllocated = allocatedAmount > plan.amount;
  const unallocatedAmount = Math.max(plan.amount - allocatedAmount, 0);
  const allocationProgress = plan.amount > 0 ? Math.min(Math.max(allocatedAmount / plan.amount, 0), 1) : 0;
  const [completionTransition, setCompletionTransition] = useState(false);
  const previousIncomplete = useRef(unallocatedAmount > 0 || overAllocated);

  useEffect(() => {
    const incomplete = unallocatedAmount > 0 || overAllocated;
    const completed = !incomplete && previousIncomplete.current;
    setCompletionTransition(completed);
    previousIncomplete.current = incomplete;
    if (!completed) return;
    const timer = window.setTimeout(() => setCompletionTransition(false), 400);
    return () => window.clearTimeout(timer);
  }, [overAllocated, unallocatedAmount]);

  const search = (
    <form className="repayment-allocation-editor__search" method="get">
      <label htmlFor="repayment-allocation-search">Search allocation choices</label>
      <div>
        <input id="repayment-allocation-search" name="q" type="search" defaultValue={allocationQuery ?? ""} placeholder="Expense, outing, or exact amount" />
        <button className="action-link action-link--quiet" type="submit">Search</button>
      </div>
    </form>
  );

  if (allocationPage.items.length === 0) {
    return (
      <div className="repayment-allocation-editor repayment-allocation-editor--empty">
        <p className="technical-label">REPAYMENT ALLOCATIONS</p>
        {search}
        <p>{allocationQuery ? "No matching expense shares." : "No outstanding shares for this friend."}</p>
        {allocationQuery ? (
          <Link
            className="action-link"
            href={`${basePath}/repayments/${plan.id}#repayment-allocations`}
          >
            Clear search
          </Link>
        ) : (
          <Link className="action-link" href={`${basePath}/expenses`}>
            Go to Expenses <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    );
  }

  const setRemovedDraftAmount = (receipt: RepaymentAllocationReversalReceipt) => setDraftAmounts((current) => ({ ...current, [receipt.expenseShareId]: "" }));
  const restoreDraftAmount = (receipt: RepaymentAllocationReversalReceipt) => setDraftAmounts((current) => ({ ...current, [receipt.expenseShareId]: receipt.amount.toString() }));

  return (
    <div className="repayment-allocation-editor">
      <p className="technical-label">REPAYMENT ALLOCATIONS</p>
      <h2>Apply the received money</h2>
      {search}
      <div className="repayment-allocation-editor__totals" aria-live="polite">
        <div><span className="technical-label">Repayment amount</span><strong>{formatRupiah(plan.amount)}</strong></div>
        <div><span className="technical-label">Applied to shares</span><strong><ChangedValue value={allocatedAmount}>{formatRupiah(allocatedAmount)}</ChangedValue></strong></div>
        <div><span className="technical-label">Needs allocation</span><strong><ChangedValue value={unallocatedAmount}>{formatRupiah(unallocatedAmount)}</ChangedValue></strong></div>
      </div>
      <div
        className={`allocation-bar${overAllocated ? " allocation-bar--error" : ""}`}
        aria-label="Repayment allocation progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={plan.amount}
        aria-valuenow={Math.min(allocatedAmount, plan.amount)}
      >
        <span className="allocation-bar__track">
          <span
            className="allocation-bar__fill"
            style={{ transform: `scaleX(${allocationProgress})` }}
          />
        </span>
        <span
          className={
            completionTransition
              ? "allocation-bar__message allocation-bar__message--complete"
              : "allocation-bar__message"
          }
        >
          {overAllocated
            ? `Over-allocated by ${formatRupiah(allocatedAmount - plan.amount)}.`
            : unallocatedAmount > 0
              ? `${formatRupiah(unallocatedAmount)} needs allocation. Only applied money reduces outstanding balances.`
              : "This repayment is fully applied. Applied money reduces outstanding balances."}
        </span>
      </div>
      <form className="repayment-allocation-editor__form" action={formAction} noValidate>
        <input type="hidden" name="allocationPage" value={allocationPage.page} />
        <input type="hidden" name="allocationQuery" value={allocationQuery ?? ""} />
        <p className="repayment-allocation-editor__help">Enter a whole-rupiah amount. A blank field removes this allocation.</p>
        {plan.shares.map((share) => {
          const fieldErrorId = `repayment-allocation-${share.expenseShareId}-error`;
          const helpId = `repayment-allocation-${share.expenseShareId}-help`;
          return (
            <div className="repayment-allocation-editor__row" key={share.expenseShareId}>
              <div className="repayment-allocation-editor__details">
                <p className="repayment-allocation-editor__description">{share.expenseDescription}</p>
                <p className="repayment-allocation-editor__outing">
                  {share.outingTitle} · <LocalDateTime iso={share.outingOccurredAt.toISOString()} mode="date" />
                </p>
                <div className="repayment-allocation-editor__available">
                  <span>Available</span>
                  <strong>{formatRupiah(share.capacityAvailable)}</strong>
                </div>
                <details className="repayment-allocation-editor__details-disclosure">
                  <summary>Allocation details</summary>
                  <dl>
                    <div>
                      <dt>Original owed</dt>
                      <dd>{formatRupiah(share.amountOwed)}</dd>
                    </div>
                    <div>
                      <dt>Other repayments</dt>
                      <dd>{formatRupiah(share.allocatedByOtherRepayments)}</dd>
                    </div>
                    <div>
                      <dt>Available</dt>
                      <dd>{formatRupiah(share.capacityAvailable)}</dd>
                    </div>
                  </dl>
                </details>
              </div>
              <div className="repayment-allocation-editor__field">
                <input type="hidden" name="expenseShareId" value={share.expenseShareId} />
                <label htmlFor={`repayment-allocation-${share.expenseShareId}`}>Allocate</label>
                <input
                  id={`repayment-allocation-${share.expenseShareId}`}
                  name="amountRupiah"
                  type="text"
                  inputMode="numeric"
                  aria-label={`Amount to allocate to ${share.expenseDescription}`}
                  value={draftAmounts[share.expenseShareId] ?? ""}
                  onChange={(event) =>
                    setDraftAmounts((current) => ({
                      ...current,
                      [share.expenseShareId]: event.target.value,
                    }))
                  }
                  aria-invalid={Boolean(state.fieldErrors[share.expenseShareId])}
                  aria-describedby={`${helpId} ${fieldErrorId}`}
                  autoComplete="off"
                />
                <p className="repayment-allocation-editor__help" id={helpId}>Blank removes this allocation.</p>
                <FieldError id={fieldErrorId} message={state.fieldErrors[share.expenseShareId]} />
                {share.currentAllocation > 0 && removeAction && undoAction ? (
                  <RemoveAllocationForm
                    action={removeAction.bind(null, plan.id, share.expenseShareId)}
                    undoAction={undoAction}
                    onRemoved={setRemovedDraftAmount}
                    onUndone={restoreDraftAmount}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
        <p
          className="repayment-allocation-editor__message"
          role={state.formError ? "alert" : undefined}
          aria-live="polite"
        >
          {state.formError || "\u00a0"}
        </p>
        <SubmitButton />
      </form>
      <RecordPagination
        page={allocationPage.page}
        pageSize={allocationPage.pageSize}
        totalItems={allocationPage.totalItems}
        totalPages={allocationPage.totalPages}
        href={`${basePath}/repayments/${plan.id}${allocationQuery ? `?q=${encodeURIComponent(allocationQuery)}` : ""}`}
        anchor="repayment-allocations"
      />
    </div>
  );
}
