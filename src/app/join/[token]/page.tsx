import Link from "next/link";
import { findUsableInvitation } from "@/auth/invitations";
import { getDatabase } from "@/db/client";
import { InviteSignupForm } from "@/components/auth/invite-signup-form";
import { acceptInvitationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invitation = null;
  try {
    invitation = await findUsableInvitation(getDatabase(), token);
  } catch {
    invitation = null;
  }

  return (
    <main className="access-page" id="top">
      <div className="access-page__field" aria-hidden="true" />
      <div className="editorial-grid editorial-shell access-page__layout">
        <div className="access-page__marker technical-label"><Link href="/">Zplit</Link><span>INVITATION</span></div>
        <div className="access-page__content">
          <p className="technical-label access-page__metadata">PRIVATE ACCOUNT ACCESS</p>
          {invitation ? (
            <>
              <h1>Make it yours.</h1>
              <p className="access-page__lede">Choose the name and password for your empty, private ledger.</p>
              <InviteSignupForm email={invitation.email} suggestedName={invitation.suggestedName} action={acceptInvitationAction.bind(null, token)} />
            </>
          ) : (
            <>
              <h1>Invitation unavailable.</h1>
              <p className="access-page__lede">This invitation may have expired, been revoked, or already been used.</p>
              <Link className="action-link action-link--quiet access-page__back" href="/login">Go to login</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
