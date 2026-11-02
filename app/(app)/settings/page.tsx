"use client";

import { useEffect, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/app-shell";
import { AlwaysMaskCard } from "@/components/always-mask";
import { ProviderSettingsCard } from "@/components/provider-settings";
import { StyleSwitcher } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { FullBackups } from "@/components/full-backups";
import type { ServerConfig } from "@/lib/providers";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePlanStore } from "@/store/usePlanStore";

/** Settings (design brief §3): secondary controls for privacy, the model provider and data on this device. */
export default function SettingsPage() {
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((config: ServerConfig | null) => {
        if (!cancelled) setServerConfig(config);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
      <PageHeader title="Settings" />

      <Section title="Privacy" intro="Names you add here are replaced with tags in everything you type, for anything the automatic masking misses.">
        <AlwaysMaskCard />
      </Section>

      {serverConfig?.mode === "self-hosted" && (
        <Section title="Model provider" intro="This ReadyState runs on your own server. Choose which AI provider writes the scenarios.">
          <ProviderSettingsCard config={serverConfig} />
        </Section>
      )}

      <Section title="Appearance" intro="ReadyState is testing two visual styles. Both have the same screens and content.">
        <StyleSwitcher />
      </Section>
      <FullBackups />

      <Section title="Data on this device" intro="Working data is saved in this browser. Deleting it cannot be undone and does not delete historical records, named copies or downloaded backups; remove those separately.">
        <div className="space-y-3">
          <DeleteRow
            label="Household profile"
            onDelete={() => useHouseholdStore.getState().clearProfile()}
          />
          <DeleteRow label="Action plan" onDelete={() => usePlanStore.getState().clear()} />
        </div>
      </Section>
    </main>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-panel border border-line bg-surface p-5 shadow-panel">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {intro && <p className="mt-1 text-sm text-ink-2">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

/** A delete with an inline confirmation instead of a browser dialog (Modern treatment §9 "Dialog"). */
function DeleteRow({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [state, setState] = useState<"idle" | "confirming" | "deleted">("idle");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <p className="font-semibold">{label}</p>
      {state === "idle" && (
        <Button variant="outline" size="sm" onClick={() => setState("confirming")}>
          Delete
        </Button>
      )}
      {state === "confirming" && (
        <div role="group" aria-label={`Confirm deleting ${label.toLowerCase()}`} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-2">Delete for good?</span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete();
              setState("deleted");
            }}
          >
            Yes, delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setState("idle")} autoFocus>
            Cancel
          </Button>
        </div>
      )}
      {state === "deleted" && (
        <p className="text-sm text-success" role="status">
          Deleted.
        </p>
      )}
    </div>
  );
}
