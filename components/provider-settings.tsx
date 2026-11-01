"use client";

import { KeyRound } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ProviderId, ProviderSettings, ServerConfig } from "@/lib/providers";
import { useSettingsStore } from "@/store/useSettingsStore";

const labelClass = "text-sm font-semibold text-ink-3";

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
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-action">
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
                // Drop the key too, so one provider's key is never sent to another.
                update({
                  provider: event.target.value as ProviderId,
                  model: undefined,
                  apiKey: undefined,
                  baseURL: undefined,
                })
              }
              className="flex min-h-11 w-full rounded-control border border-line-strong bg-field px-3 text-sm text-ink "
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

          {/* Custom endpoints may or may not need a key, so it's optional there. */}
          {(provider?.requiresKey !== false || draft.provider === "custom") && (
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
                  !provider?.requiresKey
                    ? "Optional"
                    : provider.serverConfigured
                      ? "Using the server's key"
                      : "Paste your key"
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
          <p className="text-xs text-ink-3">
            Keys are saved in this browser and sent to ReadyState&apos;s server to authenticate with the selected provider.
            They are not part of the model&apos;s conversation text.
          </p>
          {status && <p role="status" className="text-xs text-ink-3">{status}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
