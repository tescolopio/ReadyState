/** Roll back ordinary write failures; this is not a crash-atomic browser transaction. */
export function replaceStorageEntries(storage: Storage, entries: Array<[string, string | null]>, label: string) {
  const previous = entries.map(([key]) => storage.getItem(key));
  let written = 0;
  try {
    for (const [key, value] of entries) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      written++;
    }
  } catch (error) {
    try {
      for (let index = written - 1; index >= 0; index--) {
        const old = previous[index];
        if (old === null) storage.removeItem(entries[index][0]);
        else storage.setItem(entries[index][0], old);
      }
    } catch {
      throw new Error("Restore failed and the previous browser data could not be fully restored. Keep your backup and reload to check your data.");
    }
    throw new Error(`Restore failed: browser storage is unavailable or full. Previous ${label} were retained.`, { cause: error });
  }
}
