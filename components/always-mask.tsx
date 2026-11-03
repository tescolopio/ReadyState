"use client";

import { EyeOff } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getLocalPrivacyStorage,
  loadLocalPrivacySettings,
  LOCAL_PRIVACY_SETTINGS_KEY,
  saveLocalPrivacySettingsOrMemory,
} from "@/lib/local-session-privacy";
import { usePrivacyStore } from "@/store/usePrivacyStore";

/**
 * Names the masker should always replace, for anything its detectors miss.
 * Explicit rules are browser-local and coordinated with local-session sends.
 */
export function AlwaysMaskCard() {
  const alwaysMask = usePrivacyStore((state) => state.alwaysMask);
  const alwaysMaskInitialized = usePrivacyStore((state) => state.alwaysMaskInitialized);
  const alwaysMaskPersisted = usePrivacyStore((state) => state.alwaysMaskPersisted);
  const setAlwaysMask = usePrivacyStore((state) => state.setAlwaysMask);
  const hydrateAlwaysMask = usePrivacyStore((state) => state.hydrateAlwaysMask);
  const [draft, setDraft] = useState(() => alwaysMask.join(", "));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [memoryOnly, setMemoryOnly] = useState(false);
  const id = useId();

  useEffect(() => usePrivacyStore.subscribe((state, previous) => {
    if (state.alwaysMask !== previous.alwaysMask) setDraft(state.alwaysMask.join(", "));
  }), []);

  useEffect(() => {
    const restore = (event?: StorageEvent) => {
      if (event && event.key !== null && event.key !== LOCAL_PRIVACY_SETTINGS_KEY) return;
      try {
        const current = usePrivacyStore.getState();
        if (!event && current.alwaysMaskInitialized && !current.alwaysMaskPersisted) {
          setDraft(current.alwaysMask.join(", "));
          return;
        }
        const storage = getLocalPrivacyStorage();
        if (!storage) throw new Error("Browser privacy storage is unavailable.");
        const rules = loadLocalPrivacySettings(storage);
        let effectiveRules: string[];
        if (event) {
          if (current.alwaysMaskInitialized && !current.alwaysMaskPersisted) {
            effectiveRules = [...new Set([...rules, ...current.alwaysMask])];
            setAlwaysMask(effectiveRules);
          } else {
            setAlwaysMask(rules, true);
            effectiveRules = rules;
          }
        } else {
          if (current.alwaysMaskInitialized) {
            setAlwaysMask(rules, true);
            effectiveRules = rules;
          } else {
            effectiveRules = hydrateAlwaysMask(rules);
          }
        }
        setDraft(effectiveRules.join(", "));
        setMemoryOnly(false);
      } catch {
        setProblem("Browser privacy settings could not be restored. Local-session sends are blocked until storage is repaired.");
      }
    };
    restore();
    window.addEventListener("storage", restore);
    return () => window.removeEventListener("storage", restore);
  }, [hydrateAlwaysMask, setAlwaysMask]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setProblem("");
    void (async () => {
      try {
        const result = await saveLocalPrivacySettingsOrMemory(getLocalPrivacyStorage(), draft.split(","));
        setAlwaysMask(result.rules, result.persisted);
        setDraft(result.rules.join(", "));
        setMemoryOnly(!result.persisted);
      } catch {
        setProblem("Privacy settings were not changed. Allow browser storage and try again.");
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
              : "For names the automatic masking misses."}
          </p>
          <p className="text-xs text-ink-3">
            {memoryOnly || (alwaysMaskInitialized && !alwaysMaskPersisted)
              ? "Some active rules are in memory only and are not saved in this browser. Local-session sends still require Web Locks."
              : "Explicit Settings rules are saved unencrypted in this browser. Saved local sessions check them across tabs."}
          </p>
          {memoryOnly && <p role="status" className="text-xs text-ink-3">This change will be lost when the page is reloaded.</p>}
          {problem && <p role="alert">{problem}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
