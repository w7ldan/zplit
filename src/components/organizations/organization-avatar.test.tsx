import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrganizationAvatar, organizationAvatarSeed } from "./organization-avatar";

describe("OrganizationAvatar", () => {
  it("keeps one canonical identity seed", () => {
    expect(organizationAvatarSeed("org-a")).toBe("organization:org-a");
  });

  it("uses an organization-specific deterministic default and private custom route", () => {
    const first = render(<OrganizationAvatar organizationId="org-a" decorative />);
    const firstMarkup = first.container.innerHTML;
    first.unmount();
    const second = render(<OrganizationAvatar organizationId="org-a" decorative />);
    expect(second.container.innerHTML).toBe(firstMarkup);
    second.rerender(<OrganizationAvatar organizationId="org-a" customAvatar={{ sha256: "a".repeat(64) }} />);
    expect(second.container.querySelector("img")).toHaveAttribute("src", `/app/organizations/org-a/avatar?v=${"a".repeat(64)}`);
  });
});
