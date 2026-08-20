import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { isInstallationOwner, listInvitations } from "@/auth/invitations";
import { notFound } from "next/navigation";
import { InviteForm } from "@/components/invites/invite-form";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { createInviteAction, revokeInviteAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitations" };

function invitationStatus(invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date) {
  if (invitation.acceptedAt) return "Accepted";
  if (invitation.revokedAt) return "Revoked";
  if (invitation.expiresAt <= now) return "Expired";
  return "Ready to share";
}

export default async function InvitesPage() {
  const session = await requireSession();
  const database = getDatabase();
  if (!(await isInstallationOwner(database, session.user.id))) notFound();
  const invitations = await listInvitations(database, session.user.id);
  const now = new Date();

  return (
    <section className="app-page invites-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Invitations · owner issued</p>
            <h1>Bring someone in.</h1>
            <p className="app-page__lede">Create a private, one-time link for a new Zplit account. No email is sent.</p>
          </div>
        </header>
        <div className="invites-page__columns">
          <section className="invites-page__create" aria-labelledby="create-invitation-heading">
            <p className="technical-label">New invitation</p>
            <h2 id="create-invitation-heading">Choose who can join.</h2>
            <InviteForm action={createInviteAction} />
          </section>
          <section className="invites-page__history" aria-labelledby="invitation-history-heading">
            <div className="invites-page__history-heading"><h2 id="invitation-history-heading">Invitation history</h2><span className="technical-label">{invitations.length} issued</span></div>
            {invitations.length === 0 ? <p className="invites-page__empty">No invitations yet.</p> : (
              <ul className="invites-list">
                {invitations.map((invitation) => {
                  const status = invitationStatus(invitation, now);
                  const canRevoke = status === "Ready to share";
                  return (
                    <li className="invites-list__row" key={invitation.id}>
                      <div><strong>{invitation.email}</strong>{invitation.suggestedName ? <span>{invitation.suggestedName}</span> : null}</div>
                      <div className="invites-list__meta"><span>{status}</span><span>Expires <LocalDateTime iso={invitation.expiresAt.toISOString()} mode="date" /></span></div>
                      {canRevoke ? <form action={revokeInviteAction.bind(null, invitation.id)}><button className="text-link invites-list__revoke" type="submit">Revoke</button></form> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
