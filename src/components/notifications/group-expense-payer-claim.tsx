import Link from "next/link";

export function GroupExpensePayerClaimActions({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  return <div className="notification-row__actions"><Link className="text-link" href={`/app/personal/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`}>Review expense</Link></div>;
}
