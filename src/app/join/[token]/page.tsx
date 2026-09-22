import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { findUsableInvitation } from "@/auth/invitations";
import { getDatabase } from "@/db/client";
import { getAuth } from "@/auth/runtime";
import { InviteSignupForm } from "@/components/auth/invite-signup-form";
import { AccessFrame } from "@/components/editorial/access-frame";
import { acceptInvitationAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Join",
  description: "Create your private Zplit ledger through a secure invitation.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: {
    title: "Join Zplit",
    description: "Create your private Zplit ledger through a secure invitation.",
    siteName: "Zplit",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Join Zplit",
    description: "Create your private Zplit ledger through a secure invitation.",
  },
};

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  if (await getAuth().api.getSession({ headers: await headers() })) redirect("/app");
  const { token } = await params;
  let invitation = null;
  try {
    invitation = await findUsableInvitation(getDatabase(), token);
  } catch {
    invitation = null;
  }

  return (
    <AccessFrame variant="invitation" marker="INVITATION" eyebrow="PRIVATE ACCOUNT ACCESS">
      {invitation ? (
        <>
          <h1>Make it yours.</h1>
          <p className="access-vnext__lede">Choose the name and password for your empty, private ledger.</p>
          <InviteSignupForm email={invitation.email} suggestedName={invitation.suggestedName} action={acceptInvitationAction.bind(null, token)} />
        </>
      ) : (
        <>
          <h1>This invitation is unavailable.</h1>
          <p className="access-vnext__lede">Ask the installation owner for a new invitation.</p>
          <Link className="access-vnext__back action-link action-link--quiet" href="/login">Go to login</Link>
        </>
      )}
    </AccessFrame>
  );
}
