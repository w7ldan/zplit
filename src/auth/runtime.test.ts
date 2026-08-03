import { describe, expect, it } from "vitest";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuth } from "./factory";

const db = {} as Parameters<typeof drizzleAdapter>[0];
const secret = "a".repeat(64);

describe("auth configuration", () => {
  it("keeps production sign-up disabled with explicit origin and secure cookies", () => {
    const auth = createAuth({
      db,
      secret,
      baseURL: "https://idr.wildan.lol",
      enableBootstrapSignUp: false,
    });

    expect(auth.options.appName).toBe("Zplit");
    expect(auth.options.baseURL).toBe("https://idr.wildan.lol");
    expect(auth.options.trustedOrigins).toEqual(["https://idr.wildan.lol"]);
    expect(auth.options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 16,
      maxPasswordLength: 128,
      autoSignIn: false,
    });
    expect(auth.options.session).toMatchObject({
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    });
    expect(auth.options.advanced).toMatchObject({
      useSecureCookies: true,
      cookiePrefix: "zplit",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: true },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    });
  });

  it("only enables sign-up for the bootstrap instance", () => {
    const auth = createAuth({
      db,
      secret,
      baseURL: "http://localhost:3000",
      enableBootstrapSignUp: true,
    });

    expect(auth.options.emailAndPassword?.disableSignUp).toBe(false);
    expect(auth.options.advanced?.useSecureCookies).toBe(false);
  });
});
