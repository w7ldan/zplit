import { describe, expect, it } from "vitest";
import { createAuth, type AuthFactoryOptions } from "./factory";

const db = {} as AuthFactoryOptions["db"];

describe("auth factory", () => {
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
