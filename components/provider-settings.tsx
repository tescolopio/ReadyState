"use client";

import { KeyRound } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ProviderId, ProviderSettings, ServerConfig } from "@/lib/providers";
import { useSettingsStore } from "@/store/useSettingsStore";

const labelClass = "font-mono text-[10px] uppercase tracking-widest text-zinc-500";

/** Self-hosted only: pick the model provider and bring your own API key. */
export function ProviderSettingsCard({ config }: { config: ServerConfig }) {
  const saved = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const [draft, setDraft] = useState<ProviderSettings>(
    () => saved ?? { provider: config.defaultProvider },
  );
  const [status, setStatus] = useState<string | null>(null);
  const id = useId();

  const provider = config.providers.find((p) => p.id === draft.provider);
  const update = (patch: Partial<ProviderSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus(null);
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSettings(draft);
    setStatus("Saved to this browser.");
  };

  const reset = () => {
    setSettings(null);
    setDraft({ provider: config.defaultProvider });
    setStatus("Using server defaults.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-sky-400">
          <KeyRound className="h-4 w-4" aria-hidden />
          Model Provider
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3 text-sm">
          <div className="space-y-1">
            <label htmlFor={`${id}-provider`} className={labelClass}>
              Provider
            </label>
            <select
              id={`${id}-provider`}
              value={draft.provider}
              onChange={(event) =>
                update({
                  provider: event.target.value as ProviderId,
                  model: undefined,
                  baseURL: undefined,
                })
              }
              className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              {config.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.serverConfigured && p.requiresKey ? " (server key)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor={`${id}-model`} className={labelClass}>
              Model
            </label>
            <Input
              id={`${id}-model`}
              value={draft.model ?? ""}
              onChange={(event) => update({ model: event.target.value })}
              placeholder={provider?.defaultModel ?? "Required, e.g. vendor/model-name"}
            />
          </div>

          {provider?.requiresKey !== false && (
            <div className="space-y-1">
              <label htmlFor={`${id}-key`} className={labelClass}>
                API key
              </label>
              <Input
                id={`${id}-key`}
                type="password"
                autoComplete="off"
                value={draft.apiKey ?? ""}
                onChange={(event) => update({ apiKey: event.target.value })}
                placeholder={
                  provider?.serverConfigured ? "Using the server's key" : "Paste your key"
                }
              />
            </div>
          )}

          {provider?.editableBaseURL && (
            <div className="space-y-1">
              <label htmlFor={`${id}-url`} className={labelClass}>
                Base URL
              </label>
              <Input
                id={`${id}-url`}
                value={draft.baseURL ?? ""}
                onChange={(event) => update({ baseURL: event.target.value })}
                placeholder={
                  draft.provider === "ollama"
                    ? "http://localhost:11434/v1"
                    : "https://host/v1 (OpenAI-compatible)"
                }
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              Use server defaults
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            {status ??
              "Keys stay in this browser and are sent only to this ReadyState server."}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
