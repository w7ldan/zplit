import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseImage =
  "node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d";
const postgresImage =
  "postgres:18.4-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296";

function requireCondition(condition, message) {
  if (!condition) {
    console.error(`deployment contract failed: ${message}`);
    process.exit(1);
  }
}

const compose = spawnSync(
  "docker",
  ["compose", "-f", "compose.yml", "--profile", "tools", "config", "--format", "json"],
  { cwd: root, encoding: "utf8" },
);

requireCondition(!compose.error, compose.error?.message ?? "unable to run Docker Compose");
requireCondition(compose.status === 0, compose.stderr.trim() || "Docker Compose config failed");

let config;
try {
  config = JSON.parse(compose.stdout);
} catch (error) {
  requireCondition(false, `Docker Compose returned invalid JSON: ${error.message}`);
}

const services = config.services ?? {};
const networks = config.networks ?? {};
const volumes = config.volumes ?? {};
const secrets = config.secrets ?? {};
const empty = (value) => value == null || (Array.isArray(value) && value.length === 0);
const onlyKeys = (value, keys) => JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...keys].sort());
const hasNetworkOnly = (service, name) => onlyKeys(service.networks, [name]);
const hasNetworksOnly = (service, names) => onlyKeys(service.networks, names);
const secretNames = (service) => (service.secrets ?? []).map((secret) => secret.source).sort();
const hasSecrets = (service, names) => JSON.stringify(secretNames(service)) === JSON.stringify([...names].sort());
const forbiddenServiceFeatures = (service) => {
  requireCondition(service.network_mode !== "host", "host networking must not be enabled");
  requireCondition(service.privileged !== true, "privileged mode must not be enabled");
  requireCondition(empty(service.devices), "device access is not allowed");
  requireCondition(!JSON.stringify(service).includes("/var/run/docker.sock"), "Docker socket access is not allowed");
};

requireCondition(onlyKeys(services, ["web", "postgres", "migrate", "bootstrap-owner"]), "exactly web, postgres, migrate, and bootstrap-owner services are required");
requireCondition(onlyKeys(networks, ["ingress", "database"]), "only ingress and database networks may be declared");
requireCondition(onlyKeys(volumes, ["postgres_data"]), "only postgres_data may be declared as a named volume");
requireCondition(onlyKeys(secrets, ["postgres_password", "better_auth_secret", "owner_name", "owner_email", "owner_password"]), "exactly five deployment secrets are required");

const ingress = networks.ingress;
const database = networks.database;
requireCondition(ingress?.external === true && ingress.name === "desktorrent-watch_ingress", "ingress must be the existing external network");
requireCondition(database?.internal === true, "database must be internal");
requireCondition(volumes.postgres_data?.name === "zplit_postgres_data", "postgres_data must use the zplit_postgres_data volume");

const web = services.web;
const webEnvironment = web.environment ?? {};
requireCondition(empty(web.ports), "web must not publish host ports");
requireCondition(hasNetworksOnly(web, ["ingress", "database"]), "web must use only ingress and database");
requireCondition(Array.isArray(web.networks.ingress.aliases) && web.networks.ingress.aliases.includes("zplit-web"), "zplit-web must be a network alias");
requireCondition(empty(web.volumes), "web bind mounts and named volumes are not allowed");
requireCondition(hasSecrets(web, ["postgres_password", "better_auth_secret"]), "web must mount only database password and Better Auth secrets");
requireCondition(web.depends_on?.postgres?.condition === "service_healthy", "web must depend on healthy PostgreSQL");
requireCondition(web.read_only === true, "web root filesystem must be read-only");
requireCondition(Array.isArray(web.cap_drop) && web.cap_drop.some((capability) => capability.toUpperCase() === "ALL"), "web must drop all Linux capabilities");
requireCondition(Array.isArray(web.security_opt) && web.security_opt.includes("no-new-privileges:true"), "web must use no-new-privileges:true");
requireCondition(web.restart === "unless-stopped", "web restart policy must be unless-stopped");
requireCondition((web.expose ?? []).includes("3000") || (web.expose ?? []).includes("3000/tcp"), "web port 3000 must be exposed");
requireCondition(Array.isArray(web.tmpfs) && web.tmpfs.some((mount) => mount.startsWith("/tmp:")), "web /tmp tmpfs is required");
requireCondition(web.tmpfs.some((mount) => mount.startsWith("/app/.next/cache:")), "web .next/cache tmpfs is required");
requireCondition(web.healthcheck && Array.isArray(web.healthcheck.test), "web health check is required");
requireCondition(web.healthcheck.test.includes("node"), "web health check must use Node");
for (const [key, value] of Object.entries({
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  HOSTNAME: "0.0.0.0",
  PORT: "3000",
})) {
  requireCondition(webEnvironment[key] === value, `web ${key} must be ${value}`);
}
for (const [key, value] of Object.entries({
  DB_HOST: "postgres",
  DB_PORT: "5432",
  DB_NAME: "zplit",
  DB_USER: "zplit",
  DB_PASSWORD_FILE: "/run/secrets/postgres_password",
  BETTER_AUTH_URL: "https://idr.wildan.lol",
  BETTER_AUTH_SECRET_FILE: "/run/secrets/better_auth_secret",
})) {
  requireCondition(webEnvironment[key] === value, `web ${key} must be ${value}`);
}
requireCondition(!secretNames(web).some((name) => name.startsWith("owner_")), "web must not mount owner credential secrets");
forbiddenServiceFeatures(web);

const postgres = services.postgres;
const postgresEnvironment = postgres.environment ?? {};
requireCondition(postgres.image === postgresImage, "PostgreSQL must use the exact pinned 18.4 image");
requireCondition(empty(postgres.ports), "PostgreSQL must not publish host ports");
requireCondition(hasNetworkOnly(postgres, "database"), "PostgreSQL must use only the database network");
requireCondition(postgres.restart === "unless-stopped", "PostgreSQL restart policy must be unless-stopped");
requireCondition(Array.isArray(postgres.volumes) && postgres.volumes.length === 1, "PostgreSQL must have exactly one volume");
const postgresVolume = postgres.volumes[0];
requireCondition(postgresVolume.type === "volume" && postgresVolume.source === "postgres_data" && postgresVolume.target === "/var/lib/postgresql", "PostgreSQL must use only postgres_data at /var/lib/postgresql");
requireCondition(hasSecrets(postgres, ["postgres_password"]), "PostgreSQL must mount only the postgres_password secret");
requireCondition(postgresEnvironment.POSTGRES_DB === "zplit", "PostgreSQL database must be zplit");
requireCondition(postgresEnvironment.POSTGRES_USER === "zplit", "PostgreSQL user must be zplit");
requireCondition(postgresEnvironment.POSTGRES_PASSWORD_FILE === "/run/secrets/postgres_password", "PostgreSQL must read its password from the secret file");
requireCondition(postgresEnvironment.PGDATA === "/var/lib/postgresql/18/docker", "PostgreSQL PGDATA must be /var/lib/postgresql/18/docker");
requireCondition(postgresEnvironment.POSTGRES_INITDB_ARGS === "--auth-host=scram-sha-256 --auth-local=scram-sha-256", "PostgreSQL must initialize with SCRAM authentication");
requireCondition(postgres.healthcheck && Array.isArray(postgres.healthcheck.test), "PostgreSQL health check is required");
requireCondition(postgres.healthcheck.test.join(" ").includes("pg_isready -U zplit -d zplit"), "PostgreSQL health check must use pg_isready");
requireCondition(postgres.healthcheck.interval === "10s" && postgres.healthcheck.timeout === "5s" && postgres.healthcheck.retries === 5 && postgres.healthcheck.start_period === "10s", "PostgreSQL health check must be bounded");
requireCondition(Array.isArray(postgres.security_opt) && postgres.security_opt.includes("no-new-privileges:true"), "PostgreSQL must use no-new-privileges:true");
requireCondition(Array.isArray(postgres.tmpfs) && postgres.tmpfs.some((mount) => mount.startsWith("/tmp:")), "PostgreSQL bounded /tmp tmpfs is required");
forbiddenServiceFeatures(postgres);

const migrator = services.migrate;
const migratorEnvironment = migrator.environment ?? {};
requireCondition(migrator.build?.target === "migrator", "migrate must build the migrator target");
requireCondition(Array.isArray(migrator.profiles) && migrator.profiles.length === 1 && migrator.profiles[0] === "tools", "migrate must use the tools profile");
requireCondition(migrator.restart === "no", "migrate must not have a persistent restart policy");
requireCondition(migrator.depends_on?.postgres?.condition === "service_healthy", "migrate must depend on healthy PostgreSQL");
requireCondition(hasNetworkOnly(migrator, "database"), "migrate must use only the database network");
requireCondition(hasSecrets(migrator, ["postgres_password"]), "migrate must mount only the postgres_password secret");
requireCondition(empty(migrator.ports), "migrate must not publish ports");
requireCondition(empty(migrator.volumes), "migrate must not use persistent volumes");
requireCondition(migrator.read_only === true, "migrate root filesystem must be read-only");
requireCondition(Array.isArray(migrator.cap_drop) && migrator.cap_drop.some((capability) => capability.toUpperCase() === "ALL"), "migrate must drop all Linux capabilities");
requireCondition(Array.isArray(migrator.security_opt) && migrator.security_opt.includes("no-new-privileges:true"), "migrate must use no-new-privileges:true");
requireCondition(migrator.user === "node", "migrate must run as non-root node");
requireCondition(Array.isArray(migrator.tmpfs) && migrator.tmpfs.some((mount) => mount.startsWith("/tmp:")), "migrate bounded /tmp tmpfs is required");
for (const [key, value] of Object.entries({
  DB_HOST: "postgres",
  DB_PORT: "5432",
  DB_NAME: "zplit",
  DB_USER: "zplit",
  DB_PASSWORD_FILE: "/run/secrets/postgres_password",
})) {
  requireCondition(migratorEnvironment[key] === value, `migrate ${key} must be ${value}`);
}
forbiddenServiceFeatures(migrator);

const bootstrap = services["bootstrap-owner"];
const bootstrapEnvironment = bootstrap.environment ?? {};
requireCondition(bootstrap.image === "zplit-auth-tool:local", "bootstrap-owner must use the local auth-tool image");
requireCondition(bootstrap.build?.target === "auth-tool", "bootstrap-owner must build the auth-tool target");
requireCondition(Array.isArray(bootstrap.profiles) && bootstrap.profiles.length === 1 && bootstrap.profiles[0] === "tools", "bootstrap-owner must use the tools profile");
requireCondition(bootstrap.restart === "no", "bootstrap-owner must not have a persistent restart policy");
requireCondition(bootstrap.depends_on?.postgres?.condition === "service_healthy", "bootstrap-owner must depend on healthy PostgreSQL");
requireCondition(hasNetworkOnly(bootstrap, "database"), "bootstrap-owner must use only the database network");
requireCondition(hasSecrets(bootstrap, ["postgres_password", "better_auth_secret", "owner_name", "owner_email", "owner_password"]), "bootstrap-owner must mount exactly the five deployment secrets");
requireCondition(empty(bootstrap.ports), "bootstrap-owner must not publish ports");
requireCondition(empty(bootstrap.volumes), "bootstrap-owner must not use persistent volumes");
requireCondition(bootstrap.read_only === true, "bootstrap-owner root filesystem must be read-only");
requireCondition(Array.isArray(bootstrap.cap_drop) && bootstrap.cap_drop.some((capability) => capability.toUpperCase() === "ALL"), "bootstrap-owner must drop all Linux capabilities");
requireCondition(Array.isArray(bootstrap.security_opt) && bootstrap.security_opt.includes("no-new-privileges:true"), "bootstrap-owner must use no-new-privileges:true");
requireCondition(bootstrap.user === "node", "bootstrap-owner must run as non-root node");
requireCondition(Array.isArray(bootstrap.tmpfs) && bootstrap.tmpfs.some((mount) => mount.startsWith("/tmp:")), "bootstrap-owner bounded /tmp tmpfs is required");
for (const [key, value] of Object.entries({
  DB_HOST: "postgres",
  DB_PORT: "5432",
  DB_NAME: "zplit",
  DB_USER: "zplit",
  DB_PASSWORD_FILE: "/run/secrets/postgres_password",
  BETTER_AUTH_URL: "https://idr.wildan.lol",
  BETTER_AUTH_SECRET_FILE: "/run/secrets/better_auth_secret",
  OWNER_NAME_FILE: "/run/secrets/owner_name",
  OWNER_EMAIL_FILE: "/run/secrets/owner_email",
  OWNER_PASSWORD_FILE: "/run/secrets/owner_password",
})) {
  requireCondition(bootstrapEnvironment[key] === value, `bootstrap-owner ${key} must be ${value}`);
}
requireCondition(JSON.stringify(bootstrap.command) === JSON.stringify(["./node_modules/.bin/tsx", "scripts/bootstrap-owner.ts"]), "bootstrap-owner must execute the bootstrap script with tsx");
forbiddenServiceFeatures(bootstrap);

const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
const fromImages = [...dockerfile.matchAll(/^\s*FROM\s+(\S+)(?:\s+AS\s+([\w-]+))?/gm)];
requireCondition(fromImages.length === 5, "Dockerfile must have dependency, build, migrator, auth-tool, and runtime stages");
requireCondition(fromImages[0][1] === baseImage && fromImages[0][2] === "dependencies", "dependencies must use the authorized immutable Node image");
requireCondition(fromImages[1][1] === baseImage && fromImages[1][2] === "builder", "builder must use the authorized immutable Node image");
requireCondition(fromImages[2][1] === "dependencies" && fromImages[2][2] === "migrator", "migrator must derive from dependencies");
requireCondition(fromImages[3][1] === "dependencies" && fromImages[3][2] === "auth-tool", "auth-tool must derive from dependencies");
requireCondition(fromImages[4][1] === baseImage && fromImages[4][2] === "runtime", "runtime must use the authorized immutable Node image");
requireCondition(/COPY\s+drizzle\s+\.\/drizzle/.test(dockerfile), "migrator must contain drizzle migrations");
requireCondition(/COPY\s+scripts\/migrate\.ts\s+\.\/scripts\/migrate\.ts/.test(dockerfile), "migrator must contain scripts/migrate.ts");
const migratorStart = dockerfile.indexOf("FROM dependencies AS migrator");
const authToolStart = dockerfile.indexOf("FROM dependencies AS auth-tool");
const runtimeStart = dockerfile.indexOf("FROM ", authToolStart + 1);
const migratorStage = dockerfile.slice(migratorStart, authToolStart);
requireCondition(!/COPY\s+\.\s+\./.test(migratorStage), "migrator must not copy application source");
requireCondition(!/(?:src\/|\.next|vitest|secrets|\.git)/.test(migratorStage), "migrator must not contain application, test, secret, or Git paths");
requireCondition(/^\s*USER\s+node\s*$/m.test(migratorStage), "migrator must use USER node");
requireCondition(/^\s*CMD\s+\["\.\/node_modules\/\.bin\/tsx",\s*"scripts\/migrate\.ts"\]\s*$/m.test(migratorStage), "migrator must execute the migration script");
const authToolStage = dockerfile.slice(authToolStart, runtimeStart);
requireCondition(!/COPY\s+\.\s+\./.test(authToolStage), "auth-tool must not copy application source");
for (const requiredPath of [
  "src/auth/factory.ts",
  "src/auth/runtime.ts",
  "src/db/client.ts",
  "src/db/schema.ts",
  "src/server/secret-file.ts",
  "scripts/bootstrap-owner.ts",
]) {
  requireCondition(authToolStage.includes(`COPY ${requiredPath}`), `auth-tool must contain ${requiredPath}`);
}
requireCondition(!/(?:src\/app|\.next|vitest|secrets|\.git)/.test(authToolStage), "auth-tool must not contain application, test, secret, or Git paths");
requireCondition(/^\s*USER\s+node\s*$/m.test(authToolStage), "auth-tool must use USER node");
requireCondition(/^\s*CMD\s+\["\.\/node_modules\/\.bin\/tsx",\s*"scripts\/bootstrap-owner\.ts"\]\s*$/m.test(authToolStage), "auth-tool must execute the bootstrap script");

const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
requireCondition(/COPY\s+--from=builder[^\n]*\/app\/.next\/standalone/.test(dockerfile), ".next/standalone must be copied");
requireCondition(/COPY\s+--from=builder[^\n]*\/app\/.next\/static/.test(dockerfile), ".next/static must be copied");
requireCondition(/\bWORKDIR\s+\/app\b/.test(dockerfile), "the application workdir must be /app");
requireCondition(/\bRUN\s+npm\s+ci\b/.test(dockerfile), "dependencies must be installed with npm ci");
requireCondition(/\bRUN\s+npm\s+run\s+build\b/.test(dockerfile), "the application must be built with npm run build");
requireCondition(/^\s*USER\s+node\s*$/m.test(runtimeStage), "runtime must use USER node");
requireCondition(/^\s*CMD\s+\["node",\s*"server\.js"\]\s*$/m.test(runtimeStage), "runtime must use exec-form node server.js");
requireCondition(!/\b(?:npm|yarn|pnpm|apt|apt-get|apk|dnf|yum|microdnf|pacman|zypper|dpkg)\b/.test(runtimeStage), "runtime stage must not install packages");

console.log("deployment contract passed");
