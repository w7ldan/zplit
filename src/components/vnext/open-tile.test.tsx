import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpenTile } from "./open-tile";

describe("OpenTile", () => {
  it("stays a visual cue inside the containing control", () => {
    const { container, getByRole } = render(<a className="vnext-row" href="/app/personal"><OpenTile /></a>);

    expect(getByRole("link")).toBeInTheDocument();
    expect(container.querySelector(".vnext-open-tile")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});
