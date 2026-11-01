import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { checkPort } from "./launch.mjs";
import { inspectPackage } from "./inspect.mjs";
import { verifyNotices } from "./notices.mjs";
import { existsSync } from "node:fs";

const source = process.argv[2] === "--source";
const directory = path.resolve(process.argv[source ? 3 : 2] ?? "");
const runtime = source ? process.execPath : path.join(directory, "runtime", process.platform === "win32" ? "node.exe" : "node");
const launcher = source ? path.join(directory, "scripts", "local", "launch.mjs") : path.join(directory, "launch.mjs");
const args = [launcher, "--no-env", ...(source ? ["--server", path.join(directory, ".next", "standalone", "server.js")] : [])];
if (!source) {
  inspectPackage(directory);
  assert.ok(existsSync(path.join(directory, "LICENSE")));
  assert.ok(existsSync(path.join(directory, "runtime", "LICENSE")));
  verifyNotices(path.join(directory, "app"));
  for (const file of ["inter-OFL.txt", "source-sans-3-OFL.txt", "source-serif-4-OFL.txt"]) {
    assert.ok(existsSync(path.join(directory, "app", "public", "licenses", file)), file);
  }
}
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/(API_KEY|^READYSTATE_|^OLLAMA_|^VERCEL|^PORT$|^HOSTNAME$)/i.test(key)));
const child = spawn(runtime, args, {
  cwd: directory, env: { ...env, PORT: String(port) }, stdio: ["ignore", "inherit", "inherit", "ipc"],
});
const ending = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", code => resolve(code));
});
let exited = false;
ending.then(() => { exited = true; }, () => { exited = true; });
const base = `http://127.0.0.1:${port}`;
const request = url => fetch(url, { signal: AbortSignal.timeout(1000) });
let passed = false;
try {
  let ready = false;
  for (let i = 0; i < 80 && !exited; i++) {
    try { if ((await request(`${base}/api/config`)).ok) { ready = true; break; } }
    catch (error) {
      if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Package failed to start");
  const config = await (await request(`${base}/api/config`)).json();
  assert.equal(config.mode, "self-hosted");
  assert.ok(config.providers.length > 0);
  assert.ok(config.providers.filter(provider => provider.requiresKey).every(provider => !provider.serverConfigured));
  const image = await request(`${base}/file.svg`);
  assert.equal(image.status, 200, "Static images must still be served");
  assert.match(image.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.equal((await request(`${base}/_next/image?url=%2Ffile.svg&w=640&q=75`)).status, 404, "Disabled optimizer must not load Sharp");
  let assets = 0;
  for (const route of ["/", "/journal", "/household", "/settings", "/exercises", "/plan"]) {
    const response = await request(`${base}${route}`);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    const paths = [...new Set([...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)].map(match => match[1].replaceAll("&amp;", "&")))];
    assert.ok(paths.length > 0, `No static references on ${route}`);
    for (const asset of paths) {
      const url = new URL(asset, base);
      assert.equal(url.origin, base, "No external asset requests permitted in the local smoke");
      assert.equal((await request(url)).status, 200, asset);
      assets++;
    }
  }
  const second = spawn(runtime, args, {
    cwd: directory, env: { ...env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  second.stderr.on("data", data => { errors += data; });
  const status = await new Promise((resolve, reject) => {
    second.once("error", reject);
    second.once("exit", resolve);
  });
  assert.equal(status, 1, "Second instance must fail visibly");
  assert.match(errors, /Cannot use localhost/);
  passed = true;
  console.log(`PASS: ${process.platform} ${source ? "source standalone" : "relocated package"}; 6 pages, ${assets} asset GETs, static SVG, disabled optimizer, key-free config, port conflict. No /api/ttx requests.`);
} finally {
  if (!exited && child.connected) child.send("stop");
  const status = await ending;
  if (passed) {
    assert.equal(status, 0, "Launcher must stop cleanly");
    await checkPort(port);
    console.log("PASS: launcher exited cleanly and released its server port.");
  }
}
