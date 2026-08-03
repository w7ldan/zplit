import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseImage =
  "node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d";

function requireCondition(condition, message) {
  if (!condition) {
    console.error(`deployment contract failed: ${message}`);
    process.exit(1);
  }
}

const compose = spawnSync(
  "docker",
  ["compose", "-f", "compose.yml", "config", "--format", "json"],
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
requireCondition(Object.keys(services).length === 1, "exactly one service is required");
requireCondition(Object.hasOwn(services, "web"), "the only service must be named web");

const service = services.web;
const empty = (value) => value == null || (Array.isArray(value) && value.length === 0);
const exposed = service.expose ?? [];
const environments = service.environment ?? {};
const networks = config.networks ?? {};
const serviceNetworks = service.networks ?? {};
const ingress = networks.ingress;
const healthcheck = service.healthcheck;

requireCondition(empty(service.ports), "host ports must not be published");
requireCondition(service.network_mode !== "host", "host networking must not be enabled");
requireCondition(service.privileged !== true, "privileged mode must not be enabled");
requireCondition(service.read_only === true, "the root filesystem must be read-only");
requireCondition(
  Array.isArray(service.cap_drop) && service.cap_drop.some((capability) => capability.toUpperCase() === "ALL"),
  "all Linux capabilities must be dropped",
);
requireCondition(
  Array.isArray(service.security_opt) && service.security_opt.includes("no-new-privileges:true"),
  "no-new-privileges:true must be configured",
);
requireCondition(service.restart === "unless-stopped", "restart policy must be unless-stopped");
requireCondition(exposed.includes("3000") || exposed.includes("3000/tcp"), "container port 3000 must be exposed");
requireCondition(Object.keys(networks).length === 1 && ingress, "only the ingress network may be declared");
requireCondition(
  ingress.external === true && ingress.name === "desktorrent-watch_ingress",
  "ingress must be the existing external desktorrent-watch_ingress network",
);
requireCondition(
  Object.keys(serviceNetworks).length === 1 && Object.hasOwn(serviceNetworks, "ingress"),
  "web must use only the ingress network",
);
requireCondition(
  Array.isArray(serviceNetworks.ingress.aliases) && serviceNetworks.ingress.aliases.includes("zplit-web"),
  "zplit-web must be a network alias",
);
requireCondition(empty(service.volumes), "bind mounts and named volumes are not allowed");
requireCondition(empty(service.secrets), "secrets are not allowed");
requireCondition(empty(service.devices), "device access is not allowed");
requireCondition(!JSON.stringify(service).includes("/var/run/docker.sock"), "Docker socket access is not allowed");
requireCondition(Array.isArray(service.tmpfs), "bounded tmpfs mounts are required");
requireCondition(service.tmpfs.some((mount) => mount.startsWith("/tmp:")), "/tmp tmpfs is required");
requireCondition(
  service.tmpfs.some((mount) => mount.startsWith("/app/.next/cache:")),
  "/app/.next/cache tmpfs is required",
);
requireCondition(healthcheck && Array.isArray(healthcheck.test), "a health check is required");
requireCondition(healthcheck.test.includes("node"), "the health check must use the runtime Node executable");

for (const [key, value] of Object.entries({
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  HOSTNAME: "0.0.0.0",
  PORT: "3000",
})) {
  requireCondition(environments[key] === value, `${key} must be ${value}`);
}

const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
const fromImages = [...dockerfile.matchAll(/^\s*FROM\s+(\S+)/gm)].map((match) => match[1]);
requireCondition(fromImages.length === 3, "Dockerfile must have dependency, build, and runtime stages");
requireCondition(fromImages.every((image) => image === baseImage), "every FROM must use the authorized immutable Node image");
requireCondition(/COPY\s+--from=builder[^\n]*\/app\/\.next\/standalone/.test(dockerfile), ".next/standalone must be copied");
requireCondition(/COPY\s+--from=builder[^\n]*\/app\/\.next\/static/.test(dockerfile), ".next/static must be copied");
requireCondition(/\bWORKDIR\s+\/app\b/.test(dockerfile), "the application workdir must be /app");
requireCondition(/\bRUN\s+npm\s+ci\b/.test(dockerfile), "dependencies must be installed with npm ci");
requireCondition(/\bRUN\s+npm\s+run\s+build\b/.test(dockerfile), "the application must be built with npm run build");

const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
requireCondition(/^\s*USER\s+node\s*$/m.test(runtimeStage), "the runtime must use USER node");
requireCondition(/^\s*CMD\s+\["node",\s*"server\.js"\]\s*$/m.test(runtimeStage), "the runtime must use exec-form node server.js");
requireCondition(
  !/\b(?:npm|yarn|pnpm|apt|apt-get|apk|dnf|yum|microdnf|pacman|zypper|dpkg)\b/.test(runtimeStage),
  "the runtime stage must not install packages",
);

console.log("deployment contract passed");
