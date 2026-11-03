import { lstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

/** Recovery may write rollback pages, but must never create a missing store. */
export function openExistingLocalDatabase(filename: string) {
  const uri = pathToFileURL(filename);
  uri.searchParams.set("mode", "rw");
  return new DatabaseSync(uri.href);
}

export function assertUnlinkedLocalDatabase(filename: string) {
  let info;
  try { info = lstatSync(filename); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error("Local databases and sidecars must be regular files without symbolic or hard links.");
  }
}
