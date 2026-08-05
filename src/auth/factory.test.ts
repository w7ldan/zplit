import { describe, expect, it } from "vitest";
import { createAuth, type AuthFactoryOptions } from "./factory";

const db = {} as AuthFactoryOptions["db"];

describe("auth factory", () => {
  it.each([false, true])("uses the exact rate-limit contract for %s auth", (enableBootstrapSignUp) => {
    const auth = createAuth({ db, secret: "test-secret", baseURL: "http://localhost:3000", enableBootstrapSignUp });

    expect(auth.options.rateLimit).toMatchObject({
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    });
    expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual(["x-zplit-client-ip"]);
  });

  it("keeps public email sign-up disabled for runtime auth", () => {
    const auth = createAuth({ db, secret: "test-secret", baseURL: "http://localhost:3000", enableBootstrapSignUp: false });
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  it("only enables sign-up for the explicit bootstrap configuration", () => {
    const auth = createAuth({ db, secret: "test-secret", baseURL: "http://localhost:3000", enableBootstrapSignUp: true });
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(false);
  });
});
