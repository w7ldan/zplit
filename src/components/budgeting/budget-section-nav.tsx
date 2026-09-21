import Link from "next/link";

export type BudgetSection = "dashboard" | "transactions" | "periods" | "subscriptions";

const budgetSections: Array<{ key: BudgetSection; href: string; label: string }> = [
  { key: "dashboard", href: "/app/personal/budget", label: "Overview" },
  { key: "transactions", href: "/app/personal/budget/transactions", label: "Transactions" },
  { key: "periods", href: "/app/personal/budget/periods", label: "Period history" },
  { key: "subscriptions", href: "/app/personal/budget/subscriptions", label: "Recurring" },
];

export function BudgetSectionNav({ current }: { current: BudgetSection }) {
  return (
    <nav className="budget-section-nav" aria-label="Budget sections">
      {budgetSections.map((section) => (
        <Link
          className="budget-section-nav__link"
          aria-current={section.key === current ? "page" : undefined}
          href={section.href}
          key={section.key}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
