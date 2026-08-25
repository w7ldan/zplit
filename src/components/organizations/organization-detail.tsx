"use client";

import { AvatarSettings } from "@/components/settings/avatar-settings";
import { OrganizationAvatar, organizationAvatarSeed } from "@/components/organizations/organization-avatar";
import { OrganizationForm } from "@/components/organizations/organization-form";
import type { OrganizationActionState } from "@/app/app/organizations/actions";

type ProfileAction = (previousState: OrganizationActionState, formData: FormData) => Promise<OrganizationActionState>;

export function OrganizationProfile({ organization, action }: { organization: { id: string; name: string; description: string | null; avatar: { sha256: string } | null }; action: ProfileAction }) {
  return <div className="organization-detail__owner-tools"><h2>Organization profile</h2><OrganizationForm action={action} edit initialValues={{ name: organization.name, description: organization.description ?? "" }} /><AvatarSettings userId={organization.id} defaultAvatarSeed={organizationAvatarSeed(organization.id)} avatar={organization.avatar} endpoint={`/app/organizations/${organization.id}/avatar`} avatarUrl={(avatar) => `/app/organizations/${organization.id}/avatar?v=${encodeURIComponent(avatar.sha256)}`}><p className="technical-label">PROFILE IMAGE</p></AvatarSettings></div>;
}

export function OrganizationIdentity({ organization }: { organization: { id: string; name: string; avatar: { sha256: string } | null } }) {
  return <div className="organization-detail__identity"><OrganizationAvatar organizationId={organization.id} customAvatar={organization.avatar} size="lg" /><div><p className="technical-label">ORGANIZATION</p><h1>{organization.name}</h1></div></div>;
}
