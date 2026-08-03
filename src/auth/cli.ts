import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

const cliDatabase = {} as Parameters<typeof drizzleAdapter>[0];

export default betterAuth({
  appName: "Zplit",
  baseURL: "http://localhost",
  database: drizzleAdapter(cliDatabase, {
    provider: "pg",
    usePlural: true,
  }),
  emailAndPassword: { enabled: true },
  secret: "schema-generation-only",
});
