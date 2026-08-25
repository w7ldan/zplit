import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserAvatar } from "./user-avatar";

describe("UserAvatar", () => {
  it("renders a stable decorative Zplit motif when no upload exists", () => {
    const first = render(<UserAvatar userId="user-a" decorative size="sm" />);
    const firstMarkup = first.container.innerHTML;
    expect(first.container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(first.container.querySelector("img")).not.toBeInTheDocument();
    first.unmount();
    const second = render(<UserAvatar userId="user-a" decorative size="sm" />);
    expect(second.container.innerHTML).toBe(firstMarkup);
    expect(second.container.innerHTML).toContain("var(--surface)");
    expect(second.container.innerHTML).toContain("var(--ink)");
  });

  it("renders custom media with an accessible name and versioned delivery URL", () => {
    const { container } = render(<UserAvatar userId="user-a" customAvatar={{ sha256: "a".repeat(64) }} alt="Wildan" size="md" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "Wildan");
    expect(container.querySelector("img")).toHaveAttribute("src", `/app/avatar?userId=user-a&v=${"a".repeat(64)}`);
  });

  it("uses the same token-based motif in dark presentation", () => {
    document.documentElement.dataset.theme = "dark";
    const { container } = render(<UserAvatar userId="user-dark" decorative size="sm" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.innerHTML).toMatch(/var\(--(?:pastel-blue|mint|peach|amber)\)/);
    delete document.documentElement.dataset.theme;
  });
});
