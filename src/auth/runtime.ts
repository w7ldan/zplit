import "server-only";

import { createAuth } from "./factory";
import { getDatabase } from "../db/client";
import { readSecretFile } from "../server/secret-file";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return (auth ??= createAuth({
    db: getDatabase(),
    secret: readSecretFile(requiredEnv("BETTER_AUTH_SECRET_FILE"), "BETTER_AUTH_SECRET_FILE"),
    baseURL: requiredEnv("BETTER_AUTH_URL"),
    enableBootstrapSignUp: false,
  }));
}
