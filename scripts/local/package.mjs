import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { copyNotices } from "./notices.mjs";
import { inspectPackage } from "./inspect.mjs";

const root = process.cwd();
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
if (!["win32", "linux"].includes(process.platform) || process.arch !== "x64") throw new Error("Initial local packages support Windows/Linux x64 only.");
if (!process.env.READYSTATE_NODE_LICENSE || !existsSync(process.env.READYSTATE_NODE_LICENSE)) {
  throw new Error("Set READYSTATE_NODE_LICENSE to the license file from the exact Node runtime being bundled.");
}
if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Build local packages with Node 24.");
const target = path.join(root, "dist", `ReadyState-${version}-${process.platform === "win32" ? "windows" : "linux"}-x64`);
if (existsSync(target)) throw new Error(`Package already exists: ${target}. Move it aside before rebuilding.`);
const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) throw new Error("Build production output first.");
mkdirSync(path.join(target, "app"), { recursive: true });
const filter = source => !path.basename(source).startsWith(".env") && !/\.(log|pem)$/i.test(source);
for (const entry of ["server.js", "package.json", "node_modules", ".next"]) {
  cpSync(path.join(standalone, entry), path.join(target, "app", entry), { recursive: true, dereference: true, filter });
}
copyNotices(path.join(target, "app", "node_modules"));
cpSync(path.join(root, ".next", "static"), path.join(target, "app", ".next", "static"), { recursive: true, dereference: true });
cpSync(path.join(root, "public"), path.join(target, "app", "public"), { recursive: true, dereference: true });
mkdirSync(path.join(target, "runtime"));
cpSync(process.execPath, path.join(target, "runtime", process.platform === "win32" ? "node.exe" : "node"));
cpSync(process.env.READYSTATE_NODE_LICENSE, path.join(target, "runtime", "LICENSE"));
for (const entry of ["launch.mjs", ...(process.platform === "win32" ? ["start.ps1", "install.ps1", "uninstall.ps1"] : ["start.sh", "install.sh", "uninstall.sh"])]) {
  cpSync(path.join(root, "scripts", "local", entry), path.join(target, entry));
}
cpSync(path.join(root, "LICENSE"), path.join(target, "LICENSE"));
cpSync(path.join(root, ".env.example"), path.join(target, "configuration.example"));
cpSync(path.join(root, "docs", "deployment", "local-installation.md"), path.join(target, "INSTALL.md"));
cpSync(path.join(root, "docs", "deployment", "packaging-review.md"), path.join(target, "packaging-review.md"));
cpSync(path.join(root, "docs", "deployment", "binary-components.md"), path.join(target, "binary-components.md"));
const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (revision.status !== 0) throw new Error("Cannot determine matching source revision.");
const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if (status.status !== 0) throw new Error("Cannot determine whether the source tree is clean.");
writeFileSync(path.join(target, "release.json"), JSON.stringify({
  version, platform: process.platform, arch: process.arch, node: process.version,
  developmentPreview: true,
  source: `https://github.com/tescolopio/ReadyState/tree/${revision.stdout.trim()}`,
  uncommittedChanges: Boolean(status.stdout.trim()),
}, null, 2));
if (status.stdout.trim()) console.warn("Local development bundle: uncommitted source changes are not covered by the source-revision link.");
const secretValues = Object.entries(process.env).filter(([key]) => /(?:API_KEY|TOKEN|PASSWORD|SECRET|READYSTATE_PACKAGE_CANARY)/i.test(key)).map(([, value]) => value);
inspectPackage(target, secretValues);
console.log(target);
