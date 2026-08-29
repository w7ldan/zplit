import Link from "next/link";
import { GroupAvatar } from "@/components/groups/group-avatar";
import type { GroupSummary } from "@/domain/group-contracts";
import { formatRupiah } from "@/domain/rupiah";

function roleLabel(role: string) {
  return role[0]?.toUpperCase() + role.slice(1);
}

type GroupCardProps = {
  group: GroupSummary;
  balance?: { youOwe: number; owedToYou: number };
};

export function GroupCard({ group, balance }: GroupCardProps) {
  return (
    <Link
      className="group-card"
      href={`/app/personal/groups/${group.id}`}
    >
      <GroupAvatar
        groupId={group.id}
        customAvatar={group.avatar}
        size="md"
        decorative
      />
      <span className="group-card__details">
        <strong>{group.name}</strong>
        <span>
          {roleLabel(group.role)} · {group.participantCount}{" "}
          {group.participantCount === 1 ? "participant" : "participants"}
        </span>
        {balance ? (
          <span className="group-card__balance">
            {balance.youOwe > 0 ? (
              <span>
                You owe <strong>{formatRupiah(balance.youOwe)}</strong>
              </span>
            ) : null}
            {balance.owedToYou > 0 ? (
              <span>
                Owed to you <strong>{formatRupiah(balance.owedToYou)}</strong>
              </span>
            ) : null}
            {balance.youOwe === 0 && balance.owedToYou === 0 ? (
              <span>Settled up</span>
            ) : null}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
