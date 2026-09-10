import { isValidBudgetDate } from "./dates";

export type BudgetRecurringFrequency = "every_budget_period" | "monthly";
export type BudgetRecurringOccurrenceStatus = "due" | "recorded" | "skipped";

/**
 * Maximum active (non-archived) recurring templates per budget owner.
 * Authoritative creation enforces this under the owner's BudgetProfile lock,
 * so bounded active-template reads (which use this same cap) stay complete.
 */
export const MAX_ACTIVE_RECURRING_TEMPLATES = 200;

export type BudgetRecurringRule = {
  frequency: BudgetRecurringFrequency;
  startsOn: string;
};

export type BudgetRecurringTemplateRule = BudgetRecurringRule & {
  id: string;
  name: string;
  amount: number;
  categoryId: string;
  spreadCount: number;
};

export type BudgetRecurringCandidate = {
  templateId: string;
  name: string;
  amount: number;
  categoryId: string;
  spreadCount: number;
  frequency: BudgetRecurringFrequency;
  scheduledOn: string;
};

export type BudgetRecurringTransitionSelection = {
  templateId: string;
  scheduledOn: string;
  selected: boolean;
  categoryId: string | null;
};

export function budgetRecurringFrequencyLabel(frequency: BudgetRecurringFrequency) {
  return frequency === "monthly" ? "Monthly" : "Every budget period";
}

export function recurringCandidateKey(templateId: string, scheduledOn: string) {
  return `${templateId}|${scheduledOn}`;
}

function parseDateOnly(value: string) {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function dateOnly(year: number, month: number, day: number) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Pure date-only recurrence math. Callers pass canonical `YYYY-MM-DD` strings;
 * no timestamp or timezone conversion participates in scheduling.
 */
export function scheduledRecurringDates(rule: BudgetRecurringRule, period: { startsOn: string; endsOn: string }): string[] {
  if (!isValidBudgetDate(rule.startsOn) || !isValidBudgetDate(period.startsOn) || !isValidBudgetDate(period.endsOn) || period.startsOn > period.endsOn) return [];

  if (rule.frequency === "every_budget_period") {
    const scheduledOn = rule.startsOn > period.startsOn ? rule.startsOn : period.startsOn;
    return scheduledOn <= period.endsOn ? [scheduledOn] : [];
  }
  if (rule.frequency !== "monthly") return [];

  const anchorDay = parseDateOnly(rule.startsOn).day;
  const start = parseDateOnly(period.startsOn);
  const end = parseDateOnly(period.endsOn);
  const dates: string[] = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    const day = Math.min(anchorDay, daysInMonth(year, month));
    const candidate = dateOnly(year, month, day);
    if (candidate >= rule.startsOn && candidate >= period.startsOn && candidate <= period.endsOn) dates.push(candidate);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return dates;
}

export function buildRecurringCandidates(
  templates: readonly BudgetRecurringTemplateRule[],
  period: { startsOn: string; endsOn: string },
): BudgetRecurringCandidate[] {
  return templates
    .flatMap((template) => scheduledRecurringDates(template, period).map((scheduledOn) => ({
      templateId: template.id,
      name: template.name,
      amount: template.amount,
      categoryId: template.categoryId,
      spreadCount: template.spreadCount,
      frequency: template.frequency,
      scheduledOn,
    })))
    .sort((left, right) => left.scheduledOn.localeCompare(right.scheduledOn)
      || left.name.localeCompare(right.name)
      || left.templateId.localeCompare(right.templateId));
}

export function resolveRecurringOccurrenceCategory(templateCategoryId: string, planCategoryIds: ReadonlySet<string>, uncategorizedId: string) {
  return planCategoryIds.has(templateCategoryId) ? templateCategoryId : uncategorizedId;
}
