import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) throw new Error("Run npm run build before npm start.");
for (const [source, destination] of [["public", "public"], [path.join(".next", "static"), path.join(".next", "static")]]) {
  cpSync(path.join(root, source), path.join(standalone, destination), { recursive: true, dereference: true });
}
