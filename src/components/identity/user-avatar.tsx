import { getDefaultAvatarMotif } from "@/domain/default-avatar";

export type AvatarSize = "sm" | "md" | "lg";
export type AvatarReference = { sha256: string };

const accents = ["var(--pastel-blue)", "var(--mint)", "var(--peach)", "var(--amber)"];

function DefaultAvatar({ userId, decorative, label }: { userId: string; decorative: boolean; label: string }) {
  const motif = getDefaultAvatarMotif(userId);
  const accent = accents[motif.accent] ?? accents[0];
  const secondary = accents[(motif.accent + 1) % accents.length] ?? accents[1];
  const diagonal = motif.variant % 2 === 0
    ? `M 8 ${motif.offset} L ${Math.min(56, motif.split + 8)} 8 L ${Math.min(60, motif.split + 16)} 8 L 8 ${Math.min(56, motif.offset + 24)} Z`
    : `M ${motif.split} 8 L 56 8 L 56 ${Math.min(56, motif.offset)} L ${Math.max(4, motif.split - 12)} ${Math.min(56, motif.offset)} Z`;
  const line = motif.tilt === 0 ? `M 8 52 L 52 12` : `M 12 8 L 52 52`;
  const markX = Math.min(44, motif.offset);
  const markY = Math.min(46, motif.split);

  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className="user-avatar__default"
      role={decorative ? undefined : "img"}
      viewBox="0 0 64 64"
    >
      <rect width="64" height="64" rx="10" fill="var(--surface)" />
      <path d={diagonal} fill={accent} />
      <rect x={markX} y={markY} width="18" height="14" fill={secondary} />
      <path d={line} fill="none" stroke="var(--ink)" strokeLinecap="square" strokeWidth="4" />
    </svg>
  );
}

export function UserAvatar({
  userId,
  customAvatar,
  previewSrc,
  size = "md",
  alt = "User avatar",
  decorative = false,
}: {
  userId: string;
  customAvatar?: AvatarReference | null;
  previewSrc?: string | null;
  size?: AvatarSize;
  alt?: string;
  decorative?: boolean;
}) {
  const src = previewSrc ?? (customAvatar ? `/app/avatar?userId=${encodeURIComponent(userId)}&v=${encodeURIComponent(customAvatar.sha256)}` : null);
  return (
    <span className={`user-avatar user-avatar--${size}`} aria-hidden={decorative || undefined}>
      {src ? <img src={src} alt={decorative ? "" : alt} /> : <DefaultAvatar userId={userId} decorative={decorative} label={alt} />}
    </span>
  );
}
