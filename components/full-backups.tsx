"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { captureFullBackup, restoreFullBackup } from "@/lib/full-backup-state";
import {
  MAX_BACKUP_BYTES, decryptFullBackup, encryptFullBackup, parseEncryptedBackup,
  readFullBackups, writeFullBackups, type EncryptedBackup, type FullBackup, type NamedFullBackup,
} from "@/lib/full-backups";

const noSubscribe = () => () => {};
export function FullBackups() {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return hydrated ? <BackupControls /> : null;
}
function BackupControls() {
  const passwordId = useId();
  const confirmId = useId();
  const nameId = useId();
  const fileId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [library, setLibrary] = useState<{ backups: NamedFullBackup[]; error: string | null }>(() => {
    try { return { backups: readFullBackups(localStorage), error: null }; }
    catch { return { backups: [], error: "Encrypted backups could not be read. Browser storage may be damaged/unavailable; existing copies were not overwritten." }; }
  });
  const [selected, setSelected] = useState<{ encrypted: EncryptedBackup; label: string } | null>(null);
  const [pending, setPending] = useState<{ data: FullBackup; label: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const confirmation = useRef<HTMLHeadingElement>(null);
  const operation = useRef(0);
  const clearNotice = () => { setError(""); setMessage(""); };
  const fail = (error: unknown) => setError(error instanceof Error ? error.message : "Backup operation failed. No success is assumed; check browser storage.");
  const download = (encrypted: EncryptedBackup) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(encrypted)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "ReadyState-encrypted-backup.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const save = async (named: boolean) => {
    clearNotice(); setBusy(true);
    try {
      if (password !== confirm) throw new Error("Backup passwords do not match.");
      const label = name.trim();
      if (named && (!label || label.length > 100)) throw new Error("Enter a backup name between 1 and 100 characters.");
      if (named && readFullBackups(localStorage).some(item => item.name.toLocaleLowerCase() === label.toLocaleLowerCase())) {
        throw new Error("That backup name already exists. Choose a different name.");
      }
      const data = captureFullBackup(localStorage);
      const encrypted = await encryptFullBackup(data, password);
      if (named) {
        const current = readFullBackups(localStorage);
        if (current.some(item => item.name.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error("That backup name was saved meanwhile. Choose a different name.");
        const backups = [...current, { id: crypto.randomUUID(), name: label, savedAt: data.savedAt, encrypted }];
        writeFullBackups(localStorage, backups);
        setLibrary({ backups, error: null }); setName("");
      } else download(encrypted);
      setPassword(""); setConfirm("");
      setMessage(named ? "Encrypted full backup saved in this browser. Export it too for a portable backup." : "Encrypted full backup download started. Keep its password separately; it cannot be recovered.");
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  };
  const unlock = async (encrypted: EncryptedBackup, label: string) => {
    clearNotice(); setBusy(true); setPending(null);
    try {
      const data = await decryptFullBackup(encrypted, password);
      setPending({ data, label }); setPassword(""); setConfirm("");
      setMessage("Backup unlocked locally. Nothing has been restored yet.");
      setTimeout(() => confirmation.current?.focus(), 0);
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  };
  const chooseFile = async (file: File) => {
    const sequence = ++operation.current;
    clearNotice(); setPending(null); setSelected(null); setBusy(true);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("Encrypted backup files must be 30 MiB or smaller.");
      const encrypted = parseEncryptedBackup(await file.text());
      if (sequence === operation.current) setSelected({ encrypted, label: file.name });
    } catch (error) { if (sequence === operation.current) fail(error); }
    finally { if (sequence === operation.current) setBusy(false); }
  };
  const restore = () => {
    if (!pending) return;
    clearNotice();
    try {
      restoreFullBackup(localStorage, pending.data);
      // Reload discards old forms, outgoing reviews, approvals and retry credentials.
      window.location.reload();
    } catch (error) { fail(error); }
  };
  return (
    <section id="backups" aria-label="Full encrypted backups" className="space-y-4 rounded-panel border border-line bg-surface p-4">
      <h2 className="text-xl font-semibold">Full encrypted backups</h2>
      <p className="text-sm text-ink-2">
        Save household answers, assessment stage, a dated report of current results and earlier saved reports, chosen actions/statuses, exercise/debrief history and the current exercise/draft,
        browser-saved API keys/provider settings, private tag mappings, Always Mask names, appearance and named household copies.
        No model call or upload is made. Only keys saved in this browser are included, never server/environment keys.
      </p>
      <p className="text-sm text-ink-2">
        Full backup files and named full backups are password-encrypted (AES-256-GCM).
        Use a unique password of at least 12 characters and keep it separately; there is no password recovery.
        Names/dates of browser backups remain visible. Working browser data and deliberately saved history are still unencrypted;
        this does not encrypt the live application. Full backup copies themselves are not recursively included.
        Unsaved settings form edits and outgoing review/approval state are not saved.
      </p>
      <div className="space-y-2">
        <label htmlFor={passwordId} className="block text-sm font-semibold">Backup password</label>
        <Input id={passwordId} type="password" autoComplete="off" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
        <label htmlFor={confirmId} className="block text-sm font-semibold">Confirm password (when saving a new backup)</label>
        <Input id={confirmId} type="password" autoComplete="off" disabled={busy} value={confirm} onChange={event => setConfirm(event.target.value)} />
        <label htmlFor={nameId} className="block text-sm font-semibold">Full backup name</label>
        <Input id={nameId} maxLength={100} disabled={busy} value={name} onChange={event => setName(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button className="max-w-full whitespace-normal" disabled={busy} onClick={() => void save(false)}>Export encrypted full backup</Button>
          <Button className="max-w-full whitespace-normal" variant="outline" disabled={busy || Boolean(library.error)} onClick={() => void save(true)}>Save named encrypted backup</Button>
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor={fileId} className="block text-sm font-semibold">Choose an encrypted backup (JSON, up to 30 MiB)</label>
        <input id={fileId} type="file" accept=".json,application/json" className="max-w-full text-sm" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (file) void chooseFile(file);
        }} />
        {selected && <Button variant="outline" disabled={busy} onClick={() => void unlock(selected.encrypted, selected.label)}>Unlock selected backup</Button>}
      </div>
      <h3 className="font-semibold">Named encrypted backups</h3>
      {library.error && <p role="alert">{library.error}</p>}
      {!library.error && !library.backups.length && <p className="text-sm">No named encrypted backups yet.</p>}
      <ul className="space-y-3">
        {library.backups.map(item => <li key={item.id} className="space-y-2 rounded-control border border-line p-3">
          <p className="break-words font-semibold">{item.name}</p>
          <p className="text-sm">Saved {item.savedAt}</p>
          <div className="flex flex-wrap gap-2">
            <Button className="max-w-full whitespace-normal break-words" variant="outline" disabled={busy} onClick={() => void unlock(item.encrypted, item.name)}>Unlock {item.name}</Button>
            <Button className="max-w-full whitespace-normal break-words" variant="outline" disabled={busy} onClick={() => {
              clearNotice(); try { download(item.encrypted); setMessage("Encrypted copy download started."); } catch { setError("Could not export encrypted backup. Browser copies are unchanged."); }
            }}>Export encrypted copy</Button>
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(item.id)}>Delete backup</Button>
          </div>
          {deleting === item.id && <div role="group" aria-label="Confirm encrypted backup deletion" className="flex flex-wrap gap-2">
            <p className="text-sm">Delete this encrypted copy only? Working data, history and downloaded files are unchanged.</p>
            <Button variant="destructive" onClick={() => {
              clearNotice();
              try {
                const backups = readFullBackups(localStorage).filter(copy => copy.id !== item.id);
                writeFullBackups(localStorage, backups); setLibrary({ backups, error: null }); setDeleting(null);
                setMessage("Encrypted browser backup deleted. Other data and downloaded files were not changed.");
              } catch { setError("Could not delete encrypted backup. Check browser storage."); }
            }}>Confirm backup deletion</Button>
            <Button variant="outline" onClick={() => setDeleting(null)}>Keep backup</Button>
          </div>}
        </li>)}
      </ul>
      {pending && <section aria-label="Confirm full restore" className="space-y-3 border-t border-line pt-3">
        <h3 ref={confirmation} tabIndex={-1} className="font-semibold">Replace ReadyState data with this full backup?</h3>
        <p className="break-words text-sm">
          {pending.label} · saved {pending.data.savedAt}. {pending.data.householdAndPlan.household.people.length} people,
          {" "}{pending.data.householdAndPlan.plan.length} actions, {pending.data.records.assessments.length} dated assessments,
          {" "}{pending.data.records.exercises.length} exercise snapshots.
          Browser provider settings{pending.data.settings?.apiKey ? " (including an API key)" : ""}, household, plan, history, assessment stage,
          private mappings and named household copies will be replaced, not merged. Existing encrypted full backups and unrelated browser data stay untouched.
          Export current data first to keep it. The app reloads to discard stale drafts and send approvals. Nothing will be sent.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button className="max-w-full whitespace-normal" disabled={busy} onClick={restore}>Replace all and reload</Button>
          <Button variant="outline" disabled={busy} onClick={() => { setPending(null); setMessage("Full restore cancelled. Working data is unchanged."); }}>Cancel full restore</Button>
        </div>
      </section>}
      {busy && <p role="status">Processing backup locally...</p>}
      {error && <p role="alert" className="break-words text-sm text-error">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  );
}
