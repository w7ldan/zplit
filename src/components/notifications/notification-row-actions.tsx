import Link from "next/link";
import type { InboxRowAction } from "@/server/inbox";
import { FriendLinkRequestActions } from "./friend-link-request";
import { OrganizationInvitationActions } from "./organization-invitation";
import { GroupJoinRequestActions } from "./group-join-request";
import { GroupExpensePayerClaimActions } from "./group-expense-payer-claim";

export function NotificationRowActions({ action }: { action: InboxRowAction }) {
  if (!action) return null;
  switch (action.kind) {
    case "friend":
      return <FriendLinkRequestActions requestId={action.requestId} status={action.status} />;
    case "organization":
      return <OrganizationInvitationActions invitationId={action.invitationId} status={action.status} />;
    case "group":
      return (
        <GroupJoinRequestActions
          requestId={action.requestId}
          kind={action.requestKind}
          status={action.status}
        />
      );
    case "expense":
      return <GroupExpensePayerClaimActions groupId={action.groupId} expenseId={action.expenseId} />;
    case "link":
      return <Link className="text-link" href={action.href}>{action.label}</Link>;
  }
}
