import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const help = `Fictional native Claude in-app acceptance (Windows only; NO live Claude/models).
Prerequisites: Node 24, restored repository dependencies, an existing production build
(npm run build), Microsoft Edge, .NET Framework csc.exe, installed playwright-core 1.58.2.
No downloads/installations are performed. No credentials or existing browser profile are used.
From repository root:
  node scripts\\testing\\claude-in-app\\run.mjs
Optional: --edge <absolute msedge.exe> --csc <absolute csc.exe>
Pass --playwright <absolute index.mjs path> only if using a separate Playwright install.
Stages the build, native executable, SQLite, isolated browser/home and scratch files ONLY
under scripts\\testing\\claude-in-app\\.run-<unique>; removes that exact directory afterward.
Does not modify the source build or use existing household data. Hard deadline: 150 seconds.
PASS requires UI refusal/cancel/success, native process evidence, real SQLite acceptance,
server restart/re-display, no duplicate acceptance, no pairing, no browser external requests.
Deep Windows checkouts require working 8.3 short paths for Edge's profile path limit.
This is fictional transport validation, NOT Claude compatibility or Linux validation.`;
const args = process.argv.slice(2);
if (args.includes("--help")) { console.log(help); process.exit(0); }
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--playwright", "--edge", "--csc"].includes(args[i]) || !args[i + 1])
    throw new Error(`Unknown/missing option. Run with --help.`);
  options[args[i]] = args[i + 1];
}
console.log(help);
assert.equal(process.platform, "win32", "Only Windows is implemented/validated.");
assert.equal(process.versions.node.split(".")[0], "24", "Requires Node 24.");
const edge = options["--edge"] ?? path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe");
const csc = options["--csc"] ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
for (const filename of [edge, csc, path.join(root, ".next", "standalone", "server.js")])
  assert(existsSync(filename), `Missing prerequisite: ${filename}`);
const { chromium } = options["--playwright"]
  ? await import(pathToFileURL(path.resolve(options["--playwright"])).href)
  : await import("playwright-core");
const run = mkdtempSync(path.join(here, ".run-"));
// Edge's cache files still hit MAX_PATH in deeply nested worktrees.
const shortPath = spawnSync(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
  ["/d", "/s", "/c", `"for %I in ("${run}") do @echo %~sI"`],
  { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true, timeout: 5000 });
const shortRun = shortPath.status === 0 && existsSync(shortPath.stdout.trim()) ? shortPath.stdout.trim() : run;
const previousTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
let browser, server, deadline, page;
let logs = "";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanEnv = {};
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)"])
  if (process.env[key]) cleanEnv[key] = process.env[key];
// Do not inherit PATH, credentials, proxy settings, NODE_OPTIONS, or actual user config.
Object.assign(cleanEnv, {
  PATH: path.dirname(process.execPath), HOME: path.join(shortRun, "home"),
  USERPROFILE: path.join(shortRun, "home"), APPDATA: path.join(shortRun, "home", "roaming"),
  LOCALAPPDATA: path.join(shortRun, "home", "local"), TEMP: path.join(shortRun, "scratch"), TMP: path.join(shortRun, "scratch"),
});
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const child = server;
  const ended = once(child, "exit");
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    windowsHide: true, stdio: "ignore", timeout: 5000,
  });
  await Promise.race([ended, delay(5000).then(() => { throw new Error("Server did not stop"); })]);
}
async function until(check, label) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await delay(250);
  }
  throw new Error(`Timed out: ${label}\n${logs.slice(-3000)}`);
}
function nativeCalls() {
  const filename = path.join(run, "native-calls.log");
  return existsSync(filename) ? readFileSync(filename, "utf8").trim().split(/\r?\n/) : [];
}
function sqliteState(sessionId) {
  // Locate the actual service database rather than requiring a test-only API.
  const files = readdirSync(path.join(run, "data"), { recursive: true })
    .map(name => path.join(run, "data", name))
    .filter(name => /\.(sqlite|sqlite3|db)$/.test(name));
  for (const filename of files) {
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE name='exercise_sessions'").get()) continue;
      const row = db.prepare("SELECT state FROM exercise_sessions WHERE id=?").get(sessionId);
      if (row) return JSON.parse(row.state);
    } finally { db.close(); }
  }
  throw new Error("Session not present in a real SQLite database");
}
function acceptedStateOnly(state) {
  // Preparing a request legitimately persists an outstanding task, not an accepted event.
  const copy = { ...state };
  delete copy.task;
  return copy;
}
try {
  deadline = setTimeout(() => {
    console.error("FAIL: 150-second harness deadline");
    process.exitCode = 1;
    void browser?.close();
    void stop();
  }, 150000);
  for (const folder of [cleanEnv.HOME, cleanEnv.APPDATA, cleanEnv.LOCALAPPDATA, cleanEnv.TEMP])
    mkdirSync(folder, { recursive: true });
  // Playwright's own profile/artifact creation must also stay inside our owned directory.
  process.env.TEMP = process.env.TMP = cleanEnv.TEMP;
  const compile = spawnSync(csc, ["/nologo", "/target:exe", `/out:${path.join(run, "fictional-claude.exe")}`, path.join(here, "fictional-claude.cs")], {
    env: cleanEnv, encoding: "utf8", timeout: 20000, windowsHide: true,
  });
  assert.equal(compile.status, 0, `Fixture compilation failed: ${compile.error ?? compile.stdout + compile.stderr}`);
  const stage = path.join(run, "server");
  cpSync(path.join(root, ".next", "standalone"), stage, { recursive: true, dereference: true });
  for (const asset of ["public", path.join(".next", "static")])
    cpSync(path.join(root, asset), path.join(stage, asset), { recursive: true, dereference: true });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const code = randomBytes(32).toString("hex");
  const env = {
    ...cleanEnv, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1",
    READYSTATE_LOCAL_CONNECTIONS: "1", READYSTATE_LOCAL_OWNER_CODE: code,
    READYSTATE_LOCAL_DATA_DIR: path.join(run, "data"), READYSTATE_LOCAL_ORIGIN: origin,
    // The runnable app is the isolated staged copy; data is its sibling, never inside it.
    READYSTATE_LOCAL_SOURCE_ROOT: stage, READYSTATE_LOCAL_INSTALL_ROOT: stage,
    READYSTATE_CLAUDE_CLI_EVALUATION: "1", READYSTATE_CLAUDE_EXECUTABLE: path.join(run, "fictional-claude.exe"),
  };
  async function start() {
    server = spawn(process.execPath, [path.join(stage, "server.js")], { cwd: stage, env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", chunk => { logs = (logs + chunk).slice(-6000); });
    server.stderr.on("data", chunk => { logs = (logs + chunk).slice(-6000); });
    server.on("error", error => { logs += error.message; });
    await until(async () => {
      if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
      try { return (await fetch(`${origin}/api/config`, { signal: AbortSignal.timeout(1000) })).ok; }
      catch { return false; }
    }, "production server readiness");
  }
  await start();
  // Edge requires real Windows known-folder metadata even with a fresh --user-data-dir.
  // Only these path/identity strings are inherited, never secrets or a browser profile.
  const browserEnv = { ...cleanEnv };
  for (const key of ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "USERNAME", "USERDOMAIN", "SystemDrive", "ALLUSERSPROFILE"])
    if (process.env[key]) browserEnv[key] = process.env[key];
  browser = await chromium.launch({
    executablePath: edge, headless: true, env: browserEnv, timeout: 20000,
    args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=127.0.0.1"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  context.setDefaultTimeout(10000);
  const external = [], errors = [], actions = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname === "/api/ttx") {
      external.push(url.pathname); return route.abort();
    }
    if (route.request().method() === "POST") actions.push(route.request().postDataJSON()?.action);
    return route.continue();
  });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/connections`);
  await page.getByLabel("One-time local owner setup code").fill(code);
  await page.getByRole("button", { name: "Unlock local setup" }).click();
  await page.getByRole("button", { name: "Create fictional connection diagnostic" }).click();
  const sessionId = await page.getByLabel("Diagnostic session ID").inputValue();
  const section = page.getByRole("region", { name: "In-ReadyState Claude diagnostic" });
  const send = section.getByRole("button", { name: "Send fictional diagnostic to Claude" });
  assert(await send.isDisabled());
  async function checkAndSend(model) {
    await section.getByRole("button", { name: "Check installed Claude and sign-in" }).click();
    await section.getByRole("status").filter({ hasText: "native-subscription" }).waitFor();
    await section.getByLabel("Requested Claude model").selectOption(model);
    await send.click();
  }
  const initialState = acceptedStateOnly(sqliteState(sessionId));
  await checkAndSend("opus");
  await section.getByRole("alert").filter({ hasText: "usage or availability limit" }).waitFor();
  assert.deepEqual(acceptedStateOnly(sqliteState(sessionId)), initialState, "Failure must not change accepted state");
  await checkAndSend("haiku");
  await until(() => nativeCalls().includes("started:haiku"), "native cancellation process actually running");
  await section.getByRole("button", { name: "Cancel Claude request" }).click();
  await section.getByRole("alert").filter({ hasText: "Cancellation requested" }).waitFor();
  await page.getByRole("button", { name: "Refresh accepted results" }).click();
  await page.getByText("Waiting for diagnostic acknowledgement", { exact: true }).waitFor();
  // Wait for the production runner to reap the cancelled child before the next request.
  await until(() => readdirSync(cleanEnv.TEMP).every(name => !name.startsWith("readystate-claude-")), "cancelled native process reaped");
  assert(!nativeCalls().includes("completed:haiku"), "Cancelled fixture must never complete");
  assert.deepEqual(acceptedStateOnly(sqliteState(sessionId)), initialState, "Cancellation must not change accepted state");
  await checkAndSend("sonnet");
  await page.getByText("Diagnostic acknowledgement saved", { exact: true }).waitFor();
  await page.getByText(/CLI-reported model evidence \(unverified\): fictional-sonnet-evidence/).waitFor();
  assert(await send.isDisabled());
  const acceptedState = sqliteState(sessionId);
  assert.notDeepEqual(acceptedState, initialState);
  assert.equal(acceptedState.events.length, 1, "Exactly one accepted SQLite event");
  assert.equal(acceptedState.events[0].generator.requestedModel, "sonnet");
  assert.deepEqual(acceptedState.events[0].generator.reportedModels, ["fictional-sonnet-evidence"]);
  assert.equal(acceptedState.events[0].generator.modelEvidence, "cli-reported-unverified");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  }
  await stop();
  await start();
  await page.reload();
  await page.getByRole("button", { name: new RegExp(`Resume ${sessionId.slice(0, 8)}`) }).click();
  await page.getByText("Diagnostic acknowledgement saved", { exact: true }).waitFor();
  await page.getByText(/CLI-reported model evidence \(unverified\): fictional-sonnet-evidence/).waitFor();
  assert.equal(await page.getByText("ReadyState diagnostic acknowledgement received.", { exact: true }).count(), 1);
  assert.deepEqual(sqliteState(sessionId), acceptedState, "Restart/re-display must not duplicate acceptance");
  assert.deepEqual(nativeCalls(), ["started:opus", "started:haiku", "started:sonnet", "completed:sonnet"]);
  assert.equal(actions.filter(action => action === "claude-diagnostic").length, 3);
  assert.equal(actions.filter(action => action === "pair" || action === "redeem").length, 0);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    status: "PASS", platform: process.platform, node: process.version, browser: browser.version(),
    productionBuildId: readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim(),
    fixture: "compiled repository C#; not Claude", modelCalls: 0, externalBrowserRequests: 0,
    checks: ["usage-limit: SQLite unchanged", "cancel: native started/reaped, SQLite unchanged",
      "success: production UI/native/SQLite", "restart: persisted exact state and display",
      "no duplicate acceptance or pairing", "1280/390/320 layouts"],
  }, null, 2));
} catch (error) {
  console.error(error);
  if (page && !page.isClosed()) console.error((await page.locator("body").innerText()).slice(-4000));
  console.error(logs.slice(-1500));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  try { await browser?.close(); } finally {
    try { await stop(); } finally {
      for (const [key, value] of Object.entries(previousTemp)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      console.log("Cleaned this run's isolated build, executable, browser profile and SQLite.");
    }
  }
}
