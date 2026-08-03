import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { outings } from "@/db/schema";

function formatOccurredAt(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatCreatedAt(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function OutingRow({ outing }: { outing: InferSelectModel<typeof outings> }) {
  return (
    <article className="outing-row">
      <div className="outing-row__primary">
        <span className="technical-label">OUTING</span>
        <h2><Link href={`/app/outings/${outing.id}`}>{outing.title}</Link></h2>
      </div>
      <div className="outing-row__meta">
        <time dateTime={outing.occurredAt.toISOString()}>{formatOccurredAt(outing.occurredAt)}</time>
        <span className="technical-label">CREATED {formatCreatedAt(outing.createdAt)}</span>
        <Link className="outing-row__edit" href={`/app/outings/${outing.id}`}>Edit <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
