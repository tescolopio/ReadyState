"use client";

import { EyeOff } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePrivacyStore } from "@/store/usePrivacyStore";

/**
 * Names the masker should always replace, for anything its detectors miss.
 * Held in memory only, like the privacy ledger, so it clears on reload.
 */
export function AlwaysMaskCard() {
  const alwaysMask = usePrivacyStore((state) => state.alwaysMask);
  const setAlwaysMask = usePrivacyStore((state) => state.setAlwaysMask);
  const [draft, setDraft] = useState(() => alwaysMask.join(", "));
  const id = useId();

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAlwaysMask(draft.split(","));
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
            <Button type="submit" size="sm" variant="outline">
              Set
            </Button>
          </div>
          <p className="text-xs text-ink-3">
            {alwaysMask.length > 0
              ? `Masking ${alwaysMask.length} name${alwaysMask.length === 1 ? "" : "s"} in everything you send.`
              : "For names the automatic masking misses. Kept in memory only."}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
