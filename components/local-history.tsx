"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { unmaskSavedText } from "@/lib/local-records";
import { openExercise, saveExerciseLocally } from "@/lib/saved-exercises";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";

export function LocalHistory() {
  const router = useRouter();
  const { data, error: storageError, commit } = useLocalRecordsStore();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const run = (action: () => void, message: string) => {
    setError(""); setNotice("");
    try {
      if (storageError) throw new Error(storageError);
      action(); setNotice(message);
    } catch (error) { setError(error instanceof Error ? error.message : "Local history could not be saved. Check browser storage."); }
  };
  return (
    <section aria-label="Local saved history" className="space-y-4 rounded-panel border border-line bg-surface p-4">
      <h2 className="text-xl font-semibold">Local saved history</h2>
      <p className="text-sm text-ink-2">
        Save dated snapshots deliberately. These do not update as answers or exercises change.
        Records include household details, exercise text and private tag mappings, stored unencrypted in this browser.
        Use an encrypted full backup in Settings to keep portable copies. No model call is made.
      </p>
      <Button variant="outline" onClick={() => run(saveExerciseLocally, "Exercise and unsent response draft saved locally. Save again after further changes.")}>Save current exercise locally</Button>
      {storageError && <p role="alert">{storageError}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h3 className="font-semibold">Dated assessments ({data.assessments.length})</h3>
      {data.assessments.map(record => (
        <details key={record.id} className="rounded-control border border-line p-3">
          <summary className="cursor-pointer">Assessment saved {record.savedAt}</summary>
          <p className="my-2 text-sm">Historical answers and rules at the time of saving, not your current assessment.</p>
          <pre className="whitespace-pre-wrap break-words text-sm">{record.report || "No findings recorded."}</pre>
          <Button variant="outline" onClick={() => setDeleting(record.id)}>Delete assessment record</Button>
          {deleting === record.id && <div role="group" aria-label="Confirm history deletion" className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => run(() => {
              commit({ ...data, assessments: data.assessments.filter(item => item.id !== record.id) }); setDeleting(null);
            }, "Assessment record deleted; working answers and backup copies are unchanged.")}>Confirm history deletion</Button>
            <Button variant="outline" onClick={() => setDeleting(null)}>Keep record</Button>
          </div>}
        </details>
      ))}
      <h3 className="font-semibold">Saved exercises ({data.exercises.length})</h3>
      {data.exercises.map(record => (
        <details key={record.id} className="rounded-control border border-line p-3">
          <summary className="cursor-pointer">Exercise saved {record.savedAt} · {record.messages.length} messages</summary>
          <p className="my-2 text-sm">Historical model-generated material is not verified emergency advice. Opening replaces the current tab exercise, not household answers or actions. Save the current exercise first if needed.</p>
          {record.messages.map(message => <div key={message.id} className="my-3">
            <p className="font-semibold">{message.role === "user" ? "Participant" : "Model output (unverified)"}</p>
            <pre className="whitespace-pre-wrap break-words text-sm">{message.parts.map(part => {
              const text = part.type === "text" ? part.text : JSON.stringify(part.output, null, 2);
              return unmaskSavedText(text, record.privacy.entityMap);
            }).join("\n")}</pre>
          </div>)}
          {record.draft && <p className="break-words text-sm">Unsent response draft: {record.draft}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setOpening(record.id)}>Open saved exercise</Button>
            <Button variant="outline" onClick={() => setDeleting(record.id)}>Delete exercise record</Button>
          </div>
          {opening === record.id && <div role="group" aria-label="Confirm opening saved exercise" className="my-2 flex flex-wrap gap-2">
            <p>Replace the current tab exercise and its private tag mappings? No messages will be sent; new responses must be reviewed.</p>
            <Button onClick={() => run(() => { openExercise(record); router.push("/exercise"); }, "Saved exercise opened without sending.")}>Replace tab exercise</Button>
            <Button variant="outline" onClick={() => setOpening(null)}>Keep current exercise</Button>
          </div>}
          {deleting === record.id && <div role="group" aria-label="Confirm history deletion" className="my-2 flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => run(() => {
              commit({ ...data, exercises: data.exercises.filter(item => item.id !== record.id),
                activeExercise: data.activeExercise?.id === record.id ? null : data.activeExercise });
              setDeleting(null);
            }, "Exercise record deleted; the current tab and backup copies are unchanged.")}>Confirm history deletion</Button>
            <Button variant="outline" onClick={() => setDeleting(null)}>Keep record</Button>
          </div>}
        </details>
      ))}
    </section>
  );
}
