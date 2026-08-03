import { chmodSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSecretFile } from "./secret-file";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("readSecretFile", () => {
  it("requires an absolute regular non-symlink file and trims its value", () => {
    expect(() => readSecretFile("relative-secret-file", "BETTER_AUTH_SECRET_FILE")).toThrow("absolute");

    const directory = mkdtempSync(path.join(os.tmpdir(), "zplit-secret-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "secret");
    writeFileSync(file, "  value\n", { mode: 0o600 });
    expect(readSecretFile(file, "BETTER_AUTH_SECRET_FILE")).toBe("value");
    expect(() => readSecretFile(directory, "BETTER_AUTH_SECRET_FILE")).toThrow("regular file");
    symlinkSync(file, path.join(directory, "link"));
    expect(() => readSecretFile(path.join(directory, "link"), "BETTER_AUTH_SECRET_FILE")).toThrow("regular file");
  });

  it("rejects empty values without exposing file contents", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "zplit-secret-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "secret");
    writeFileSync(file, "\n", { mode: 0o600 });
    chmodSync(file, 0o600);

    expect(() => readSecretFile(file, "BETTER_AUTH_SECRET_FILE")).toThrow("non-empty value");
    expect(() => readSecretFile(file, "BETTER_AUTH_SECRET_FILE")).not.toThrow("super-secret");
  });
});
