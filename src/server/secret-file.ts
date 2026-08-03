import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export function readSecretFile(filePath: string, label = "secret file") {
  if (!path.isAbsolute(filePath)) throw new Error(`${label} path must be absolute`);

  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    throw new Error(`${label} must identify a regular file`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must identify a regular file`);

  let value: string;
  try {
    value = readFileSync(filePath, "utf8").trim();
  } catch {
    throw new Error(`${label} could not be read`);
  }
  if (!value) throw new Error(`${label} must contain a non-empty value`);
  return value;
}
