import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { friends } from "@/db/schema";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";

type Friend = InferSelectModel<typeof friends>;

type FriendBalance = { assignedAmount: number; repaidAmount: number; outstandingAmount: number };

export function FriendRow({ friend, balance, emphasized = false }: { friend: Friend; balance?: FriendBalance; emphasized?: boolean }) {
  const archived = friend.archivedAt !== null;
  return (
    <article className={`friend-row${archived ? " friend-row--archived" : ""}${emphasized ? " friend-row--created" : ""}`} data-record-id={friend.id}>
      <div className="friend-row__primary">
        <span className="friend-row__index technical-label" aria-hidden="true">FRIEND</span>
        <div>
          <h2><Link href={`/app/friends/${friend.id}`}>{friend.name}</Link></h2>
          {friend.phoneNumber ? <p className="friend-row__phone">{friend.phoneNumber}</p> : null}
        </div>
      </div>
      <div className="friend-row__meta">
        <span className="friend-row__state"><span className="technical-label">State</span>{archived ? "ARCHIVED" : "ACTIVE"}</span>
        <span className="friend-row__created"><span className="technical-label">Created</span><LocalDateTime iso={friend.createdAt.toISOString()} mode="date" /></span>
        {balance ? <span className="friend-row__outstanding"><span className="technical-label">Outstanding</span><strong>{formatRupiah(balance.outstandingAmount)}</strong></span> : <span className="friend-row__outstanding" />}
        <Link className="friend-row__edit" href={`/app/friends/${friend.id}`}>Edit record <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
