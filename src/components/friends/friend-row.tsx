import Link from "next/link";
import { unlinkFriendLinkRequestAction } from "@/app/app/inbox/actions";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import type { FriendConnectionListRecord, FriendListRecord } from "@/domain/ledger/types";
import { formatRupiah } from "@/domain/rupiah";
import { OpenTile } from "@/components/vnext/open-tile";

type FriendBalance = { assignedAmount: number; repaidAmount: number; outstandingAmount: number };

type FriendRowProps = { friend: FriendListRecord | FriendConnectionListRecord; balance?: FriendBalance; emphasized?: boolean; basePath?: string; vnext?: boolean };

function LegacyFriendRow({ friend, balance, emphasized = false, basePath = "/app/friends" }: Omit<FriendRowProps, "vnext">) {
  if ("requestId" in friend) {
    return (
      <article className="friend-row" data-connection-id={friend.id}>
        <div className="friend-row__primary">
          <span className="friend-row__index technical-label" aria-hidden="true">FRIEND</span>
          <div>
            <h2>{friend.name}</h2>
            <p className="friend-row__phone">@{friend.username}</p>
          </div>
        </div>
        <div className="friend-row__meta">
          <span className="friend-row__state"><span className="technical-label">State</span>ACTIVE</span>
          <details className="friend-link__unlink">
            <summary className="friend-row__edit">Unlink</summary>
            <div>
              <p>Unlink @{friend.username}?</p>
              <p>This removes the Zplit account connection. Existing Friend balances and history remain unchanged.</p>
              <form action={unlinkFriendLinkRequestAction.bind(null, friend.requestId)}>
                <button className="action-link action-link--quiet" type="submit">Unlink</button>
              </form>
            </div>
          </details>
        </div>
      </article>
    );
  }
  const archived = friend.archivedAt !== null;
  return (
    <article className={`friend-row${archived ? " friend-row--archived" : ""}${emphasized ? " friend-row--created" : ""}`} data-record-id={friend.id}>
      <div className="friend-row__primary">
        <span className="friend-row__index technical-label" aria-hidden="true">FRIEND</span>
        <div>
          <h2><Link href={`${basePath}/${friend.id}`}>{friend.name}</Link></h2>
          {friend.phoneNumber ? <p className="friend-row__phone">{friend.phoneNumber}</p> : null}
          {friend.linkedUser ? <p className="friend-row__phone">@{friend.linkedUser.username}</p> : <p className="friend-row__phone">External</p>}
        </div>
      </div>
      <div className="friend-row__meta">
        <span className="friend-row__state"><span className="technical-label">State</span>{archived ? "ARCHIVED" : "ACTIVE"}</span>
        <span className="friend-row__created"><span className="technical-label">Created</span><LocalDateTime iso={friend.createdAt.toISOString()} mode="date" /></span>
        {balance ? <span className="friend-row__outstanding"><span className="technical-label">Outstanding</span><strong>{formatRupiah(balance.outstandingAmount)}</strong></span> : <span className="friend-row__outstanding" />}
        <Link className="friend-row__edit" href={`${basePath}/${friend.id}`}>Edit record <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}

export function FriendRow(props: FriendRowProps) {
  return props.vnext ? <VNextFriendRow {...props} /> : <LegacyFriendRow {...props} />;
}

function VNextFriendRow({ friend, balance, emphasized = false, basePath = "/app/friends" }: Omit<FriendRowProps, "vnext">) {
  if ("requestId" in friend) {
    return <article className="friend-row friend-row--connection personal-vnext__connection-row personal-vnext__motion-item" data-connection-id={friend.id} data-motion="list">
      <div className="friend-row__primary personal-vnext__row-primary">
        <span className="friend-row__index technical-label" aria-hidden="true">FRIEND</span>
        <div>
          <h2>{friend.name}</h2>
          <p className="friend-row__phone">@{friend.username}</p>
        </div>
      </div>
      <div className="friend-row__meta personal-vnext__row-meta">
        <span className="friend-row__state personal-vnext__metadata"><span className="technical-label">State</span>ACTIVE</span>
        <details className="friend-link__unlink">
          <summary className="friend-row__edit vnext-link">Unlink</summary>
          <div>
            <p>Unlink @{friend.username}?</p>
            <p>This removes the Zplit account connection. Existing Friend balances and history remain unchanged.</p>
            <form action={unlinkFriendLinkRequestAction.bind(null, friend.requestId)}>
              <button className="action-link action-link--quiet vnext-button vnext-button--secondary" type="submit">
                Unlink
              </button>
            </form>
          </div>
        </details>
      </div>
    </article>;
  }
  const archived = friend.archivedAt !== null;
  return (
    <Link className={`friend-row vnext-row personal-vnext__record-row${archived ? " friend-row--archived" : ""}${emphasized ? " friend-row--created" : ""}`} aria-label={friend.name} aria-describedby={`friend-row-${friend.id}-summary`} href={`${basePath}/${friend.id}`} data-record-id={friend.id} data-motion="list">
      <span className="sr-only" id={`friend-row-${friend.id}-summary`}>{archived ? "Archived friend" : "Active friend"}{balance ? `, outstanding ${formatRupiah(balance.outstandingAmount)}` : ""}</span>
      <div className="friend-row__primary personal-vnext__row-primary">
        <span className="friend-row__index technical-label" aria-hidden="true">FRIEND</span>
        <div>
          <h2>{friend.name}</h2>
          {friend.phoneNumber ? <p className="friend-row__phone">{friend.phoneNumber}</p> : null}
          {friend.linkedUser ? <p className="friend-row__phone">@{friend.linkedUser.username}</p> : <p className="friend-row__phone">External</p>}
        </div>
      </div>
      <div className="friend-row__meta personal-vnext__row-meta">
        <span className="friend-row__state personal-vnext__metadata"><span className="technical-label">State</span>{archived ? "ARCHIVED" : "ACTIVE"}</span>
        <span className="friend-row__created"><span className="technical-label">Created</span><LocalDateTime iso={friend.createdAt.toISOString()} mode="date" /></span>
        {balance ? <span className="friend-row__outstanding"><span className="technical-label">Outstanding</span><strong className="vnext-money">{formatRupiah(balance.outstandingAmount)}</strong></span> : <span className="friend-row__outstanding" />}
        <span className="friend-row__edit personal-vnext__row-action">Edit record <OpenTile className="personal-vnext__row-tile" /></span>
      </div>
    </Link>
  );
}
