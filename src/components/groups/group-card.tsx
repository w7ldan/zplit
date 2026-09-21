import Link from "next/link";
import { GroupAvatar } from "@/components/groups/group-avatar";
import { OpenTile } from "@/components/vnext/open-tile";
import type { GroupSummary } from "@/domain/group-contracts";
import { formatRupiah } from "@/domain/rupiah";

function roleLabel(role: string) {
  return role[0]?.toUpperCase() + role.slice(1);
}

type GroupCardProps = {
  group: GroupSummary;
  balance?: { youOwe: number; owedToYou: number };
  vnext?: boolean;
};

export function GroupCard({ group, balance, vnext = false }: GroupCardProps) {
  if (!vnext) {
    return (
      <Link className="group-card" href={`/app/personal/groups/${group.id}`}>
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

  return (
    <Link
      className="group-card vnext-row"
      href={`/app/personal/groups/${group.id}`}
      aria-label={group.name}
    >
      <GroupAvatar
        groupId={group.id}
        customAvatar={group.avatar}
        size="md"
        decorative
      />
      <span className="group-card__details">
        <strong className="group-card__name">{group.name}</strong>
        {group.description ? <span className="group-card__description">{group.description}</span> : null}
      </span>
      <span className="group-card__context">
        <span>
          {roleLabel(group.role)} · {group.participantCount}{" "}
          {group.participantCount === 1 ? "participant" : "participants"}
        </span>
        <span>{group.archivedAt ? "Archived" : "Peer-to-peer Group"}</span>
      </span>
      <span className="group-card__balance">
        {balance && (balance.youOwe > 0 || balance.owedToYou > 0) ? (
          <>
            <span className="group-card__position group-card__position--debt">
              <span>You owe</span>
              <strong>{formatRupiah(balance.youOwe)}</strong>
            </span>
            <span className="group-card__position group-card__position--settled">
              <span>Owed to you</span>
              <strong>{formatRupiah(balance.owedToYou)}</strong>
            </span>
          </>
        ) : balance ? (
          <span className="group-card__position group-card__position--settled">
            <span>Position</span>
            <strong>Settled</strong>
          </span>
        ) : null}
      </span>
      <OpenTile />
    </Link>
  );
}
