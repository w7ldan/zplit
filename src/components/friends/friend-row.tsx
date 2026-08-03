import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { friends } from "@/db/schema";

type Friend = InferSelectModel<typeof friends>;

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function FriendRow({ friend }: { friend: Friend }) {
  const archived = friend.archivedAt !== null;
  return (
    <article className={`friend-row${archived ? " friend-row--archived" : ""}`}>
      <div className="friend-row__primary">
        <span className="friend-row__index technical-label" aria-hidden="true">FRIEND</span>
        <div>
          <h2><Link href={`/app/friends/${friend.id}`}>{friend.name}</Link></h2>
          {friend.phoneNumber ? <p className="friend-row__phone">{friend.phoneNumber}</p> : null}
        </div>
      </div>
      <div className="friend-row__meta">
        <span className="technical-label">{archived ? "ARCHIVED" : "ACTIVE"}</span>
        <time dateTime={friend.createdAt.toISOString()}>{formatDate(friend.createdAt)}</time>
        <Link className="friend-row__edit" href={`/app/friends/${friend.id}`}>Edit record <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
