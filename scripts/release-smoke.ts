export {};

const DEFAULT_URL = "https://idr.wildan.lol";
const TIMEOUT_MS = 8_000;
const PRIVATE_PREFIXES = ["/app", "/api", "/login", "/join", "/share", "/healthz", "/offline"];

function fail(message: string): never {
  throw new Error(message);
}

function baseOrigin() {
  const raw = process.env.ZPLIT_RELEASE_URL?.trim() || DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("ZPLIT_RELEASE_URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") fail("release URL must use HTTPS");
  if (url.username || url.password) fail("release URL must not contain credentials");
  if (url.search || url.hash) fail("release URL must not contain a query or fragment");
  return url.origin;
}

async function get(origin: string, path: string) {
  try {
    return await fetch(new URL(path, origin), { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    fail(`${path} could not be fetched within ${TIMEOUT_MS}ms`);
  }
}

function requireStatus(response: Response, path: string, status: number) {
  if (response.status !== status) fail(`${path} returned ${response.status}, expected ${status}`);
}

function requireHeader(response: Response, path: string, name: string, value: string) {
  if (!response.headers.get(name)?.toLowerCase().includes(value.toLowerCase())) fail(`${path} is missing ${name}`);
}

async function run() {
  const origin = baseOrigin();
  const health = await get(origin, "/healthz");
  requireStatus(health, "/healthz", 200);
  if (JSON.stringify(await health.json()) !== JSON.stringify({ status: "ok" })) fail("/healthz returned an unexpected body");
  requireHeader(health, "/healthz", "cache-control", "no-store");

  const publicPage = await get(origin, "/");
  requireStatus(publicPage, "/", 200);
  const publicContent = await publicPage.text();
  if (!/Zplit/i.test(publicContent) || !/shared expenses/i.test(publicContent)) fail("/ did not contain recognizable Zplit content");

  const login = await get(origin, "/login");
  requireStatus(login, "/login", 200);
  requireHeader(login, "/login", "x-robots-tag", "noindex, nofollow, noarchive");
  requireHeader(login, "/login", "cache-control", "no-store");

  const app = await get(origin, "/app");
  if (![301, 302, 303, 307, 308].includes(app.status)) fail(`/app returned ${app.status}, expected a redirect`);
  const destination = app.headers.get("location");
  if (!destination || new URL(destination, origin).pathname !== "/login") fail("/app did not redirect to /login");

  const robots = await get(origin, "/robots.txt");
  requireStatus(robots, "/robots.txt", 200);
  const robotsText = await robots.text();
  if (!/^Allow:\s*\/$/m.test(robotsText)) fail("robots.txt does not allow the public root");
  for (const prefix of PRIVATE_PREFIXES) if (!new RegExp(`^Disallow:\\s*${prefix.replace("*", "\\*")}$`, "m").test(robotsText)) fail(`robots.txt does not disallow ${prefix}`);
  if (!robotsText.includes("Sitemap: https://idr.wildan.lol/sitemap.xml")) fail("robots.txt has the wrong sitemap URL");

  const sitemap = await get(origin, "/sitemap.xml");
  requireStatus(sitemap, "/sitemap.xml", 200);
  const sitemapText = await sitemap.text();
  const locations = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, value]) => value);
  if (locations.length !== 1 || locations[0] !== "https://idr.wildan.lol/") fail("sitemap.xml must contain only the public root");

  for (const path of ["/manifest.webmanifest", "/sw.js"]) requireStatus(await get(origin, path), path, 200);

  for (const [name, value] of [
    ["strict-transport-security", "max-age=31536000"],
    ["content-security-policy", "default-src 'self'"],
    ["content-security-policy", "frame-ancestors 'none'"],
    ["x-content-type-options", "nosniff"],
    ["permissions-policy", "camera=()"],
    ["referrer-policy", "same-origin"],
    ["cross-origin-opener-policy", "same-origin"],
  ] as const) requireHeader(publicPage, "/", name, value);
  if (publicPage.headers.has("server")) fail("/ exposes a Server header");

  console.log("release smoke passed");
}

try {
  await run();
} catch (error) {
  console.error(`release smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
