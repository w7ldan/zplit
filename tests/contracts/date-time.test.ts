import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sharedDateTime = path.resolve(root, "src/components/editorial/local-date-time.tsx");
const calendarDate = path.resolve(root, "src/components/editorial/calendar-date.ts");
const tripPage = path.resolve(root, "src/app/app/trips/[tripId]/page.tsx");

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(fullPath);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || [sharedDateTime, calendarDate].includes(path.resolve(fullPath))) return [];
    return [fullPath];
  });
}

describe("Repository date-time contract", () => {
  it("keeps calendar formatting outside the client boundary", () => {
    const localDateTimeSource = readFileSync(sharedDateTime, "utf8");
    const calendarDateSource = readFileSync(calendarDate, "utf8");
    const tripPageSource = readFileSync(tripPage, "utf8");

    expect(localDateTimeSource).toMatch(/^"use client";/);
    expect(localDateTimeSource).toContain('from "./calendar-date"');
    expect(calendarDateSource).not.toContain('"use client"');
    expect(calendarDateSource).not.toMatch(/useSyncExternalStore|window|document|navigator|localStorage/);
    expect(tripPageSource).toContain('from "@/components/editorial/calendar-date"');
    const files = [...productionFiles(path.join(root, "src/app")), ...productionFiles(path.join(root, "src/components"))];
    const clientUtilityImport = /import\s*\{[^;]*formatCalendarDate[^;]*\}\s*from\s*["']@\/components\/editorial\/local-date-time["']/;
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(clientUtilityImport);
  });

  it("keeps direct UI timestamp formatting inside LocalDateTime", () => {
    const forbidden = [
      /Intl\.DateTimeFormat/,
      /\.toLocaleDateString\(/,
      /\.toLocaleString\(/,
      /timeZone\s*:\s*["']UTC["']/,
    ];
    const files = [...productionFiles(path.join(root, "src/app")), ...productionFiles(path.join(root, "src/components"))];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) expect(source, file).not.toMatch(pattern);
    }
  });
});
