import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import { formatRupiah } from "@/domain/rupiah";

export type BudgetCategoryListRow = {
  id: string;
  name: string;
  note?: string | null;
  allocatedAmount: number;
  netSpent: number;
  remaining: number;
};

export function BudgetCategoryList({ categories }: { categories: readonly BudgetCategoryListRow[] }) {
  return (
    <div className="budget-category-list">
      <div className="budget-ledger-header budget-category-list__header" aria-hidden="true">
        <span>Category</span>
        <span>Allocated</span>
        <span>Used</span>
        <span>Remaining</span>
      </div>
      {categories.map((category) => (
        <div className="budget-category-row" key={category.id}>
          <div className="budget-category-row__identity">
            <strong>{category.name}</strong>
            {category.note ? <small>{category.note}</small> : null}
          </div>
          <span className="budget-category-row__allocated">{formatRupiah(category.allocatedAmount)}</span>
          <span className="budget-category-row__spent">{formatSignedRupiah(category.netSpent)}</span>
          <strong className="budget-category-row__remaining">{formatSignedRupiah(category.remaining)}</strong>
        </div>
      ))}
    </div>
  );
}
