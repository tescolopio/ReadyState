import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function inspectPackage(directory, forbiddenValues = []) {
  let files = 0;
  const forbiddenNames = /^(?:\.env.*|\.git|\.vercel|eval-results|coverage|\.npmrc|\.netrc|id_rsa|id_ed25519)$/i;
  const credential = /(?<![A-Za-z0-9_-])(?:gsk_[A-Za-z0-9]{40,128}|sk-proj-[A-Za-z0-9_-]{40,256}|sk-or-v1-[A-Za-z0-9]{64}|sk-[A-Za-z0-9]{40,128}|AIza[A-Za-z0-9_-]{35})(?![A-Za-z0-9_-])|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  const walk = current => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      const relative = path.relative(directory, full);
      const info = lstatSync(full);
      if (info.isSymbolicLink()) throw new Error(`Package link: ${relative}`);
      if (forbiddenNames.test(entry) || /\.(?:pem|key|log|test\.[cm]?[jt]sx?)$/i.test(entry)) {
        throw new Error(`Forbidden package path: ${relative}`);
      }
      if (info.isDirectory()) walk(full);
      else if (info.isFile()) {
        const data = readFileSync(full);
        if (forbiddenValues.some(value => value.length >= 8 && data.includes(Buffer.from(value)))) {
          throw new Error(`Captured environment value in package file: ${relative}`);
        }
        if (credential.test(data.toString("utf8"))) throw new Error(`Credential-shaped content in package file: ${relative}`);
        files++;
      } else throw new Error(`Unexpected package entry: ${relative}`);
    }
  };
  walk(directory);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Specify the extracted package directory.");
  const values = Object.entries(process.env).filter(([key]) =>
    /(?:API_KEY|TOKEN|PASSWORD|SECRET|READYSTATE_PACKAGE_CANARY)/i.test(key)).map(([, value]) => value);
  console.log(`PASS: ${inspectPackage(path.resolve(process.argv[2]), values)} package files; no forbidden paths, credential signatures or captured secret environment values. Pattern checks are not a guarantee against all possible secrets.`);
}
