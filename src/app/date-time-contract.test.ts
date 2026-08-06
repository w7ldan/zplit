import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sharedDateTime = path.resolve(root, "src/components/editorial/local-date-time.tsx");

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(fullPath);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || path.resolve(fullPath) === sharedDateTime) return [];
    return [fullPath];
  });
}

describe("web date-time source contract", () => {
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
