"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_SAVE_BYTES, createHouseholdSave, parseHouseholdSave, readNamedSaves,
  restoreHouseholdSave, writeNamedSaves, type HouseholdSave, type NamedHouseholdSave,
} from "@/lib/household-saves";
import { invalidateHouseholdWizards } from "@/lib/household-restore";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePlanStore } from "@/store/usePlanStore";

export function HouseholdSaves({ onRestore }: { onRestore: () => void }) {
  const nameId = useId();
  const fileId = useId();
  const [name, setName] = useState("");
  const [library, setLibrary] = useState<{ saves: NamedHouseholdSave[]; error: string | null }>(() => {
    try { return { saves: readNamedSaves(localStorage), error: null }; }
    catch { return { saves: [], error: "Named saves could not be read. Browser storage may be unavailable or damaged. No saved data was changed." }; }
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ snapshot: HouseholdSave; label: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importSequence = useRef(0);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const restoreTrigger = useRef<HTMLElement | null>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => { if (pending) confirmation.current?.focus(); }, [pending]);
  const snapshot = () => createHouseholdSave(useHouseholdStore.getState().profile, usePlanStore.getState().items);
  const resetNotice = () => { setError(""); setMessage(""); };

  const save = () => {
    resetNotice();
    try {
      const current = readNamedSaves(localStorage);
      const label = name.trim();
      if (!label || label.length > 100) throw new Error("Enter a save name between 1 and 100 characters.");
      if (current.some(save => save.name.toLocaleLowerCase() === label.toLocaleLowerCase())) {
        throw new Error("That name is already saved. Use a different name; existing saves are never overwritten.");
      }
      const saves = [...current, { id: crypto.randomUUID(), name: label, snapshot: snapshot() }];
      writeNamedSaves(localStorage, saves);
      setLibrary({ saves, error: null });
      setName("");
      setMessage(`Saved "${label}" in this browser.`);
    } catch (error) {
      setError(error instanceof Error && (error.message.startsWith("Enter a save name") || error.message.startsWith("That name"))
        ? error.message : "Could not save. Browser storage may be unavailable/full, saved data may be invalid, or the named-save library could not be read. Existing saves were not overwritten.");
    }
  };
  const download = (saved = snapshot()) => {
    const json = JSON.stringify(saved, null, 2);
    if (new Blob([json]).size > MAX_SAVE_BYTES) throw new Error("This household and plan exceed the 2 MiB file limit. No file was exported.");
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ReadyState-household-${saved.savedAt.slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportFile = (saved?: HouseholdSave) => {
    resetNotice();
    try { download(saved); setMessage("Save file download started. Keep it private; it is not encrypted."); }
    catch { setError("Could not export a valid save file. Files must be 2 MiB or smaller. Your browser data was not changed."); }
  };
  const loadFile = async (file: File) => {
    const sequence = ++importSequence.current;
    resetNotice();
    setPending(null);
    setBusy(true);
    try {
      if (file.size > MAX_SAVE_BYTES) throw new Error("Save files must be 2 MiB or smaller.");
      const parsed = parseHouseholdSave(await file.text());
      if (sequence === importSequence.current) setPending({ snapshot: parsed, label: file.name });
    } catch (error) {
      if (sequence === importSequence.current) setError(error instanceof Error ? error.message : "The file could not be read. Nothing was loaded.");
    } finally {
      if (sequence === importSequence.current) setBusy(false);
    }
  };
  const restore = async () => {
    if (!pending) return;
    resetNotice();
    setBusy(true);
    try {
      restoreHouseholdSave(localStorage, pending.snapshot);
      await useHouseholdStore.persist.rehydrate();
      await usePlanStore.persist.rehydrate();
      if (JSON.stringify(useHouseholdStore.getState().profile) !== JSON.stringify(pending.snapshot.household) ||
        JSON.stringify(usePlanStore.getState().items) !== JSON.stringify(pending.snapshot.plan)) {
        throw new Error("Browser data was saved, but the active profile could not refresh. Reload before continuing.");
      }
      setMessage(`Loaded "${pending.label}". Household and chosen actions replaced; settings and exercise history were not changed.`);
      setPending(null);
      invalidateHouseholdWizards();
      onRestore();
      summary.current?.focus();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Restore failed. Reload to check your household and plan before continuing.");
    } finally { setBusy(false); }
  };
  const remove = (id: string) => {
    resetNotice();
    try {
      const saves = readNamedSaves(localStorage).filter(save => save.id !== id);
      writeNamedSaves(localStorage, saves);
      setLibrary({ saves, error: null });
      setDeleting(null);
      setMessage("Named save deleted. The active household, plan and downloaded files were not changed.");
    } catch { setError("Could not delete the named save. Browser storage may be unavailable or full. Try again after checking storage."); }
  };

  return (
    <details className="rounded-panel border border-line bg-surface p-4">
      <summary ref={summary} className="cursor-pointer font-semibold">Save or load household and plan</summary>
      <section aria-label="Household saves" className="mt-4 space-y-4">
        <p className="text-sm text-ink-2">
          Working answers and actions save automatically in this browser. Named saves are separate snapshots, not live copies.
          Export a file to back up or move them to another browser or installation. Both include the complete household and chosen action plan,
          including names, health details and notes you entered. They are not encrypted; keep them private.
          No provider settings, API keys, exercise history or masking ledger are included. Nothing is uploaded or sent to a model.
        </p>
        <div className="space-y-2">
          <label htmlFor={nameId} className="text-sm font-semibold">Save name</label>
          <Input id={nameId} value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="e.g. Household before winter" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || Boolean(library.error)} onClick={save}>Save a named copy</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => exportFile()}>Export current household and plan</Button>
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor={fileId} className="block text-sm font-semibold">Load a save file (JSON, up to 2 MiB)</label>
          <input id={fileId} type="file" accept=".json,application/json" disabled={busy} className="block max-w-full text-sm"
            onChange={event => {
              const file = event.target.files?.[0];
              restoreTrigger.current = event.currentTarget;
              event.target.value = "";
              if (file) void loadFile(file);
            }} />
        </div>
        {library.error && <p role="alert" className="text-sm text-error">{library.error}</p>}
        <h3 className="font-semibold">Named saves in this browser</h3>
        {library.saves.length === 0 && !library.error && <p className="text-sm text-ink-3">No named saves yet. Browser saves are tied to this browser and local address; export files for portable backups.</p>}
        <ul className="space-y-3">
          {library.saves.map(save => (
            <li key={save.id} className="space-y-2 rounded-control border border-line p-3">
              <p className="break-words font-semibold">{save.name}</p>
              <p className="text-sm text-ink-3">Saved <time dateTime={save.snapshot.savedAt}>{save.snapshot.savedAt.slice(0, 10)}</time> · {save.snapshot.household.people.length} people · {save.snapshot.plan.length} actions</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="max-w-full whitespace-normal break-words" disabled={busy} onClick={event => { restoreTrigger.current = event.currentTarget; resetNotice(); setPending({ snapshot: save.snapshot, label: save.name }); }}>Load {save.name}</Button>
                <Button type="button" variant="outline" className="max-w-full whitespace-normal break-words" disabled={busy} onClick={() => exportFile(save.snapshot)}>Export {save.name}</Button>
                <Button type="button" variant="outline" className="max-w-full whitespace-normal break-words" disabled={busy} onClick={() => setDeleting(save.id)}>Delete {save.name}</Button>
              </div>
              {deleting === save.id && <div role="group" aria-label="Confirm named save deletion" className="space-y-2">
                <p className="text-sm">Delete this named snapshot only? The active household and plan will remain.</p>
                <Button type="button" variant="destructive" onClick={() => remove(save.id)}>Confirm delete</Button>{" "}
                <Button type="button" variant="outline" onClick={() => setDeleting(null)}>Keep save</Button>
              </div>}
            </li>
          ))}
        </ul>
        {pending && <section aria-label="Confirm household restore" className="space-y-2 border-t border-line pt-3">
          <h3 ref={confirmation} tabIndex={-1} className="font-semibold">Replace current household and plan?</h3>
          <p className="break-words text-sm">Load {pending.label} from {pending.snapshot.savedAt.slice(0, 10)}:
            {" "}{pending.snapshot.household.people.length} people, {pending.snapshot.household.pets.length} pets and {pending.snapshot.plan.length} chosen actions.
            This replaces, not merges, the working household and plan. Save or export your current work first if you want to keep it.
            Other named saves, provider settings and exercise history are unchanged.</p>
          <Button type="button" disabled={busy} onClick={() => void restore()}>Replace household and plan</Button>{" "}
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setPending(null); setMessage("Load cancelled. Nothing was changed."); restoreTrigger.current?.focus(); }}>Cancel load</Button>
        </section>}
        {busy && <p role="status">Reading or loading save...</p>}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        {message && <p role="status" className="text-sm text-ink-2">{message}</p>}
      </section>
    </details>
  );
}
