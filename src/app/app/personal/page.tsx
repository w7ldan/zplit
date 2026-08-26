import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { GroupCard } from "@/components/groups/group-card";
import { listGroups } from "@/server/groups";
import { createGroupAction } from "./groups/actions";
import { GroupForm } from "@/components/groups/group-form";
import { TaskPanel } from "@/components/app/task-panel";

export const metadata = { title: "Personal" };
export const dynamic = "force-dynamic";

const destinations = [
  ["Friends", "/app/friends", "People you split with"],
  ["Outings", "/app/outings", "Trips and shared occasions"],
  ["Expenses", "/app/expenses", "Your recorded spending"],
  ["Repayments", "/app/repayments", "Money received and allocated"],
] as const;

export default async function PersonalPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ create?: string | string[] }> } = {}) {
  const session = await requireSession();
  const groups = await listGroups(getDatabase(), session.user.id);
  const create = await searchParams;
  const openCreate = (Array.isArray(create.create) ? create.create[0] : create.create) === "1";
  return (
    <section className="app-page personal-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Personal · private ledger</p>
            <h1>Personal</h1>
            <p className="app-page__lede">Your private financial world, kept separate from future shared spaces.</p>
          </div>
          <Link className="action-link action-link--primary" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</Link>
        </header>
        <section className="personal-destinations" aria-labelledby="personal-ledger-heading">
          <div className="ledger-section__heading"><h2 id="personal-ledger-heading">Private ledger</h2><span className="technical-label">Open a workspace</span></div>
          <div className="personal-destinations__grid">
            {destinations.map(([label, href, description]) => <Link className="personal-destination" href={href} key={href}><strong>{label}</strong><span>{description}</span></Link>)}
          </div>
        </section>
        <section className="group-section" aria-labelledby="personal-groups-heading">
          <div className="ledger-section__heading"><h2 id="personal-groups-heading">Groups</h2><span className="technical-label">{groups.length} {groups.length === 1 ? "group" : "groups"}</span></div>
          {groups.length ? <div className="group-grid">{groups.map((group) => <GroupCard group={group} key={group.id} />)}</div> : <div className="ledger-empty"><h3>No groups yet.</h3><p>Create a peer-to-peer space for shared expenses.</p><Link className="text-link" href="/app/personal?create=1">Create a group <span aria-hidden="true">→</span></Link></div>}
          <Link className="text-link" href="/app/personal/groups">View all Groups <span aria-hidden="true">→</span></Link>
        </section>
      </div>
      {openCreate ? <TaskPanel open title="New group" description="Create a peer-to-peer shared-expense space. You become its Owner." triggerId="group-create"><GroupForm action={createGroupAction} /></TaskPanel> : null}
    </section>
  );
}
