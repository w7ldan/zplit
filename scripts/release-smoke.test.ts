import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  readHealthResponse,
  requestHttps,
  requireRobots,
  requireServiceWorker,
  requireStatus,
  requireUnauthenticatedApp,
  type HttpsRequest,
  type SmokeResponse,
} from "./release-smoke";

const origin = "https://idr.wildan.lol";
const privateHeaders = {
  "content-type": "text/html; charset=utf-8",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "cache-control": "no-store",
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

type FakeIncoming = EventEmitter & {
  statusCode?: number;
  headers: Record<string, string | string[]>;
  destroy: () => void;
};

class FakeRequest extends EventEmitter {
  destroyed = false;
  timeoutCallback?: () => void;

  setTimeout(_milliseconds: number, callback: () => void): this {
    this.timeoutCallback = callback;
    return this;
  }

  end(): this {
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

function fakeRequest(options: {
  status?: number;
  headers?: Record<string, string | string[]>;
  chunks?: string[];
  event?: "aborted" | "close";
  requestError?: boolean;
  contentLength?: string;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const handle = new FakeRequest();
  const requester = ((requestOptions: Record<string, unknown>, callback: (response: FakeIncoming) => void) => {
    calls.push(requestOptions);
    if (options.requestError) {
      queueMicrotask(() => handle.emit("error", new Error("synthetic request error")));
      return handle;
    }
    queueMicrotask(() => {
      const incoming = new EventEmitter() as FakeIncoming;
      incoming.statusCode = options.status;
      incoming.headers = { ...(options.headers ?? {}), ...(options.contentLength ? { "Content-Length": options.contentLength } : {}) };
      incoming.destroy = () => undefined;
      callback(incoming);
      for (const chunk of options.chunks ?? []) incoming.emit("data", Buffer.from(chunk));
      if (options.event) incoming.emit(options.event);
      else {
        incoming.emit("end");
        incoming.emit("close");
      }
    });
    return handle;
  }) as unknown as HttpsRequest;
  return { calls, handle, requester };
}

function response(status: number, headers: Record<string, string> = privateHeaders, body = ""): SmokeResponse {
  return { status, headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])), body: Buffer.from(body), url: `${origin}/app` };
}

function streamedRedirect(destination = "/login", status = 307, extra = "") {
  return `<html><script>self.__next_f.push([1,"5:E{\\"digest\\":\\"NEXT_REDIRECT;replace;${destination};${status};\\"}${extra}"])</script></html>`;
}

describe("/healthz response parsing", () => {
  it("accepts valid JSON", async () => {
    await expect(readHealthResponse(response(200, jsonHeaders, '{"status":"ok"}'))).resolves.toBeUndefined();
  });

  it("accepts insignificant JSON whitespace", async () => {
    await expect(readHealthResponse(response(200, jsonHeaders, '  {\n  "status": "ok"\n}  '))).resolves.toBeUndefined();
  });

  it("rejects an empty body", async () => {
    await expect(readHealthResponse(response(200, jsonHeaders, ""))).rejects.toThrow(/empty body/);
  });

  it("rejects malformed JSON", async () => {
    await expect(readHealthResponse(response(200, jsonHeaders, '{"status":'))).rejects.toThrow(/malformed JSON/);
  });

  it("rejects the wrong content type", async () => {
    await expect(readHealthResponse(response(200, { "content-type": "text/html" }, '{"status":"ok"}'))).rejects.toThrow(/non-JSON content type/);
  });

  it("rejects the wrong status", async () => {
    await expect(readHealthResponse(response(503, jsonHeaders, '{"status":"ok"}'))).rejects.toThrow(/unexpected status/);
  });

  it("rejects the wrong payload shape", async () => {
    await expect(readHealthResponse(response(200, jsonHeaders, '{"status":"ok","extra":true}'))).rejects.toThrow(/unexpected JSON payload/);
  });

  it("consumes the body exactly once", async () => {
    const health = response(200, jsonHeaders, '{"status":"ok"}');
    await readHealthResponse(health);
    expect(health.body.toString()).toBe('{"status":"ok"}');
  });

  it("does not let a prior status assertion consume the health body", async () => {
    const health = response(200, jsonHeaders, '{"status":"ok"}');
    requireStatus(health, "/healthz", 200);
    await expect(readHealthResponse(health)).resolves.toBeUndefined();
  });
});

describe("deterministic HTTPS requester", () => {
  it("captures JSON, preserves redirects, normalizes headers, and sends safe TLS headers", async () => {
    const fake = fakeRequest({ status: 307, headers: { "Content-Type": "application/json", Location: "/login" }, chunks: ["{}"] });
    const result = await requestHttps(origin, "/healthz", fake.requester);
    expect(result.status).toBe(307);
    expect(result.headers).toMatchObject({ "content-type": "application/json", location: "/login" });
    expect(result.body.toString()).toBe("{}");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ method: "GET", protocol: "https:", hostname: "idr.wildan.lol", family: 4, servername: "idr.wildan.lol", rejectUnauthorized: true });
    expect(fake.calls[0].headers).toMatchObject({ "Accept-Encoding": "identity", Connection: "close", "User-Agent": "zplit-release-smoke/1" });
  });

  it("rejects a request timeout", async () => {
    const fake = fakeRequest({});
    const pending = requestHttps(origin, "/healthz", fake.requester);
    fake.handle.timeoutCallback?.();
    await expect(pending).rejects.toThrow(/timed out/);
    expect(fake.handle.destroyed).toBe(true);
  });

  it("rejects request errors", async () => {
    const fake = fakeRequest({ requestError: true });
    await expect(requestHttps(origin, "/healthz", fake.requester)).rejects.toThrow(/HTTPS request failed/);
  });

  it.each([
    ["aborted", { event: "aborted" as const }],
    ["premature close", { event: "close" as const }],
  ])("rejects a response that is %s", async (_name, options) => {
    const fake = fakeRequest(options);
    await expect(requestHttps(origin, "/healthz", fake.requester)).rejects.toThrow(/response/);
  });

  it("rejects an oversized response", async () => {
    const fake = fakeRequest({ status: 200, contentLength: String(1024 * 1024 + 1) });
    await expect(requestHttps(origin, "/healthz", fake.requester)).rejects.toThrow(/exceeded/);
  });

  it("buffers the response body once", async () => {
    const fake = fakeRequest({ status: 200, chunks: ['{"status":', '"ok"}'] });
    const result = await requestHttps(origin, "/healthz", fake.requester);
    expect(result.body.toString()).toBe('{"status":"ok"}');
  });
});

describe("unauthenticated /app release-smoke assertion", () => {
  it("accepts a normal 307 redirect to /login", () => {
    expect(() => requireUnauthenticatedApp(response(307, { ...privateHeaders, location: "/login" }), origin)).not.toThrow();
  });

  it("accepts another valid temporary redirect status", () => {
    expect(() => requireUnauthenticatedApp(response(302, { ...privateHeaders, location: "/login" }), origin)).not.toThrow();
  });

  it("accepts an observed streamed Next.js redirect to /login", () => {
    expect(() => requireUnauthenticatedApp(response(200, privateHeaders, streamedRedirect()), origin, streamedRedirect())).not.toThrow();
  });

  it("rejects a normal /login link without a streamed redirect", () => {
    expect(() => requireUnauthenticatedApp(response(200, privateHeaders, '<a href="/login">Log in</a>'), origin, '<a href="/login">Log in</a>')).toThrow();
  });

  it("rejects a streamed redirect to another path", () => {
    const body = streamedRedirect("/app/settings");
    expect(() => requireUnauthenticatedApp(response(200, privateHeaders, body), origin, body)).toThrow();
  });

  it("rejects a streamed redirect to another origin", () => {
    const body = streamedRedirect("https://evil.example/login");
    expect(() => requireUnauthenticatedApp(response(200, privateHeaders, body), origin, body)).toThrow();
  });

  it("rejects malformed, delayed, and duplicate markers", () => {
    const malformed = '<script>self.__next_f.push([1,"NEXT_REDIRECT;replace;/login;"])</script>';
    const delayed = '<script>setTimeout(() => self.__next_f.push([1,"NEXT_REDIRECT;replace;/login;307;"]), 10)</script>';
    const duplicate = `${streamedRedirect()}${streamedRedirect()}`;
    for (const body of [malformed, delayed, duplicate]) {
      expect(() => requireUnauthenticatedApp(response(200, privateHeaders, body), origin, body)).toThrow();
    }
  });

  it("rejects authenticated content combined with a redirect marker", () => {
    const body = `${streamedRedirect()}<h1>PRIVATE LEDGER</h1><p>person@example.com</p>`;
    expect(() => requireUnauthenticatedApp(response(200, privateHeaders, body), origin, body)).toThrow();
  });

  it("rejects HTTP 200 without a redirect", () => {
    const body = "<html><body>Welcome</body></html>";
    expect(() => requireUnauthenticatedApp(response(200, privateHeaders, body), origin, body)).toThrow();
  });

  it("rejects missing private headers", () => {
    const body = streamedRedirect();
    expect(() => requireUnauthenticatedApp(response(307, { location: "/login" }), origin, body)).toThrow();
  });
});

describe("crawler response assertions", () => {
  it("accepts the public crawler rules", () => {
    const text = [
      "Allow: /",
      "Disallow: /app",
      "Disallow: /api",
      "Disallow: /login",
      "Disallow: /join",
      "Disallow: /share",
      "Disallow: /healthz",
      "Disallow: /offline",
      "Sitemap: https://idr.wildan.lol/sitemap.xml",
    ].join("\n");
    expect(() => requireRobots(text)).not.toThrow();
  });

  it("rejects incomplete crawler rules", () => {
    expect(() => requireRobots("Allow: /\nSitemap: https://idr.wildan.lol/sitemap.xml")).toThrow(/does not disallow \/app/);
  });
});

describe("service-worker response assertions", () => {
  const javascriptHeaders = { "content-type": "application/javascript; charset=utf-8" };
  const validWorker = 'self.addEventListener("install", () => {}); self.addEventListener("fetch", () => {});';

  it("accepts a valid non-empty JavaScript service worker", () => {
    expect(() => requireServiceWorker(response(200, javascriptHeaders, validWorker))).not.toThrow();
  });

  it("rejects an HTML 404 document", () => {
    expect(() => requireServiceWorker(response(404, { "content-type": "text/html" }, "<!doctype html><html><body>404</body></html>"))).toThrow(/expected 200/);
  });

  it("rejects an empty service worker", () => {
    expect(() => requireServiceWorker(response(200, javascriptHeaders, ""))).toThrow(/empty body/);
  });

  it("rejects a non-JavaScript content type", () => {
    expect(() => requireServiceWorker(response(200, { "content-type": "text/html" }, validWorker))).toThrow(/non-JavaScript/);
  });

  it("rejects a body without both service-worker event handlers", () => {
    expect(() => requireServiceWorker(response(200, javascriptHeaders, 'self.addEventListener("install", () => {});'))).toThrow(/fetch handler/);
  });
});

it("keeps the existing release-smoke coverage", () => {
  const source = readFileSync("scripts/release-smoke.ts", "utf8");
  for (const path of ["/healthz", "/", "/login", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/sw.js"]) expect(source).toContain(path);
  for (const header of ["strict-transport-security", "content-security-policy", "x-content-type-options", "permissions-policy", "referrer-policy", "cross-origin-opener-policy"]) expect(source).toContain(header);
  expect(source).toContain('publicPage.headers.server');
  expect(source).not.toContain("fetch(");
});
