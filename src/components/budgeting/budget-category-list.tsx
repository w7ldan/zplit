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
      {categories.map((category) => (
        <div className="budget-category-row" key={category.id}>
          <div>
            <strong>{category.name}</strong>
            {category.note ? <small>{category.note}</small> : null}
          </div>
          <span>{formatRupiah(category.allocatedAmount)}</span>
          <span>{formatSignedRupiah(category.netSpent)}</span>
          <strong>{formatSignedRupiah(category.remaining)}</strong>
        </div>
      ))}
    </div>
  );
}
