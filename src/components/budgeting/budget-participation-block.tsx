export type BudgetParticipationView =
  | { status: "included"; transactionId: string; categoryId: string | null; categoryName: string }
  | { status: "not_included" }
  | { status: "unprocessed" };

/**
 * Post-creation private Budget state for one included or explicitly excluded
 * expense source. Participation is immutable here: an included source only
 * exposes its category, and an excluded source only states that it is out.
 */
export function BudgetParticipationBlock({
  participation,
  categories,
  description,
  action,
}: {
  participation: BudgetParticipationView;
  categories: Array<{ id: string; name: string }>;
  description: string;
  action: (formData: FormData) => Promise<void>;
}) {
  if (participation.status === "unprocessed") return null;
  return (
    <div className="budget-participation" aria-label="Budget">
      <span className="technical-label">Budget</span>
      {participation.status === "not_included" ? (
        <p className="budget-participation__excluded">Not included</p>
      ) : (
        <div className="budget-participation__category">
          <span>Category</span>
          <strong>{participation.categoryName}</strong>
          <details className="budget-category-change">
            <summary className="action-link action-link--quiet" aria-label={`Change budget category for ${description}`}>Change</summary>
            <form action={action}>
              <input type="hidden" name="transactionId" value={participation.transactionId} />
              <label className="sr-only" htmlFor={`budget-participation-${participation.transactionId}`}>Budget category for {description}</label>
              <select id={`budget-participation-${participation.transactionId}`} name="categoryId" defaultValue={participation.categoryId ?? categories[0]?.id}>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <button className="action-link action-link--quiet" type="submit" aria-label={`Save budget category for ${description}`}>Save category</button>
            </form>
          </details>
        </div>
      )}
    </div>
  );
}
