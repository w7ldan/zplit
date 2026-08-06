import * as https from "node:https";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_URL = "https://idr.wildan.lol";
const TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 1024 * 1024;
const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const JAVASCRIPT_CONTENT_TYPES = new Set(["application/javascript", "text/javascript", "application/ecmascript", "text/ecmascript"]);
const PRIVATE_PREFIXES = ["/app", "/api", "/login", "/join", "/share", "/healthz", "/offline"];
const AUTHENTICATED_MARKERS = [
  "PRIVATE LEDGER",
  "Still owed to you",
  'data-task-trigger="expense-create"',
  "Overview",
];

function fail(message: string): never {
  throw new Error(message);
}

export interface SmokeResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  url: string;
}

export type HttpsRequest = (
  options: https.RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export function baseOrigin(raw = process.env.ZPLIT_RELEASE_URL?.trim() || DEFAULT_URL): string {
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

function acceptFor(path: string): string {
  if (path === "/healthz") return "application/json";
  if (path === "/robots.txt") return "text/plain";
  if (path === "/sitemap.xml") return "application/xml";
  if (path === "/manifest.webmanifest") return "application/manifest+json";
  if (path === "/sw.js") return "application/javascript";
  return BROWSER_ACCEPT;
}

function normalizedHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") normalized[name.toLowerCase()] = value;
    else if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(", ");
  }
  return normalized;
}

export function requestHttps(
  origin: string,
  path: string,
  requestImpl = https.request as unknown as HttpsRequest,
): Promise<SmokeResponse> {
  let target: URL;
  try {
    target = new URL(path, origin);
  } catch {
    return Promise.reject(new Error(`${path} has an invalid HTTPS URL`));
  }
  if (target.protocol !== "https:" || target.username || target.password) {
    return Promise.reject(new Error(`${path} requires an HTTPS URL without credentials`));
  }

  return new Promise((resolveResponse, reject) => {
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const resolveOnce = (response: SmokeResponse) => {
      if (settled) return;
      settled = true;
      resolveResponse(response);
    };

    let request: ClientRequest;
    try {
      request = requestImpl({
        method: "GET",
        protocol: "https:",
        hostname: target.hostname,
        family: 4,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        servername: target.hostname,
        rejectUnauthorized: true,
        headers: {
          Accept: acceptFor(target.pathname),
          "Accept-Encoding": "identity",
          "User-Agent": "zplit-release-smoke/1",
          Connection: "close",
        },
      }, (incoming) => {
        const status = incoming.statusCode;
        if (status === undefined) {
          request.destroy();
          rejectOnce(new Error(`${path} response had no status`));
          return;
        }

        const headers = normalizedHeaders(incoming.headers);
        const declaredLength = headers["content-length"];
        if (declaredLength && Number.isFinite(Number(declaredLength)) && Number(declaredLength) > MAX_BODY_BYTES) {
          incoming.destroy();
          request.destroy();
          rejectOnce(new Error(`${path} response exceeded ${MAX_BODY_BYTES} bytes`));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        let ended = false;
        const failStream = (reason: string) => {
          incoming.destroy();
          rejectOnce(new Error(`${path} response ${reason}`));
        };
        incoming.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total > MAX_BODY_BYTES) {
            failStream(`exceeded ${MAX_BODY_BYTES} bytes`);
            return;
          }
          chunks.push(buffer);
        });
        incoming.on("aborted", () => failStream("was aborted"));
        incoming.on("error", () => failStream("failed while reading"));
        incoming.on("close", () => {
          if (!ended) failStream("closed before ending");
        });
        incoming.on("end", () => {
          ended = true;
          resolveOnce({ status, headers, body: Buffer.concat(chunks), url: target.toString() });
        });
      });
      request.on("error", () => rejectOnce(new Error(`${path} HTTPS request failed`)));
      request.setTimeout(TIMEOUT_MS, () => {
        request.destroy();
        rejectOnce(new Error(`${path} HTTPS request timed out after ${TIMEOUT_MS}ms`));
      });
      request.end();
    } catch {
      rejectOnce(new Error(`${path} HTTPS request could not be created`));
    }
  });
}

export async function get(origin: string, path: string): Promise<SmokeResponse> {
  return requestHttps(origin, path);
}

export function requireStatus(response: SmokeResponse, path: string, status: number): void {
  if (response.status !== status) fail(`${path} returned ${response.status}, expected ${status}`);
}

export function requireHeader(response: SmokeResponse, path: string, name: string, value: string): void {
  if (!response.headers[name.toLowerCase()]?.toLowerCase().includes(value.toLowerCase())) fail(`${path} is missing ${name}`);
}

export function requirePrivateHeaders(response: SmokeResponse, path: string): void {
  requireHeader(response, path, "x-robots-tag", "noindex, nofollow, noarchive");
  requireHeader(response, path, "cache-control", "no-store");
}

export function requirePublicServerHeader(response: SmokeResponse): void {
  const server = response.headers.server?.trim();
  if (server && server.toLowerCase() !== "cloudflare") fail("/ exposes an unexpected Server header");
}

function bodyText(response: SmokeResponse): string {
  return response.body.toString("utf8");
}

function bodyPreview(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 160).replace(/[A-Za-z0-9._%+/=-]{24,}/g, "[redacted]");
}

function healthError(response: SmokeResponse, body: string, reason: string): never {
  const contentType = response.headers["content-type"] || "missing";
  const bytes = response.body.byteLength;
  fail(`/healthz ${reason}; status=${response.status}; content-type=${contentType}; body-bytes=${bytes}; preview=${JSON.stringify(bodyPreview(body))}`);
}

export async function readHealthResponse(response: SmokeResponse): Promise<void> {
  const body = bodyText(response);
  if (response.status !== 200) healthError(response, body, "returned an unexpected status");
  const contentType = response.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() || "";
  if (contentType !== "application/json" && !contentType.endsWith("+json")) healthError(response, body, "returned a non-JSON content type");
  if (!body.trim()) healthError(response, body, "returned an empty body");
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    healthError(response, body, "returned malformed JSON");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || (payload as { status?: unknown }).status !== "ok") {
    healthError(response, body, "returned an unexpected JSON payload");
  }
}

export function resolveLoginDestination(destination: string, origin: string): void {
  let target: URL;
  try {
    target = new URL(destination, origin);
  } catch {
    fail("/app redirect destination is malformed");
  }
  const base = new URL(origin);
  if (target.origin !== base.origin || target.pathname !== "/login" || target.search || target.hash) {
    fail("/app did not redirect exactly to /login");
  }
}

function requireNoAuthenticatedContent(body: string): void {
  for (const marker of AUTHENTICATED_MARKERS) {
    if (body.toLowerCase().includes(marker.toLowerCase())) fail("/app streamed authenticated content");
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(body)) fail("/app streamed user email content");
}

export function requireStreamedLoginRedirect(response: SmokeResponse, body: string, origin: string): void {
  if (!response.headers["content-type"]?.toLowerCase().startsWith("text/html")) fail("/app streamed redirect was not HTML");
  requirePrivateHeaders(response, "/app");
  requireNoAuthenticatedContent(body);

  const tokenCount = (body.match(/NEXT_REDIRECT/g) ?? []).length;
  if (tokenCount !== 1) fail("/app streamed redirect marker was duplicated or missing");

  const markers: Array<{ action: string; destination: string; status: number; delayed: boolean }> = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of body.matchAll(scriptPattern)) {
    const script = match[1];
    if (!script.includes("self.__next_f.push(")) continue;
    const delayed = /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/.test(script);
    for (const marker of script.matchAll(/NEXT_REDIRECT;([^;\"]+);([^;\"]+);(\d{3});/g)) {
      markers.push({ action: marker[1], destination: marker[2], status: Number(marker[3]), delayed });
    }
  }
  if (markers.length !== 1 || markers[0].delayed) fail("/app streamed redirect marker was malformed or delayed");
  const marker = markers[0];
  if (marker.action !== "replace" || !REDIRECT_STATUSES.has(marker.status)) fail("/app streamed redirect marker was invalid");
  resolveLoginDestination(marker.destination, origin);
}

export function requireUnauthenticatedApp(response: SmokeResponse, origin: string, body?: string): void {
  requirePrivateHeaders(response, "/app");
  if (REDIRECT_STATUSES.has(response.status)) {
    const destination = response.headers.location;
    if (!destination) fail("/app redirect had no Location header");
    resolveLoginDestination(destination, origin);
    return;
  }
  if (response.status !== 200) fail(`/app returned ${response.status}, expected a redirect or streamed redirect`);
  requireStreamedLoginRedirect(response, body ?? "", origin);
}

export function requireRobots(robotsText: string): void {
  if (!/^Allow:\s*\/$/m.test(robotsText)) fail("robots.txt does not allow the public root");
  for (const prefix of PRIVATE_PREFIXES) {
    if (!new RegExp(`^Disallow:\\s*${prefix.replace("*", "\\*")}$`, "m").test(robotsText)) fail(`robots.txt does not disallow ${prefix}`);
  }
  if (!robotsText.includes("Sitemap: https://idr.wildan.lol/sitemap.xml")) fail("robots.txt has the wrong sitemap URL");
}

export function requireServiceWorker(response: SmokeResponse): void {
  requireStatus(response, "/sw.js", 200);
  const contentType = response.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() || "";
  if (!JAVASCRIPT_CONTENT_TYPES.has(contentType)) fail("/sw.js returned a non-JavaScript content type");
  const body = bodyText(response);
  if (!body.trim()) fail("/sw.js returned an empty body");
  if (/<(?:!doctype\s+html|html\b)/i.test(body)) fail("/sw.js returned an HTML document");
  if (!/\bself\.addEventListener\s*\(\s*["']install["']/.test(body)) fail("/sw.js is missing an install handler");
  if (!/\bself\.addEventListener\s*\(\s*["']fetch["']/.test(body)) fail("/sw.js is missing a fetch handler");
}

async function run(): Promise<void> {
  const origin = baseOrigin();
  const health = await get(origin, "/healthz");
  await readHealthResponse(health);
  requireHeader(health, "/healthz", "cache-control", "no-store");

  const publicPage = await get(origin, "/");
  requireStatus(publicPage, "/", 200);
  const publicContent = bodyText(publicPage);
  if (!/Zplit/i.test(publicContent) || !/shared expenses/i.test(publicContent)) fail("/ did not contain recognizable Zplit content");

  const login = await get(origin, "/login");
  requireStatus(login, "/login", 200);
  requirePrivateHeaders(login, "/login");

  const app = await get(origin, "/app");
  requireUnauthenticatedApp(app, origin, app.status === 200 ? bodyText(app) : undefined);

  const robots = await get(origin, "/robots.txt");
  requireStatus(robots, "/robots.txt", 200);
  const robotsText = bodyText(robots);
  requireRobots(robotsText);

  const sitemap = await get(origin, "/sitemap.xml");
  requireStatus(sitemap, "/sitemap.xml", 200);
  const sitemapText = bodyText(sitemap);
  const locations = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, value]) => value);
  if (locations.length !== 1 || locations[0] !== "https://idr.wildan.lol/") fail("sitemap.xml must contain only the public root");

  requireStatus(await get(origin, "/manifest.webmanifest"), "/manifest.webmanifest", 200);
  requireServiceWorker(await get(origin, "/sw.js"));

  for (const [name, value] of [
    ["strict-transport-security", "max-age=31536000"],
    ["content-security-policy", "default-src 'self'"],
    ["content-security-policy", "frame-ancestors 'none'"],
    ["x-content-type-options", "nosniff"],
    ["permissions-policy", "camera=()"],
    ["referrer-policy", "same-origin"],
    ["cross-origin-opener-policy", "same-origin"],
  ] as const) requireHeader(publicPage, "/", name, value);
  requirePublicServerHeader(publicPage);

  console.log("release smoke passed");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await run();
  } catch (error) {
    console.error(`release smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
