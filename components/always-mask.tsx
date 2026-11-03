"use client";

import { EyeOff } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getLocalPrivacyStorage, loadLocalPrivacySettings, LOCAL_PRIVACY_SETTINGS_KEY, saveLocalPrivacySettings } from "@/lib/local-session-privacy";
import { usePrivacyStore } from "@/store/usePrivacyStore";

/**
 * Names the masker should always replace, for anything its detectors miss.
 * Explicit rules are browser-local and coordinated with local-session sends.
 */
export function AlwaysMaskCard() {
  const alwaysMask = usePrivacyStore((state) => state.alwaysMask);
  const setAlwaysMask = usePrivacyStore((state) => state.setAlwaysMask);
  const [draft, setDraft] = useState(() => alwaysMask.join(", "));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const id = useId();

  useEffect(() => {
    const restore = (event?: StorageEvent) => {
      if (event && event.key !== null && event.key !== LOCAL_PRIVACY_SETTINGS_KEY) return;
      try {
        const storage = getLocalPrivacyStorage();
        if (!storage) throw new Error("Browser privacy storage is unavailable.");
        const rules = loadLocalPrivacySettings(storage);
        setAlwaysMask(rules);
        setDraft(rules.join(", "));
      } catch {
        setProblem("Browser privacy settings could not be restored. Local-session sends are blocked until storage is repaired.");
      }
    };
    restore();
    window.addEventListener("storage", restore);
    return () => window.removeEventListener("storage", restore);
  }, [setAlwaysMask]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setProblem("");
    void (async () => {
      try {
        const storage = getLocalPrivacyStorage();
        if (!storage) throw new Error("Browser privacy storage is unavailable.");
        setAlwaysMask(await saveLocalPrivacySettings(storage, draft.split(",")));
      } catch {
        setProblem("Privacy settings were not changed. Allow browser storage and use a browser with Web Locks support.");
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-action">
          <EyeOff className="h-4 w-4" aria-hidden />
          Always Mask
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-2 text-sm">
          <label
            htmlFor={`${id}-names`}
            className="text-sm font-semibold text-ink-3"
          >
            Names, comma-separated
          </label>
          <div className="flex gap-2">
            <Input
              id={`${id}-names`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="e.g. Priya, Escolopio"
              autoComplete="off"
            />
            <Button type="submit" size="sm" variant="outline" disabled={saving}>
              {saving ? "Waiting to save" : "Set"}
            </Button>
          </div>
          <p className="text-xs text-ink-3">
            {alwaysMask.length > 0
              ? `Masking ${alwaysMask.length} name${alwaysMask.length === 1 ? "" : "s"} in everything you send.`
              : "For names the automatic masking misses. Saved in this browser only."}
          </p>
          <p className="text-xs text-ink-3">Explicit Settings rules are saved unencrypted in this browser. Saved local sessions check them across tabs.</p>
          {problem && <p role="alert">{problem}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
