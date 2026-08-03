type ChapterLabelProps = {
  chapter: number;
  label: string;
  metadata?: string;
};

export function ChapterLabel({ chapter, label, metadata }: ChapterLabelProps) {
  return (
    <div className="chapter-label" aria-label={`Chapter ${chapter}: ${label}`}>
      <span className="chapter-label__number" aria-hidden="true">
        {String(chapter).padStart(2, "0")}
      </span>
      <span className="chapter-label__category">{label}</span>
      {metadata ? <span className="chapter-label__metadata">{metadata}</span> : null}
    </div>
  );
}
