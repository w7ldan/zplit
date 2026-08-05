import Link from "next/link";

type RecordPaginationProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  href: string;
  anchor?: string;
};

function pageHref(href: string, page: number, anchor: string) {
  const url = new URL(href, "https://zplit.invalid");
  url.searchParams.set("page", page.toString());
  url.hash = anchor;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function RecordPagination({ page, pageSize, totalItems, totalPages, href, anchor = "record-list" }: RecordPaginationProps) {
  if (totalPages <= 1) return null;
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return (
    <nav className="record-pagination" aria-label="Record pages">
      <span className={page <= 1 ? "record-pagination__disabled" : undefined} aria-disabled={page <= 1 ? "true" : undefined}>
        {page <= 1 ? "Previous" : <Link href={pageHref(href, page - 1, anchor)}>Previous</Link>}
      </span>
      <span className="record-pagination__summary"><strong>Page {page} of {totalPages}</strong><small>{start}–{end} of {totalItems}</small></span>
      <span className={page >= totalPages ? "record-pagination__disabled" : undefined} aria-disabled={page >= totalPages ? "true" : undefined}>
        {page >= totalPages ? "Next" : <Link href={pageHref(href, page + 1, anchor)}>Next</Link>}
      </span>
    </nav>
  );
}
