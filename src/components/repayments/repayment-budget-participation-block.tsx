import { formatRupiah } from "@/domain/rupiah";
import type { PersonalRepaymentBudgetState } from "@/server/budgeting/sources-personal";

export function RepaymentBudgetParticipationBlock({
  participation,
  repaymentId,
  actualAmount,
  action,
}: {
  participation: PersonalRepaymentBudgetState;
  repaymentId: string;
  actualAmount: number;
  action: (repaymentId: string, formData: FormData) => Promise<void>;
}) {
  if (participation.status === "unprocessed") return null;
  const included = participation.status === "included";
  return (
    <section className="budget-participation repayment-budget-participation" id="repayment-budget" aria-labelledby="repayment-budget-heading">
      <span className="technical-label" id="repayment-budget-heading">Budget</span>
      <div className="budget-participation__state">
        <span>Count toward Budget</span>
        <strong>{included ? "Included" : "Not included"}</strong>
      </div>
      <dl className="repayment-budget-participation__amounts">
        <div><dt>Actual repayment</dt><dd>{formatRupiah(actualAmount)}</dd></div>
        {included ? <div><dt>Applied to Budget</dt><dd>{formatRupiah(participation.appliedAmount)}</dd></div> : null}
      </dl>
      <form action={action.bind(null, repaymentId)}>
        <input type="hidden" name="includeInBudget" value={included ? "0" : "1"} />
        <button className="action-link action-link--quiet" type="submit">{included ? "Exclude from Budget" : "Include in Budget"}</button>
      </form>
    </section>
  );
}
