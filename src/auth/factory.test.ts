import { describe, expect, it, vi } from "vitest";
import { createAuth, type AuthFactoryOptions } from "./factory";

const mocks = vi.hoisted(() => ({ ensurePersonalLedgerScope: vi.fn() }));
vi.mock("../server/ledger-scopes", () => ({ ensurePersonalLedgerScope: mocks.ensurePersonalLedgerScope }));

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

  it("centralizes Personal scope creation in the Better Auth user-create lifecycle", async () => {
    const auth = createAuth({ db, secret: "test-secret", baseURL: "http://localhost:3000", enableBootstrapSignUp: true });
    const after = auth.options.databaseHooks?.user?.create?.after;
    expect(after).toBeTypeOf("function");
    await after?.({ id: "user-a" } as never);
    expect(mocks.ensurePersonalLedgerScope).toHaveBeenCalledWith(db, "user-a");
  });
});
