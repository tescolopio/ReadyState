import { createServer } from "node:net";
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { checkPort, localPort } from "./launch.mjs";

describe("local launcher", () => {
  it("requires an explicit valid stable port", () => {
    expect(localPort()).toBe(3000);
    expect(localPort("43210")).toBe(43210);
    for (const value of ["0", "-1", "65536", "3.5", "", "not-a-port"]) {
      expect(() => localPort(value)).toThrow();
    }
  });
  it("rejects a port owned by another instance", async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      await expect(checkPort(address.port)).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("starts through a package alias and stops without waiting for a Unix browser opener", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "readystate-launch-"));
    const server = path.join(directory, "server.cjs");
    await writeFile(server, `require("node:http").createServer((req,res)=>res.end("{}")).listen(process.env.PORT,process.env.HOSTNAME); process.on("SIGTERM",()=>process.exit(143));`);
    const openerPidFile = path.join(directory, "opener.pid");
    const alias = path.join(directory, "alias");
    const packageDirectory = path.join(directory, "package");
    await mkdir(packageDirectory);
    await copyFile(path.resolve("scripts/local/launch.mjs"), path.join(packageDirectory, "launch.mjs"));
    await symlink(packageDirectory, alias, process.platform === "win32" ? "junction" : "dir");
    if (process.platform === "linux") {
      await mkdir(path.join(packageDirectory, "runtime"));
      await symlink(process.execPath, path.join(packageDirectory, "runtime", "node"));
      await copyFile(path.resolve("scripts/local/start.sh"), path.join(packageDirectory, "start.sh"));
      const opener = path.join(directory, "opener.cjs");
      await writeFile(opener, `require("node:fs").writeFileSync(${JSON.stringify(openerPidFile)},String(process.pid)); setInterval(()=>{},1000);`);
      await writeFile(path.join(directory, "xdg-open"), `#!/bin/sh\nexec "${process.execPath}" "${opener}"\n`);
      await chmod(path.join(directory, "xdg-open"), 0o755);
    }
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("No port");
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const child = spawn(process.platform === "linux" ? "sh" : process.execPath, [path.join(alias, process.platform === "linux" ? "start.sh" : "launch.mjs"), "--server", server, "--no-env"], {
      env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, READYSTATE_MODE: "self-hosted", PORT: String(address.port) },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const ending = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    let errors = "";
    let openerPid: number | undefined;
    try {
      const output = child.stdout;
      const errorOutput = child.stderr;
      if (!output || !errorOutput) throw new Error("Launcher output pipes are missing");
      errorOutput.on("data", data => { errors += data; });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Launcher readiness timed out")), 3000);
        output.on("data", data => { if (data.toString().includes("ReadyState:")) { clearTimeout(timeout); resolve(); } });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Launcher exited before readiness: ${errors}`)); });
        child.once("error", error => { clearTimeout(timeout); reject(error); });
      });
      if (process.platform === "linux") {
        for (let i = 0; i < 30; i++) {
          try { openerPid = Number(await readFile(openerPidFile, "utf8")); break; }
          catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        }
        expect(openerPid).toBeGreaterThan(0);
      }
      child.send("stop");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        expect(await Promise.race([ending, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Launcher waited for browser after shutdown")), 1000);
        })])).toBe(0);
      } finally { clearTimeout(timeout); }
      expect(errors).toBe("");
      await expect(checkPort(address.port)).resolves.toBeUndefined();
    } finally {
      if (openerPid) process.kill(openerPid, "SIGTERM");
      if (child.exitCode === null && child.connected) child.send("stop");
      await ending;
      await rm(directory, { recursive: true });
    }
  });
});
