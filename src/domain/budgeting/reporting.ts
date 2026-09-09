export type BudgetDirection = "outflow" | "inflow";

export type BudgetAppliedAmount = {
  direction: BudgetDirection;
  amount: number;
};

export function sumBudgetAppliedAmounts(amounts: BudgetAppliedAmount[]) {
  return amounts.reduce((totals, item) => {
    totals[item.direction] += item.amount;
    return totals;
  }, { outflow: 0, inflow: 0 });
}

export function netBudgetSpent(outflowApplied: number, inflowApplied: number) {
  return outflowApplied - inflowApplied;
}

export function remainingBudget(totalBudget: number, netSpent: number) {
  return totalBudget - netSpent;
}

export function categoryNetSpent(outflowApplied: number, inflowApplied: number) {
  return outflowApplied - inflowApplied;
}
