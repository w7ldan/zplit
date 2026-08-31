"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import type { GroupJoinRequestActionState, GroupJoinRequestSummary, GroupParticipant } from "@/domain/group-contracts";
import { SearchableCombobox, type SearchableOptionAction } from "@/components/records/searchable-combobox";
import {
  createGroupInvitationAction,
  createGroupParticipantLinkRequestAction,
  deleteExternalParticipantAction,
  removeGroupMemberAction,
  revokeGroupJoinRequestAction,
  searchGroupJoinUserOptions,
  searchGroupMemberOptions,
  updateExternalParticipantAction,
  updateGroupMemberRoleAction,
} from "@/app/app/personal/groups/actions";

function roleLabel(role: string | null) {
  return role ? role[0]?.toUpperCase() + role.slice(1) : "";
}

function requestStatusLabel(status: string) {
  return status[0]?.toUpperCase() + status.slice(1);
}

const initialJoinState: GroupJoinRequestActionState = { error: "", values: { targetUserId: "" } };

function GroupJoinForm({
  id,
  search,
  action,
  buttonLabel,
  description,
  searchLabel = "Search by @username",
  onCancel,
}: {
  id: string;
  search: SearchableOptionAction;
  action: (
    state: GroupJoinRequestActionState,
    formData: FormData,
  ) => Promise<GroupJoinRequestActionState>;
  buttonLabel: string;
  description?: string;
  searchLabel?: string;
  onCancel?: () => void;
}) {
  const [state, formAction] = useActionState(action, initialJoinState);
  return (
    <form className="group-join-form" action={formAction}>
      {description ? (
        <p className="group-detail__supporting-copy">{description}</p>
      ) : null}
      <label id={`${id}-label`} htmlFor={id}>
        {searchLabel}
      </label>
      <SearchableCombobox
        id={id}
        name="targetUserId"
        value={state.values.targetUserId}
        options={[]}
        search={search}
        required
        placeholder={searchLabel}
        searchLabel={searchLabel}
        labelId={`${id}-label`}
      />
      <p
        className="group-join-form__message"
        role={state.error && !state.error.endsWith("sent.") && !state.error.endsWith("added.") ? "alert" : "status"}
      >
        {state.error || "Search by username to find another Zplit user."}
      </p>
      <div className="group-join-form__actions">
        {onCancel ? (
          <button
            className="text-link"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        <button
          className="action-link action-link--quiet"
          type="submit"
        >
          {buttonLabel}
        </button>
      </div>
    </form>
  );
}

function GroupParticipantLinkControl({
  groupId,
  participant,
  pending,
  search,
}: {
  groupId: string;
  participant: GroupParticipant;
  pending?: GroupJoinRequestSummary;
  search: SearchableOptionAction;
}) {
  const [open, setOpen] = useState(false);
  if (pending) return (
    <div className="group-people__link-state">
      <span>Pending link → @{pending.targetUsername}</span>
      <form
        action={revokeGroupJoinRequestAction.bind(null, groupId, pending.id)}
      >
        <button className="text-link" type="submit">
          Revoke
        </button>
      </form>
    </div>
  );
  if (!open) return (
    <button
      className="text-link"
      type="button"
      onClick={() => setOpen(true)}
    >
      Link Zplit account
    </button>
  );
  return (
    <GroupJoinForm
      id={`group-link-${participant.id}`}
      search={search}
      action={createGroupParticipantLinkRequestAction.bind(
        null,
        groupId,
        participant.id,
      )}
      buttonLabel="Send link request"
      description={
        `Link this existing participant${participant.label ? ` · ${participant.label}` : ""} to a Zplit account.`
      }
      onCancel={() => setOpen(false)}
    />
  );
}

export function GroupPeople({
  groupId,
  participants,
  pendingInvitations = [],
  pendingLinks = [],
  canManageParticipants,
  canManageRoles,
}: {
  groupId: string;
  participants: GroupParticipant[];
  pendingInvitations?: GroupJoinRequestSummary[];
  pendingLinks?: GroupJoinRequestSummary[];
  canManageParticipants: boolean;
  canManageRoles: boolean;
}) {
  const former = participants.filter((participant) => participant.isFormer);
  const current = participants.filter((participant) => !participant.isFormer);
  const pendingLinkByParticipant = new Map(pendingLinks.map((request) => [request.participantId, request]));
  const search = searchGroupJoinUserOptions.bind(null, groupId) as SearchableOptionAction;
  const memberSearch = searchGroupMemberOptions.bind(null, groupId) as SearchableOptionAction;
  return (
    <>
      <section
        className="group-detail__section"
        aria-labelledby="group-members-heading"
      >
        <div className="group-section-heading">
          <div>
            <h2 id="group-members-heading">Members</h2>
          </div>
          <span className="technical-label">{current.length}</span>
        </div>
        <ul className="group-people__list">
          {current.map((participant) => participant.isExternal ? (
            <li className="group-people__row group-people__row--external" key={participant.id}>
              <div className="group-people__external-main">
                {canManageParticipants ? (
                  <form
                    className="group-external-form"
                    action={updateExternalParticipantAction.bind(null, groupId, participant.id)}
                  >
                    <div>
                      <input
                        name="displayName"
                        aria-label={`Name for ${participant.displayName}`}
                        defaultValue={participant.displayName}
                      />
                      <input
                        name="label"
                        aria-label={`Label for ${participant.displayName}`}
                        defaultValue={participant.label ?? ""}
                        placeholder="Label (optional)"
                      />
                    </div>
                    <button className="text-link" type="submit">Save</button>
                    <button
                      className="text-link"
                      type="submit"
                      formAction={deleteExternalParticipantAction.bind(null, groupId, participant.id)}
                    >
                      Remove
                    </button>
                  </form>
                ) : (
                  <span className="group-people__identity">
                    <strong>{participant.displayName}</strong>
                    {participant.label ? <span>{participant.label}</span> : null}
                  </span>
                )}
                <span className="group-people__external-meta">Local member</span>
              </div>
              {canManageParticipants ? (
                <GroupParticipantLinkControl
                  groupId={groupId}
                  participant={participant}
                  pending={pendingLinkByParticipant.get(participant.id)}
                  search={search}
                />
              ) : null}
            </li>
          ) : (
            <li className="group-people__row" key={participant.id}>
              <span className="group-people__identity">
                <strong>{participant.displayName}</strong>
                <span>{roleLabel(participant.role)} · Zplit member</span>
              </span>
              {participant.role !== "owner" && canManageRoles ? (
                <form action={updateGroupMemberRoleAction.bind(null, groupId, participant.userId ?? "")}>
                  <select
                    name="role"
                    defaultValue={participant.role ?? "member"}
                    aria-label={`Role for ${participant.displayName}`}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="text-link" type="submit">Save role</button>
                </form>
              ) : null}
              {participant.role !== "owner" && (canManageRoles || (canManageParticipants && participant.role === "member")) ? (
                <form action={removeGroupMemberAction.bind(null, groupId, participant.userId ?? "")}>
                  <button className="text-link" type="submit">Remove</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {former.length ? (
          <div className="group-people__pending">
            <h3>Former participants</h3>
            <ul className="group-people__list">
              {former.map((participant) => (
                <li className="group-people__row" key={participant.id}>
                  <span className="group-people__identity">
                    <strong>{participant.displayName}</strong>
                    <span>Former member</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {canManageParticipants ? (
          <div className="group-people__invite">
            <h3>Add member</h3>
            <GroupJoinForm
              id="group-invite-target"
              search={memberSearch}
              action={createGroupInvitationAction.bind(null, groupId)}
              buttonLabel="Add member"
              searchLabel="Search by name or @username..."
            />
            <p className="group-detail__supporting-copy">
              No matching person? <Link href="/app/friends?create=1">Add a Personal Friend first.</Link>
            </p>
          </div>
        ) : null}
        {canManageParticipants && pendingInvitations.length > 0 ? (
          <div className="group-people__pending">
            <h3>Pending invitations</h3>
            <ul className="group-people__list">
              {pendingInvitations.map((invitation) => (
                <li className="group-people__row" key={invitation.id}>
                  <span className="group-people__identity">
                    <strong>{invitation.targetDisplayName}</strong>
                    <span>@{invitation.targetUsername}</span>
                  </span>
                  <span className="group-people__request-meta">
                    {requestStatusLabel(invitation.status)} · Expires <LocalDateTime
                      iso={invitation.expiresAt}
                      mode="date"
                    />
                  </span>
                  <form
                    action={revokeGroupJoinRequestAction.bind(
                      null,
                      groupId,
                      invitation.id,
                    )}
                  >
                    <button className="text-link" type="submit">
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </>
  );
}
