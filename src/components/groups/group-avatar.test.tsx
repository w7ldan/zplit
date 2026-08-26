import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupAvatar, groupAvatarSeed } from "./group-avatar";

describe("GroupAvatar", () => {
  it("uses one stable Group seed and private custom route", () => {
    expect(groupAvatarSeed("group-a")).toBe("group:group-a");
    const first = render(<GroupAvatar groupId="group-a" decorative />);
    const markup = first.container.innerHTML;
    first.unmount();
    const second = render(<GroupAvatar groupId="group-a" decorative />);
    expect(second.container.innerHTML).toBe(markup);
    second.rerender(<GroupAvatar groupId="group-a" customAvatar={{ sha256: "a".repeat(64) }} />);
    expect(second.container.querySelector("img")).toHaveAttribute("src", `/app/personal/groups/group-a/avatar?v=${"a".repeat(64)}`);
  });
});
