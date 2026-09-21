import Link from "next/link";
import { OpenTile } from "@/components/vnext/open-tile";

export function GroupExpensePayerClaimActions({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  return <div className="notification-row__actions"><Link className="notification-row__destination" href={`/app/personal/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`}>Review expense<OpenTile /></Link></div>;
}
