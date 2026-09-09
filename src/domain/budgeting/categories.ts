export function normalizeBudgetCategoryName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function canonicalBudgetCategoryName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function validateBudgetCategoryNames(names: string[]) {
  const normalized = names.map(normalizeBudgetCategoryName);
  return normalized.every(Boolean) && new Set(normalized).size === normalized.length && !normalized.includes("uncategorized");
}
