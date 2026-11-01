import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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
  it("stops its server cleanly when the controlling process requests shutdown", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "readystate-launch-"));
    const server = path.join(directory, "server.cjs");
    await writeFile(server, `require("node:http").createServer((req,res)=>res.end("{}")).listen(process.env.PORT,process.env.HOSTNAME); process.on("SIGTERM",()=>process.exit(143));`);
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("No port");
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const child = spawn(process.execPath, [path.resolve("scripts/local/launch.mjs"), "--server", server, "--no-env"], {
      env: { ...process.env, READYSTATE_MODE: "self-hosted", PORT: String(address.port) },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const ending = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    let errors = "";
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
      child.send("stop");
      expect(await ending).toBe(0);
      expect(errors).toBe("");
      await expect(checkPort(address.port)).resolves.toBeUndefined();
    } finally {
      if (child.exitCode === null && child.connected) child.send("stop");
      await ending;
      await rm(directory, { recursive: true });
    }
  });
});
