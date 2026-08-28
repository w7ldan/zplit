"use client";

import Link from "next/link";
import { AvatarSettings } from "@/components/settings/avatar-settings";
import { OrganizationAvatar, organizationAvatarSeed } from "@/components/organizations/organization-avatar";
import { OrganizationForm } from "@/components/organizations/organization-form";
import type { OrganizationActionState } from "@/domain/organization-contracts";
import { usePathname } from "next/navigation";

type ProfileAction = (previousState: OrganizationActionState, formData: FormData) => Promise<OrganizationActionState>;

export function OrganizationProfile({ organization, action }: { organization: { id: string; name: string; description: string | null; avatar: { sha256: string } | null }; action: ProfileAction }) {
  return <div className="organization-detail__owner-tools"><h2>Organization profile</h2><OrganizationForm action={action} edit initialValues={{ name: organization.name, description: organization.description ?? "" }} /><AvatarSettings userId={organization.id} defaultAvatarSeed={organizationAvatarSeed(organization.id)} avatar={organization.avatar} endpoint={`/app/organizations/${organization.id}/avatar`} avatarUrl={(avatar) => `/app/organizations/${organization.id}/avatar?v=${encodeURIComponent(avatar.sha256)}`}><p className="technical-label">PROFILE IMAGE</p></AvatarSettings></div>;
}

export function OrganizationIdentity({ organization }: { organization: { id: string; name: string; avatar: { sha256: string } | null } }) {
  return <div className="organization-detail__identity"><OrganizationAvatar organizationId={organization.id} customAvatar={organization.avatar} size="lg" /><div><p className="technical-label">ORGANIZATION</p><h1>{organization.name}</h1></div></div>;
}

export function OrganizationNavigation({ organizationId, canViewLedger, canViewPeople, canViewSettings }: { organizationId: string; canViewLedger: boolean; canViewPeople: boolean; canViewSettings: boolean }) {
  const pathname = usePathname() ?? "";
  const base = `/app/organizations/${organizationId}`;
  const links: Array<[string, string, boolean]> = [
    ["Overview", base, pathname === base],
    ...(canViewLedger ? [["Activity", `${base}/trips`, pathname.startsWith(`${base}/trips`) || pathname.startsWith(`${base}/outings`)], ["Expenses", `${base}/expenses`, pathname.startsWith(`${base}/expenses`)], ["Repayments", `${base}/repayments`, pathname.startsWith(`${base}/repayments`)] ] as Array<[string, string, boolean]> : []),
    ...(canViewPeople ? [["People", `${base}/people`, pathname.startsWith(`${base}/people`) || pathname.startsWith(`${base}/friends`)] ] as Array<[string, string, boolean]> : []),
    ...(canViewSettings ? [["Settings", `${base}/settings`, pathname.startsWith(`${base}/settings`) || pathname.startsWith(`${base}/exports`)] ] as Array<[string, string, boolean]> : []),
  ] as const;
  const activity = canViewLedger && (pathname.startsWith(`${base}/trips`) || pathname.startsWith(`${base}/outings`));
  return <>
    <nav className="organization-context__nav" aria-label="Organization navigation">{links.map(([label, href, active]) => <Link href={href} key={label} aria-current={active ? "page" : undefined}>{label}</Link>)}</nav>
    {activity ? <nav className="organization-context__subnav" aria-label="Organization activity navigation"><Link href={`${base}/trips`} aria-current={pathname.startsWith(`${base}/trips`) ? "page" : undefined}>Trips</Link><Link href={`${base}/outings`} aria-current={pathname.startsWith(`${base}/outings`) ? "page" : undefined}>Outings</Link></nav> : null}
  </>;
}
