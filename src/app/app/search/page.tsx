import Link from "next/link";
import type { Metadata } from "next";
import { zplitVNextFont } from "@/app/fonts";
import { SourceCalendarDate } from "@/components/editorial/local-date-time";
import { OpenTile } from "@/components/vnext/open-tile";
import type { GlobalSearchRecord } from "@/domain/ledger-repository";
import { formatRupiah } from "@/domain/rupiah";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search" };

type SearchParams = { q?: string | string[] };
type SearchKind = GlobalSearchRecord["kind"];

const resultKinds: readonly SearchKind[] = ["friend", "trip", "outing", "expense", "repayment"];
const kindLabels: Record<SearchKind, string> = {
  friend: "Friends",
  trip: "Trips",
  outing: "Outings",
  expense: "Expenses",
  repayment: "Repayments",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function hrefFor(record: GlobalSearchRecord) {
  return `/app/${record.kind === "friend" ? "friends" : `${record.kind}s`}/${encodeURIComponent(record.id)}`;
}

function detailFor(record: GlobalSearchRecord) {
  if (record.kind === "friend") return record.detail || record.context || null;
  if (record.kind === "trip") return record.detail || null;
  if (record.kind === "outing") return [record.context, record.date ? <SourceCalendarDate key="date" canonicalDate={record.calendarDate} timestamp={record.date} /> : null];
  if (record.kind === "expense") return record.detail || null;
  return record.date ? <SourceCalendarDate canonicalDate={record.calendarDate} timestamp={record.date} /> : null;
}

export default async function SearchPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const query = first(params.q)?.trim() ?? "";
  const { ledger } = await getAuthenticatedLedger();
  const results = query ? await ledger.searchGlobalRecords(query) : [];
  const groups = resultKinds
    .map((kind) => ({ kind, records: results.filter((record) => record.kind === kind) }))
    .filter(({ records }) => records.length > 0);

  return (
    <section className={`app-page search-page search-vnext zplit-vnext ${zplitVNextFont.variable}`} id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header search-vnext__header">
          <div>
            <p className="technical-label">Navigation · personal ledger</p>
            <h1>Search</h1>
            <p className="app-page__lede">Find a friend, outing, expense, repayment, or trip in your private ledger.</p>
          </div>
        </header>
        <form className="search-vnext__query" action="/app/search" method="get" role="search">
          <label htmlFor="search-query">Search records</label>
          <div className="search-vnext__query-control">
            <input id="search-query" name="q" type="search" defaultValue={query} placeholder="Search records" autoComplete="off" />
            <button className="vnext-button vnext-button--primary" type="submit">Search</button>
          </div>
        </form>
        <div className="search-vnext__context" aria-live="polite">
          {query ? `${results.length} ${results.length === 1 ? "result" : "results"} for “${query}”` : "Type a query to search your ledger."}
        </div>
        {query && groups.length > 0 ? (
          <div className="search-vnext__groups" id="search-results">
            {groups.map(({ kind, records }) => (
              <section className="search-vnext__group" aria-labelledby={`search-${kind}-heading`} key={kind}>
                <div className="search-vnext__group-heading">
                  <h2 id={`search-${kind}-heading`}>{kindLabels[kind]}</h2>
                  <span className="technical-label">{records.length} {records.length === 1 ? "match" : "matches"}</span>
                </div>
                <div className="search-vnext__results">
                  {records.map((record) => {
                    const detail = detailFor(record);
                    return (
                      <Link className="search-vnext__result vnext-row" href={hrefFor(record)} key={`${record.kind}-${record.id}`} aria-label={`${kindLabels[record.kind].slice(0, -1)}: ${record.title}`}>
                        <span className="search-vnext__result-primary">
                          <span className="technical-label">{kindLabels[record.kind].slice(0, -1)}</span>
                          <strong>{record.title}</strong>
                        </span>
                        <span className="search-vnext__result-detail">{detail}</span>
                        {record.amount === undefined ? <span className="search-vnext__result-amount" /> : <strong className="search-vnext__result-amount vnext-money">{formatRupiah(record.amount)}</strong>}
                        <OpenTile className="search-vnext__result-open" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : query ? (
          <div className="search-vnext__empty" id="search-results" aria-live="polite">
            <h2>No matching records.</h2>
            <p>Try a different name, description, outing, or amount.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
