import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeDaily } from "./safe-daily";

const originalTimezone = process.env.TZ;

describe("SafeDaily", () => {
  beforeEach(() => {
    process.env.TZ = "Asia/Shanghai";
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it("uses the browser-local calendar date rather than the server UTC date", () => {
    vi.setSystemTime(new Date("2026-09-30T17:00:00.000Z"));

    render(<SafeDaily endsOn="2026-09-30" remaining={30_000} startsOn="2026-09-01" />);

    expect(screen.getByText("Period ended")).toBeInTheDocument();
  });

  it("counts the inclusive remaining days of the local calendar date", () => {
    vi.setSystemTime(new Date("2026-09-10T02:00:00.000Z"));

    render(<SafeDaily endsOn="2026-09-30" remaining={210_000} startsOn="2026-09-01" />);

    expect(screen.getByText("Rp 10.000")).toBeInTheDocument();
  });
});
