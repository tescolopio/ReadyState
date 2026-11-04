import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [mode, filename, stream = "stdout"] = process.argv.slice(2);
const fixture = fileURLToPath(import.meta.url);
if (mode === "grandchild") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
} else if (mode === "child") {
  const grandchild = spawn(process.execPath, [fixture, "grandchild"], {
    stdio: ["ignore", stream === "stdout" ? "inherit" : "ignore", stream === "stderr" ? "inherit" : "ignore"],
  });
  grandchild.once("spawn", () => process.send({ child: process.pid, grandchild: grandchild.pid }));
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
} else {
  const child = spawn(process.execPath, [fixture, "child", "", stream], {
    stdio: ["ignore", stream === "stdout" ? "inherit" : "ignore", stream === "stderr" ? "inherit" : "ignore", "ipc"],
  });
  child.once("message", pids => {
    writeFileSync(filename, JSON.stringify({ leader: process.pid, ...pids }));
    if (mode === "leader-exit") {
      process.stdout.write("leader completed\n");
      process.exit(0);
    }
  });
  setInterval(() => {}, 1_000);
}
