import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { outings } from "@/db/schema";
import { LocalDateTime } from "@/components/editorial/local-date-time";

export function OutingRow({ outing }: { outing: InferSelectModel<typeof outings> }) {
  return (
    <article className="outing-row">
      <div className="outing-row__primary">
        <span className="technical-label">OUTING</span>
        <h2><Link href={`/app/outings/${outing.id}`}>{outing.title}</Link></h2>
      </div>
      <div className="outing-row__meta">
        <LocalDateTime iso={outing.occurredAt.toISOString()} />
        <span className="technical-label">CREATED <LocalDateTime iso={outing.createdAt.toISOString()} mode="date" /></span>
        <Link className="outing-row__edit" href={`/app/outings/${outing.id}`}>Edit <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
