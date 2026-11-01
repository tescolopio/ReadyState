import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function localPort(value = "3000") {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return Number(value);
}

export async function checkPort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

export async function launch(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("ReadyState requires Node 24.");
  const serverIndex = args.indexOf("--server");
  const server = serverIndex >= 0
    ? path.resolve(args[serverIndex + 1] ?? "")
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "app", "server.js");
  if (!existsSync(server)) throw new Error("Production server missing. Build ReadyState or extract a complete local package first.");
  const config = process.env.READYSTATE_ENV_FILE;
  const defaultConfig = path.join(serverIndex >= 0 ? process.cwd() : path.dirname(fileURLToPath(import.meta.url)), ".env.local");
  if (!args.includes("--no-env")) {
    if (config) process.loadEnvFile(path.resolve(config));
    else if (existsSync(defaultConfig)) process.loadEnvFile(defaultConfig);
  }
  if (process.env.READYSTATE_MODE && process.env.READYSTATE_MODE !== "self-hosted") {
    throw new Error("Local packages support READYSTATE_MODE=self-hosted only.");
  }
  const port = localPort(process.env.PORT);
  try {
    await checkPort(port);
  } catch (error) {
    throw new Error(`Cannot use localhost:${port}. Stop the existing server or set PORT explicitly. Changing the port changes browser storage.`, { cause: error });
  }
  const url = `http://localhost:${port}/journal`;
  const child = spawn(process.execPath, [server], {
    cwd: path.dirname(server),
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", READYSTATE_MODE: "self-hosted", VERCEL: "" },
    stdio: "inherit",
  });
  let exited = false;
  const ending = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  const stop = () => { if (!exited) child.kill("SIGTERM"); };
  let stopping = false;
  const requestedStop = () => { stopping = true; stop(); };
  const message = value => { if (value === "stop") requestedStop(); };
  process.once("SIGINT", requestedStop);
  process.once("SIGTERM", requestedStop);
  if (process.connected) {
    process.on("message", message);
    process.once("disconnect", requestedStop);
  }
  try {
    let ready = false;
    for (let i = 0; i < 60 && !exited; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(500) });
        if (response.ok || response.status === 401) { ready = true; break; }
        throw new Error(`ReadyState configuration returned HTTP ${response.status}.`);
      } catch (error) {
        if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) {
      if (stopping) return;
      throw new Error("ReadyState did not become ready within the startup deadline.");
    }
    console.log(`ReadyState: ${url}\nKeep this window open. Ctrl+C stops the local server.`);
    if (args.includes("--open-browser")) {
      const command = process.platform === "win32" ? "rundll32.exe" : "xdg-open";
      const browser = spawn(command, process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url], { stdio: "ignore", detached: true });
      browser.once("error", error => console.error(`Could not open browser: ${error.message}. Open ${url} manually.`));
      browser.once("exit", code => { if (code) console.error(`Browser opener exited ${code}. Open ${url} manually.`); });
      browser.unref();
    }
    const result = await ending;
    if (result.code && !(stopping && [130, 143].includes(result.code))) throw new Error(`ReadyState server exited ${result.code}.`);
    if (result.signal && !stopping) throw new Error(`ReadyState server stopped unexpectedly (${result.signal}).`);
  } finally {
    stop();
    await ending;
    process.removeListener("SIGINT", requestedStop);
    process.removeListener("SIGTERM", requestedStop);
    process.removeListener("message", message);
    process.removeListener("disconnect", requestedStop);
    if (process.connected) process.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch().catch(error => { console.error(error.message); process.exitCode = 1; });
}
