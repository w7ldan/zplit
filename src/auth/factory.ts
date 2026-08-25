import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from "../db/schema";
import { parseUsername } from "../domain/username";

export type AuthFactoryOptions = {
  db: Parameters<typeof drizzleAdapter>[0];
  secret: string;
  baseURL: string;
  enableBootstrapSignUp: boolean;
};

async function normalizeAuthUsername(user: Record<string, unknown>) {
  if (!("username" in user)) return { data: user };
  const result = parseUsername(user.username);
  if (!result.ok) throw new Error(result.error);
  return { data: { ...user, username: result.value } };
}

export function createAuth({ db, secret, baseURL, enableBootstrapSignUp }: AuthFactoryOptions) {
  const configuredBaseURL = baseURL.trim();
  if (!configuredBaseURL) throw new Error("BETTER_AUTH_URL is required");

  let url: URL;
  try {
    url = new URL(configuredBaseURL);
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL must use HTTP or HTTPS");
  }
  if (!secret.trim()) throw new Error("BETTER_AUTH_SECRET must be non-empty");

  return betterAuth({
    appName: "Zplit",
    baseURL: configuredBaseURL,
    trustedOrigins: [configuredBaseURL],
    secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: {
        user: schema.users,
        users: schema.users,
        session: schema.sessions,
        sessions: schema.sessions,
        account: schema.accounts,
        accounts: schema.accounts,
        verification: schema.verifications,
        verifications: schema.verifications,
      },
    }),
    user: {
      additionalFields: {
        username: { type: "string" as const, required: false, returned: true, input: true, sortable: true, unique: true },
      },
    },
    databaseHooks: {
      user: {
        create: { before: normalizeAuthUsername },
        update: { before: normalizeAuthUsername },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !enableBootstrapSignUp,
      minPasswordLength: 16,
      maxPasswordLength: 128,
      autoSignIn: false,
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: url.protocol === "https:",
      ipAddress: { ipAddressHeaders: ["x-zplit-client-ip"] },
      cookiePrefix: "zplit",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: url.protocol === "https:",
      },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
  });
}
