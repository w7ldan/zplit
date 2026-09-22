import type { Metadata } from "next";
import Link from "next/link";
import { AccessFrame } from "@/components/editorial/access-frame";

export const metadata: Metadata = {
  title: "Offline",
  description: "Zplit cannot reach the server right now. Financial records cannot be viewed or changed offline.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function OfflinePage() {
  return (
    <AccessFrame variant="offline" marker="OFFLINE" eyebrow="THE SERVER IS OUT OF REACH">
      <h1>Zplit is offline.</h1>
      <p className="access-vnext__lede">Zplit cannot reach the server right now. Financial records cannot be viewed or changed offline.</p>
      <div className="access-vnext__actions">
        <Link className="action-link action-link--primary" href="/app">Try again</Link>
        <Link className="action-link action-link--quiet" href="/">Return home</Link>
      </div>
    </AccessFrame>
  );
}
