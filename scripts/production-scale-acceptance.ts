import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { buildLedgerSummary } from "../src/domain/ledger-summary";
import { createLedgerRepository, type RecentActivityRecord } from "../src/domain/ledger-repository";
import { RECORD_PAGE_SIZE } from "../src/domain/record-retrieval";
import {
  SCALE_FIXTURE_CONFIRMATION,
  SCALE_FIXTURE_COUNTS,
  SCALE_FIXTURE_DATABASE,
  generateScaleFixture,
} from "./scale-fixture-data";

export const PERFORMANCE_BUDGETS = {
  overviewSummaryMs: 500,
  recentActivityMs: 100,
  recordPageMs: 300,
  selectorSearchMs: 200,
  selectedFriendContextMs: 300,
} as const;

export const SCALE_APP_PATHS = [
  "/app",
  "/app/friends",
  "/app/outings",
  "/app/expenses",
  "/app/repayments",
] as const;

export const RESOURCE_GATE = {
  minimumAvailableMemoryBytes: 700 * 1024 * 1024,
  minimumFreeDiskBytes: 4 * 1024 * 1024 * 1024,
  recentOomWindow: "10 minutes",
} as const;

export const PRODUCTION_SERVER = {
  host: "127.0.0.1",
  port: 3001,
  pageTimeLimitMs: 1_500,
  htmlByteLimit: 500 * 1024,
} as const;

type Environment = Record<string, string | undefined>;

export type ResourceSnapshot = {
  availableMemoryBytes: number;
  freeDiskBytes: number;
  competingProcesses: string[];
  recentOomEvents: string[];
};

type RecordPage = {
  items: Array<{ id: string }>;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type DomainFingerprint = Record<string, { count: number; digest: string }>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function required(name: string, environment: Environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function validateAcceptanceEnvironment(environment: Environment = process.env) {
  if (environment.DB_NAME?.trim() !== SCALE_FIXTURE_DATABASE) {
    throw new Error(`DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
  }
  if (environment.ZPLIT_SCALE_TEST_CONFIRM?.trim() !== SCALE_FIXTURE_CONFIRMATION) {
    throw new Error(`ZPLIT_SCALE_TEST_CONFIRM must be ${SCALE_FIXTURE_CONFIRMATION}`);
  }
  return { ownerEmail: required("SCALE_TEST_OWNER_EMAIL", environment) };
}

export function validateResourceGate(snapshot: ResourceSnapshot) {
  if (snapshot.availableMemoryBytes < RESOURCE_GATE.minimumAvailableMemoryBytes) {
    throw new Error("resource gate failed: available memory is below 700 MiB");
  }
  if (snapshot.freeDiskBytes < RESOURCE_GATE.minimumFreeDiskBytes) {
    throw new Error("resource gate failed: free disk is below 4 GiB");
  }
  if (snapshot.competingProcesses.length > 0) {
    throw new Error(`resource gate failed: competing Next.js process: ${snapshot.competingProcesses[0]}`);
  }
  if (snapshot.recentOomEvents.length > 0) {
    throw new Error(`resource gate failed: recent OOM event: ${snapshot.recentOomEvents[0]}`);
  }
}

function availableMemoryBytes() {
  try {
    const available = readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    if (available) return Number(available[1]) * 1024;
  } catch {
    // Use the portable fallback below when procfs is unavailable.
  }
  return os.freemem();
}

function processList() {
  return execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith(`${process.pid} `));
}

function competingNextProcesses() {
  return processList().filter((line) => /(?:next\/dist\/bin\/next|(?:^|\s)next(?:-server)?\b)[^\n]*\b(?:build|dev)\b/i.test(line));
}

function recentOomEvents() {
  try {
    const output = execFileSync("journalctl", ["-k", "--since", "10 minutes ago", "--no-pager", "-q"], { encoding: "utf8" });
    return output.split("\n").filter((line) => /out of memory|oom|killed process|memory cgroup/i.test(line));
  } catch (error) {
    throw new Error(`resource gate could not inspect recent OOM events: ${error instanceof Error ? error.message : "journalctl failed"}`);
  }
}

function readResourceGate(cwd = process.cwd()): ResourceSnapshot {
  const disk = statfsSync(cwd);
  return {
    availableMemoryBytes: availableMemoryBytes(),
    freeDiskBytes: Number(disk.bavail) * Number(disk.bsize),
    competingProcesses: competingNextProcesses(),
    recentOomEvents: recentOomEvents(),
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure<T>(label: string, budget: number, operation: () => Promise<T>) {
  await operation();
  const durations: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  const result = median(durations);
  console.log(`${label} warm median: ${result.toFixed(1)} ms (budget ${budget} ms)`);
  assert(result <= budget, `${label} warm median exceeded ${budget} ms`);
  return result;
}

async function resolveOwner(client: PoolClient, email: string) {
  const result = await client.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  assert(result.rows.length === 1, "SCALE_TEST_OWNER_EMAIL must resolve exactly one existing test user");
  return result.rows[0]!.id;
}

function assertBoundedOptions(label: string, options: Array<{ id: string }>) {
  assert(options.length <= 20, `${label} returned more than 20 options`);
  assert(new Set(options.map((option) => option.id)).size === options.length, `${label} returned duplicate options`);
  assert(options.every((option) => option.id), `${label} returned an invalid option`);
}

async function checkListing(
  label: string,
  expectedTotal: number,
  load: (page: number) => Promise<RecordPage>,
) {
  const expectedPages = Math.max(1, Math.ceil(expectedTotal / RECORD_PAGE_SIZE));
  const first = await load(1);
  assert(first.page === 1, `${label} first page is not page 1`);
  assert(first.pageSize === RECORD_PAGE_SIZE, `${label} page size is not ${RECORD_PAGE_SIZE}`);
  assert(first.items.length === Math.min(RECORD_PAGE_SIZE, expectedTotal), `${label} first page is not bounded to the expected result set`);
  assert(first.totalItems === expectedTotal, `${label} total count does not match the scale fixture`);
  assert(first.totalPages === expectedPages, `${label} total page count does not match the scale fixture`);
  assert(new Set(first.items.map((item) => item.id)).size === first.items.length, `${label} first page contains duplicate records`);

  if (expectedTotal > RECORD_PAGE_SIZE) {
    const second = await load(2);
    assert(second.page === 2, `${label} adjacent page is not page 2`);
    assert(second.pageSize === RECORD_PAGE_SIZE, `${label} adjacent page size is not ${RECORD_PAGE_SIZE}`);
    assert(second.items.length === Math.min(RECORD_PAGE_SIZE, expectedTotal - RECORD_PAGE_SIZE), `${label} adjacent page is not bounded`);
    assert(second.totalItems === expectedTotal, `${label} adjacent page total count does not match the scale fixture`);
    assert(second.totalPages === expectedPages, `${label} adjacent page count does not match the scale fixture`);
    const firstIds = new Set(first.items.map((item) => item.id));
    assert(new Set(second.items.map((item) => item.id)).size === second.items.length, `${label} adjacent page contains duplicate records`);
    assert(second.items.every((item) => !firstIds.has(item.id)), `${label} adjacent pages contain duplicate records`);
  }
}

function expectedActivity(fixture: ReturnType<typeof generateScaleFixture>) {
  const outingDates = new Map(fixture.outings.map((outing) => [outing.id, outing.occurredAt]));
  return [
    ...fixture.expenses.map((expense) => ({ kind: "Expense" as const, id: expense.id, effectiveAt: outingDates.get(expense.outingId)!.getTime(), createdAt: expense.createdAt.getTime() })),
    ...fixture.repayments.map((repayment) => ({ kind: "Repayment" as const, id: repayment.id, effectiveAt: repayment.paidAt.getTime(), createdAt: repayment.createdAt.getTime() })),
  ].sort((left, right) => {
    if (left.effectiveAt !== right.effectiveAt) return right.effectiveAt - left.effectiveAt;
    if (left.kind !== right.kind) return left.kind === "Expense" ? -1 : 1;
    if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  }).slice(0, 6);
}

function assertOverview(
  overview: Awaited<ReturnType<ReturnType<typeof createLedgerRepository>["getLedgerOverviewSummary"]>>,
  expected: ReturnType<typeof buildLedgerSummary>,
) {
  for (const field of [
    "totalExpenseAmount",
    "totalAssignedAmount",
    "totalRepaidAmount",
    "totalReceivedAmount",
    "totalUnallocatedRepaymentAmount",
    "totalOutstandingAmount",
    "ownerPortionAmount",
  ] as const) assert(overview[field] === expected[field], `${field} does not match the deterministic fixture`);
  assert(overview.totalAssignedFriendCount === expected.friendBalances.length, "assigned friend count does not match the deterministic fixture");
  assert(overview.friendBalances.length <= 8, "overview returned more than eight friend balances");
  assert(JSON.stringify(overview.friendBalances) === JSON.stringify(expected.friendBalances.slice(0, 8)), "overview friend balances do not match the deterministic fixture");
}

function assertRecentActivity(activity: RecentActivityRecord[], fixture: ReturnType<typeof generateScaleFixture>) {
  const expected = expectedActivity(fixture);
  assert(activity.length === expected.length && activity.length <= 6, "recent activity is not bounded to six deterministic records");
  assert(JSON.stringify(activity.map(({ kind, id }) => ({ kind, id }))) === JSON.stringify(expected.map(({ kind, id }) => ({ kind, id }))), "recent activity records do not match the deterministic fixture");
}

async function readDomainFingerprint(pool: ReturnType<typeof createDatabasePool>, ownerUserId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const fingerprint = await domainFingerprint(client, ownerUserId);
    await client.query("COMMIT");
    return fingerprint;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function domainFingerprint(client: PoolClient, ownerUserId: string): Promise<DomainFingerprint> {
  const tables = [
    ["friends", "t.id"],
    ["outings", "t.id"],
    ["expenses", "t.id"],
    ["expense_receipts", "t.id"],
    ["expense_shares", "t.id"],
    ["repayments", "t.id"],
    ["repayment_allocations", "t.repayment_id, t.expense_share_id"],
  ] as const;
  const result: DomainFingerprint = {};
  for (const [table, orderBy] of tables) {
    const row = (await client.query<{ count: number | string; digest: string }>(
      `SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY ${orderBy}), '')) AS digest FROM "${table}" t WHERE t.owner_user_id = $1`,
      [ownerUserId],
    )).rows[0]!;
    result[table] = { count: Number(row.count), digest: row.digest };
  }
  return result;
}

async function runDatabaseAcceptance(ownerEmail: string) {
  const pool = createDatabasePool(readRuntimeDatabaseConfig());
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transactionStarted = true;
    const ownerUserId = await resolveOwner(client, ownerEmail);
    const fixture = generateScaleFixture(ownerUserId);
    const expected = buildLedgerSummary({
      friends: fixture.friends,
      expenses: fixture.expenses,
      expenseShares: fixture.expenseShares,
      repayments: fixture.repayments,
      repaymentAllocations: fixture.repaymentAllocations,
    });
    const repository = createLedgerRepository(drizzle(client, { schema }), ownerUserId);
    const contextRepository = createLedgerRepository(drizzle(pool, { schema }), ownerUserId);

    const overview = await repository.getLedgerOverviewSummary();
    assertOverview(overview, expected);
    const activity = await repository.listRecentActivity({ limit: 6 });
    assertRecentActivity(activity, fixture);
    await measure("overview summary", PERFORMANCE_BUDGETS.overviewSummaryMs, () => repository.getLedgerOverviewSummary());
    await measure("recent activity", PERFORMANCE_BUDGETS.recentActivityMs, () => repository.listRecentActivity({ limit: 6 }));

    const activeFriends = fixture.friends.filter((friend) => friend.archivedAt === null).length;
    const archivedFriends = fixture.friends.filter((friend) => friend.archivedAt !== null).length;
    await checkListing("Friends", activeFriends, (page) => repository.listFriendRecords({ page }));
    await checkListing("Outings", fixture.outings.length, (page) => repository.listOutingRecords({ page }));
    await checkListing("Expenses", fixture.expenses.length, (page) => repository.listExpenseRecords({ page }));
    await checkListing("Repayments", fixture.repayments.length, (page) => repository.listRepaymentRecords({ page }));
    await checkListing("Archived friends", archivedFriends, (page) => repository.listFriendRecords({ archived: true, page }));
    await measure("Friends page", PERFORMANCE_BUDGETS.recordPageMs, () => repository.listFriendRecords({ page: 1 }));
    await measure("Outings page", PERFORMANCE_BUDGETS.recordPageMs, () => repository.listOutingRecords({ page: 1 }));
    await measure("Expenses page", PERFORMANCE_BUDGETS.recordPageMs, () => repository.listExpenseRecords({ page: 1 }));
    await measure("Repayments page", PERFORMANCE_BUDGETS.recordPageMs, () => repository.listRepaymentRecords({ page: 1 }));
    await measure("Archived friends page", PERFORMANCE_BUDGETS.recordPageMs, () => repository.listFriendRecords({ archived: true, page: 1 }));

    const emptyOutings = await repository.searchOutings();
    const emptyFriends = await repository.searchFriends();
    assertBoundedOptions("empty outing search", emptyOutings);
    assertBoundedOptions("empty friend search", emptyFriends);
    const archivedIndex = emptyFriends.findIndex((friend) => friend.archived);
    assert(archivedIndex < 0 || emptyFriends.slice(archivedIndex).every((friend) => friend.archived), "active friends must precede archived friends");
    const selectedOutingId = fixture.outings.at(-1)!.id;
    const selectedFriendId = fixture.friends.at(-1)!.id;
    const searchedOutings = await repository.searchOutings({ q: "Scale outing 2" });
    const searchedFriends = await repository.searchFriends({ q: "Scale friend 0" });
    assertBoundedOptions("searched outing", searchedOutings);
    assertBoundedOptions("searched friend", searchedFriends);
    assert(searchedOutings.length > 0 && searchedOutings.every((outing) => outing.title.toLowerCase().includes("scale outing 2")), "searched outing selector returned a non-matching option");
    assert(searchedFriends.length > 0 && searchedFriends.every((friend) => friend.name.toLowerCase().includes("scale friend 0")), "searched friend selector returned a non-matching option");
    await measure("Outings empty selector", PERFORMANCE_BUDGETS.selectorSearchMs, () => repository.searchOutings());
    await measure("Outings searched selector", PERFORMANCE_BUDGETS.selectorSearchMs, () => repository.searchOutings({ q: "Scale outing 2" }));
    await measure("Friends empty selector", PERFORMANCE_BUDGETS.selectorSearchMs, () => repository.searchFriends());
    await measure("Friends searched selector", PERFORMANCE_BUDGETS.selectorSearchMs, () => repository.searchFriends({ q: "Scale friend 0" }));

    const selectedOuting = await repository.searchOutings({ q: "does-not-match", selectedId: selectedOutingId });
    const selectedFriend = await repository.searchFriends({ q: "does-not-match", selectedId: selectedFriendId });
    assertBoundedOptions("selected outing search", selectedOuting);
    assertBoundedOptions("selected friend search", selectedFriend);
    assert(selectedOuting[0]?.id === selectedOutingId, "selected outing was dropped or not prioritized in search results");
    assert(selectedFriend[0]?.id === selectedFriendId, "selected friend was dropped or not prioritized in search results");

    const context = await contextRepository.getRepaymentFriendContext(selectedFriendId, true);
    assert(context.option.id === selectedFriendId, "selected friend context returned the wrong option");
    assert(Number.isSafeInteger(context.outstandingAmount), "selected friend context returned an invalid balance");
    assert(context.openExpenseShares.length <= fixture.expenseShares.length, "selected friend context returned an unbounded share collection");
    const expectedBalance = expected.friendBalances.find((friend) => friend.friendId === selectedFriendId)?.outstandingAmount ?? 0;
    assert(context.outstandingAmount === expectedBalance, "selected friend context balance does not match the deterministic fixture");
    await measure("Selected friend context", PERFORMANCE_BUDGETS.selectedFriendContextMs, () => contextRepository.getRepaymentFriendContext(selectedFriendId, true));

    assert(fixture.friends.length === SCALE_FIXTURE_COUNTS.friends, "friend fixture count changed");
    assert(fixture.outings.length === SCALE_FIXTURE_COUNTS.outings, "outing fixture count changed");
    assert(fixture.expenses.length === SCALE_FIXTURE_COUNTS.expenses, "expense fixture count changed");
    assert(fixture.repayments.length === SCALE_FIXTURE_COUNTS.repayments, "repayment fixture count changed");
    await client.query("ROLLBACK");
    transactionStarted = false;
    console.log("database acceptance passed: bounded pages/selectors, deterministic totals, context, adjacent-page uniqueness, and read-only transaction verified");
    return { ownerUserId };
  } finally {
    if (client && transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    client?.release();
    await pool.end();
  }
}

function commandOutput(child: ChildProcess) {
  child.stdout?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    process.stdout.write(text);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    process.stderr.write(text);
  });
}

function runCommand(command: string, args: string[], environment: Environment) {
  return new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: environment as NodeJS.ProcessEnv });
    commandOutput(child);
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`${command} ${args.join(" ")} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

function processTreeRssBytes(rootPid: number) {
  try {
    const rows = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((row) => row.length === 3 && row.every(Number.isFinite))
      .map(([pid, ppid, rss]) => ({ pid, ppid, rss }));
    const children = new Map<number, number[]>();
    for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
    const pids = [rootPid];
    for (let index = 0; index < pids.length; index += 1) pids.push(...(children.get(pids[index]!) ?? []));
    const selected = new Set(pids);
    return rows.filter((row) => selected.has(row.pid)).reduce((sum, row) => sum + row.rss * 1024, 0);
  } catch {
    return 0;
  }
}

function serverRunning(child: ChildProcess, exit: { code: number | null; signal: NodeJS.Signals | null }) {
  if (exit.code !== null || exit.signal !== null || child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`production server exited with ${exit.signal ?? child.signalCode ?? `code ${exit.code ?? child.exitCode}`}`);
  }
  assert(child.pid, "production server did not expose a process ID");
}

async function wait(milliseconds: number) {
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function waitForHealth(origin: string, child: ChildProcess, exit: { code: number | null; signal: NodeJS.Signals | null }) {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    serverRunning(child, exit);
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      if (response.status === 200 && body.includes('"status":"ok"')) return;
    } catch {
      // The production process may still be listening.
    }
    await wait(100);
  }
  throw new Error("production server did not become healthy within 30 seconds");
}

function setCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return (headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""]).filter(Boolean);
}

async function signIn(origin: string, email: string) {
  const password = readFileSync(required("OWNER_PASSWORD_FILE"), "utf8").trim();
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password, rememberMe: true }),
    redirect: "manual",
  });
  await response.arrayBuffer();
  assert(response.ok, `test-only production sign-in failed with ${response.status}`);
  const cookie = setCookies(response).map((value) => value.split(";", 1)[0]).join("; ");
  assert(cookie, "test-only production sign-in did not set a session cookie");
  return cookie;
}

async function signOut(origin: string, cookie: string) {
  const response = await fetch(`${origin}/api/auth/sign-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
    body: "{}",
  });
  await response.arrayBuffer();
  assert(response.ok, `test-only production sign-out failed with ${response.status}`);
}

async function requestPage(origin: string, requestPath: string, cookie: string, warmup = false) {
  const started = performance.now();
  const response = await fetch(`${origin}${requestPath}`, {
    headers: { Accept: "text/html", Cookie: cookie, "User-Agent": "zplit-production-scale-acceptance/1" },
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  const duration = performance.now() - started;
  assert(response.status >= 200 && response.status < 300, `${requestPath} returned ${response.status}`);
  assert(response.headers.get("content-type")?.toLowerCase().startsWith("text/html"), `${requestPath} did not return HTML`);
  assert(body.byteLength <= PRODUCTION_SERVER.htmlByteLimit, `${requestPath} HTML exceeded 500 KiB`);
  const marker = requestPath === "/app" ? "Overview" : requestPath.slice("/app/".length)[0]!.toUpperCase() + requestPath.slice("/app/".length + 1);
  assert(body.toString("utf8").includes(marker), `${requestPath} did not return authenticated page content`);
  if (!warmup) {
    console.log(`production ${requestPath}: status=${response.status} response=${duration.toFixed(1)} ms html=${body.byteLength} bytes`);
    assert(duration <= PRODUCTION_SERVER.pageTimeLimitMs, `${requestPath} exceeded 1.5 seconds after warm-up`);
  }
  return { duration, bytes: body.byteLength };
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())), wait(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function runProductionRuntime(ownerEmail: string, ownerUserId: string) {
  const resourceSnapshot = readResourceGate();
  validateResourceGate(resourceSnapshot);
  console.log(`resource gate passed: memory=${Math.round(resourceSnapshot.availableMemoryBytes / 1024 / 1024)} MiB disk=${Math.round(resourceSnapshot.freeDiskBytes / 1024 / 1024 / 1024)} GiB`);

  const origin = `http://${PRODUCTION_SERVER.host}:${PRODUCTION_SERVER.port}`;
  const environment = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", BETTER_AUTH_URL: origin, DB_NAME: SCALE_FIXTURE_DATABASE } as NodeJS.ProcessEnv;
  const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
  await runCommand(process.execPath, [nextBin, "build"], environment);
  console.log("production build passed once against zplit_scale_test");

  const server = spawn(process.execPath, [nextBin, "start", "-H", PRODUCTION_SERVER.host, "-p", String(PRODUCTION_SERVER.port)], {
    cwd: process.cwd(),
    env: environment,
  });
  commandOutput(server);
  const exit = { code: null as number | null, signal: null as NodeJS.Signals | null };
  server.once("exit", (code, signal) => { exit.code = code; exit.signal = signal; });
  let peakRssBytes = 0;
  const sampleRss = () => { if (server.pid) peakRssBytes = Math.max(peakRssBytes, processTreeRssBytes(server.pid)); };
  const rssTimer = setInterval(sampleRss, 100);
  let cookie = "";
  const pool = createDatabasePool(readRuntimeDatabaseConfig());
  try {
    await waitForHealth(origin, server, exit);
    cookie = await signIn(origin, ownerEmail);
    const before = await readDomainFingerprint(pool, ownerUserId);
    for (const requestPath of SCALE_APP_PATHS) {
      serverRunning(server, exit);
      await waitForHealth(origin, server, exit);
      await requestPage(origin, requestPath, cookie, true);
    }
    for (const requestPath of SCALE_APP_PATHS) {
      serverRunning(server, exit);
      await waitForHealth(origin, server, exit);
      await requestPage(origin, requestPath, cookie);
      sampleRss();
    }
    await waitForHealth(origin, server, exit);
    const after = await readDomainFingerprint(pool, ownerUserId);
    assert(JSON.stringify(after) === JSON.stringify(before), "authenticated production page queries changed domain data");
    await signOut(origin, cookie);
    cookie = "";
    console.log(`production runtime passed: ${SCALE_APP_PATHS.length} authenticated pages, peak RSS=${(peakRssBytes / 1024 / 1024).toFixed(1)} MiB`);
  } finally {
    if (cookie) await signOut(origin, cookie).catch(() => undefined);
    clearInterval(rssTimer);
    await stopServer(server);
    await pool.end();
  }
}

export async function runProductionScaleAcceptance(environment: Environment = process.env) {
  const { ownerEmail } = validateAcceptanceEnvironment(environment);
  const { ownerUserId } = await runDatabaseAcceptance(ownerEmail);
  await runProductionRuntime(ownerEmail, ownerUserId);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runProductionScaleAcceptance().catch((error) => {
    console.error(error instanceof Error ? error.message : "production scale acceptance failed");
    process.exitCode = 1;
  });
}
