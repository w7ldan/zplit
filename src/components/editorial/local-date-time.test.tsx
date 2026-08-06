import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalDateTime } from "./local-date-time";

describe("LocalDateTime", () => {
  it("renders a deterministic UTC fallback on the server and a local hydrated value", async () => {
    const serverMarkup = renderToString(<LocalDateTime iso="2026-01-02T10:30:00.000Z" />);
    expect(serverMarkup).toContain("02 Jan 2026, 10:30 UTC");

    render(<LocalDateTime iso="2026-01-02T10:30:00.000Z" />);
    const time = screen.getByRole("time");
    expect(time).toHaveAttribute("dateTime", "2026-01-02T10:30:00.000Z");
    await waitFor(() => expect(time).not.toHaveTextContent(/UTC$/));
  });

  it("supports date-only output and safely handles invalid timestamps", () => {
    const serverMarkup = renderToString(<LocalDateTime iso="2026-01-02T10:30:00.000Z" mode="date" />);
    expect(serverMarkup).toContain("02 Jan 2026 UTC");
    render(<LocalDateTime iso="not-a-date" mode="date" />);
    expect(screen.getByRole("time")).toHaveTextContent("Invalid date");
  });

  it("uses the browser timezone across a UTC date boundary", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Etc/GMT-7";
    try {
      render(<LocalDateTime iso="2026-06-30T17:00:00Z" mode="date" />);
      await waitFor(() => expect(screen.getByRole("time")).toHaveTextContent("01 Jul 2026"));
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
