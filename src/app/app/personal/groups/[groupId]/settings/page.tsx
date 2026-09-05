import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getGroupForMember, hasFinancialHistory } from "@/server/groups";
import { DeleteConfirmationDialog } from "@/components/app/delete-confirmation-dialog";
import { GroupProfile } from "@/components/groups/group-detail";
import { archiveGroupAction, deleteGroupAction, restoreGroupAction, updateGroupAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group settings" };

export default async function GroupSettingsPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<{ error?: string | string[] }>;
}) {
  const session = await requireSession();
  const { groupId } = await params;
  const query = await searchParams;
  let group;
  try {
    group = await getGroupForMember(getDatabase(), groupId, session.user.id);
  } catch {
    notFound();
  }
  const deletionBlocked = (Array.isArray(query.error) ? query.error[0] : query.error) === "financial_history";
  const archived = group.archivedAt !== null;
  const financialHistory = archived ? true : await hasFinancialHistory(getDatabase(), groupId).catch(() => true);
  return (
    <section className="app-page group-settings-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Group settings</p>
            <h1>Settings</h1>
            <p className="app-page__lede">Manage this Group’s identity and participant space.</p>
          </div>
        </header>
        {archived ? (
          <section className="group-detail__section">
            <h2>Archived</h2>
            <p>This group is archived. Its history is preserved, but new activity is limited.</p>
            {group.canDelete ? (
              <DeleteConfirmationDialog
                title="Restore group?"
                entityName={group.name}
                confirmLabel="Restore group"
                pendingLabel="Restoring group…"
                description={`“${group.name}” will become active again with its history preserved.`}
                action={restoreGroupAction.bind(null, groupId)}
              />
            ) : null}
          </section>
        ) : null}
        {!archived && group.canManageGroup ? (
          <section className="group-detail__section">
            <GroupProfile
              group={group}
              action={updateGroupAction.bind(null, groupId)}
            />
          </section>
        ) : null}
        {!archived && group.canDelete && !financialHistory ? (
          <section className="group-detail__section group-settings__delete">
            <h2>Delete Group</h2>
            <p>Deleting a Group removes its non-financial records. Financial history is protected and blocks deletion.</p>
            {deletionBlocked ? (
              <p className="group-form__field-error" role="alert">
                This Group cannot be deleted because it has financial history. The records remain untouched.
              </p>
            ) : null}
            <DeleteConfirmationDialog
              title="Delete group?"
              entityName={group.name}
              confirmLabel="Delete group"
              pendingLabel="Deleting group…"
              action={deleteGroupAction.bind(null, groupId)}
            />
          </section>
        ) : null}
        {!archived && group.canDelete && financialHistory ? (
          <section className="group-detail__section group-settings__delete">
            <h2>Archive Group</h2>
            <p>Deleting a Group removes its non-financial records. Financial history is protected and blocks deletion.</p>
            {deletionBlocked ? (
              <p className="group-form__field-error" role="alert">
                This Group cannot be deleted because it has financial history. The records remain untouched.
              </p>
            ) : null}
            <DeleteConfirmationDialog
              title="Archive group?"
              entityName={group.name}
              confirmLabel="Archive group"
              pendingLabel="Archiving group…"
              description={`“${group.name}” has financial history, so it will be archived instead of permanently deleted. Its expenses, payments, settlements, and other history will be preserved.`}
              action={archiveGroupAction.bind(null, groupId)}
            />
          </section>
        ) : null}
        {!group.canDelete ? (
          <Link
            className="text-link"
            href={`/app/personal/groups/${groupId}`}
          >
            Back to Group <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}
