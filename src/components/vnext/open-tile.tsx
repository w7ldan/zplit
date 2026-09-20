import type { ReactNode } from "react";

type OpenTileProps = {
  className?: string;
};

export function OpenTile({ className }: OpenTileProps): ReactNode {
  return (
    <span className={`vnext-open-tile${className ? ` ${className}` : ""}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" focusable="false">
        <path d="M5 19 19 5m0 0H9m10 0v10" />
      </svg>
    </span>
  );
}
