import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarDateRange, LocalDateTime, formatCalendarDate } from "./local-date-time";

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

describe("calendar dates", () => {
  it("formats the stored day without browser timezone conversion", () => {
    expect(formatCalendarDate("2026-04-12")).toBe("12 Apr 2026");
    render(<CalendarDateRange startsOn="2026-04-12" endsOn="2026-04-16" />);
    expect(screen.getByText("12 Apr 2026 – 16 Apr 2026")).toBeInTheDocument();
  });

  it.each([
    [["2026-04-12", null], "From 12 Apr 2026"],
    [[null, "2026-04-16"], "Until 16 Apr 2026"],
    [[null, null], "Dates not set"],
  ])("renders %s", (dates, expected) => {
    render(<CalendarDateRange startsOn={dates[0]} endsOn={dates[1]} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
