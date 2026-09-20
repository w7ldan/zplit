import { ConfirmationDialog } from "@/components/app/delete-confirmation-dialog";

export type BudgetParticipationView =
  | { status: "included"; transactionId: string; categoryId: string | null; categoryName: string }
  | { status: "not_included" }
  | { status: "unprocessed" };

export function BudgetParticipationBlock({
  participation,
  categories,
  description,
  action,
  includeAction,
  excludeAction,
}: {
  participation: BudgetParticipationView;
  categories: Array<{ id: string; name: string }>;
  description: string;
  action: (formData: FormData) => Promise<void>;
  includeAction: (formData: FormData) => Promise<void>;
  excludeAction: (formData: FormData) => Promise<void>;
}) {
  if (participation.status === "unprocessed") return null;
  const defaultCategoryId = categories.find((category) => category.name === "Uncategorized")?.id ?? categories[0]?.id;
  return (
    <div className="budget-participation" aria-label="Budget">
      <span className="technical-label">Budget</span>
      {participation.status === "not_included" ? (
        <>
          <div className="budget-participation__state">
            <span>Included in Budget</span>
            <strong>No</strong>
          </div>
          <form action={includeAction} className="budget-participation__include">
            <input type="hidden" name="includeInBudget" value="1" />
            <label htmlFor={`budget-participation-include-${description}`}>Category when included</label>
            <select id={`budget-participation-include-${description}`} name="categoryId" defaultValue={defaultCategoryId}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <button className="action-link action-link--quiet" type="submit">Include in Budget</button>
          </form>
        </>
      ) : (
        <>
          <div className="budget-participation__state">
            <span>Included in Budget</span>
            <strong>Yes</strong>
          </div>
          <div className="budget-participation__category">
            <span>Category</span>
            <strong>{participation.categoryName}</strong>
            <details className="budget-category-change">
              <summary className="action-link action-link--quiet" aria-label={`Change budget category for ${description}`}>Change</summary>
              <form action={action}>
                <label className="sr-only" htmlFor={`budget-participation-${participation.transactionId}`}>Budget category for {description}</label>
                <select id={`budget-participation-${participation.transactionId}`} name="categoryId" defaultValue={participation.categoryId ?? categories[0]?.id}>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <button className="action-link action-link--quiet" type="submit" aria-label={`Save budget category for ${description}`}>Save category</button>
              </form>
            </details>
          </div>
          <ConfirmationDialog
            title="Exclude this expense from Budget?"
            entityName={description}
            confirmLabel="Exclude from Budget"
            pendingLabel="Excluding…"
            triggerLabel="Exclude from Budget"
            triggerAriaLabel={`Exclude ${description} from Budget`}
            description={`“${description}” remains in the ledger but stops affecting Budget. Repayments allocated to it also stop affecting Budget.`}
            action={excludeAction}
          />
        </>
      )}
    </div>
  );
}
