import type { ReactNode } from "react";
import Link from "next/link";
import { zplitVNextFont } from "@/app/fonts";

type AccessFrameProps = {
  variant: "login" | "invitation" | "offline";
  marker: string;
  eyebrow: string;
  children: ReactNode;
};

export function AccessFrame({ variant, marker, eyebrow, children }: AccessFrameProps) {
  return (
    <main className={`access-vnext access-vnext--${variant} zplit-vnext ${zplitVNextFont.variable}`} id="top">
      <div className="access-vnext__accent" aria-hidden="true" />
      <div className="access-vnext__layout editorial-shell">
        <div className="access-vnext__marker">
          <Link className="access-vnext__brand" href="/">Zplit</Link>
          <span className="technical-label">{marker}</span>
        </div>
        <div className="access-vnext__content">
          <p className="technical-label access-vnext__eyebrow">{eyebrow}</p>
          {children}
        </div>
      </div>
    </main>
  );
}
