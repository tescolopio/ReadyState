"use client";

import { Pencil, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { PageHeader } from "@/components/app-shell";
import { HouseholdWizard, InventoryCheck } from "@/components/household-wizard";
import { Button } from "@/components/ui/button";
import { resetExercise } from "@/lib/exercise-session";
import {
  AGE_RANGES,
  BACKUP_POWER,
  HEATING,
  HOME_TYPES,
  NEED_INFO,
  PET_KINDS,
  SETTINGS,
  SUPPLY_ITEMS,
  WATER_SOURCE,
  hasProfile,
  privateTerms,
  type HouseholdProfile,
} from "@/lib/household";
import { assessInventory, engineBaseline } from "@/lib/inventory";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput } from "@/utils/obfuscator";

const noSubscribe = () => () => {};
const NOT_SET = <span className="text-ink-3">Not set: unknown, not assumed</span>;

const SUPPLY_LABELS: Record<string, string> = Object.assign({}, ...Object.values(SUPPLY_ITEMS));

/**
 * My household (design brief §3, Modern treatment §7.2): what's saved on this
 * device, what the scenario engine sees, and the inventory check. Editing
 * opens the same setup steps as the first visit.
 */
export default function HouseholdPage() {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return hydrated ? <HouseholdContent /> : <main className="flex-1" />;
}

function HouseholdContent() {
  const router = useRouter();
  const profile = useHouseholdStore((state) => state.profile);
  // Decide once after hydration; autosaved answers must not end this setup visit.
  const [editing, setEditing] = useState(
    () => new URLSearchParams(window.location.search).get("setup") === "1" || !hasProfile(profile),
  );
  const saved = hasProfile(profile);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6">
      <PageHeader
        title="My household"
        intro="Who lives with you, your home and what you have on hand. It stays in this browser; the scenario engine sees only the attribute summary below."
      >
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit household
            </Button>
            <Button onClick={() => router.push("/exercises")}>
              <Play className="h-4 w-4" aria-hidden />
              Choose an exercise
            </Button>
          </div>
        )}
      </PageHeader>

      {editing ? (
        <HouseholdWizard
          onStart={() => {
            // A fresh exercise with the edited household, as from the Exercises page; otherwise one in progress resumes.
            resetExercise();
            setEditing(false);
            router.push("/exercise?start=1");
          }}
          onClose={() => (saved ? setEditing(false) : router.push("/journal"))}
        />
      ) : (
        <HouseholdDetails profile={profile} />
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-5 shadow-panel">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-1.5 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function HouseholdDetails({ profile }: { profile: HouseholdProfile }) {
  const { people, pets, location, home, supplies } = profile;
  const findings = useMemo(() => assessInventory(profile), [profile]);
  const preview = useMemo(
    () =>
      engineBaseline(profile, (text) =>
        maskInput(text, {
          alwaysMask: [...usePrivacyStore.getState().alwaysMask, ...privateTerms(profile)],
          dryRun: true,
        }),
      ),
    [profile],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="People and pets">
          <ul className="divide-y divide-line">
            {people.map((person) => (
              <li key={person.id} className="py-2">
                <p className="font-semibold">
                  {person.localName || "Unnamed"}
                  <span className="font-normal text-ink-2"> · {person.ageRange ? AGE_RANGES[person.ageRange] : "age not set"}</span>
                </p>
                {person.needs.length > 0 && (
                  <p className="text-sm text-ink-2">{person.needs.map((need) => NEED_INFO[need.kind].label).join("; ")}</p>
                )}
              </li>
            ))}
            {pets.map((pet) => (
              <li key={pet.id} className="py-2">
                <p className="font-semibold">
                  {pet.localName || "Unnamed pet"}
                  <span className="font-normal text-ink-2"> · {[pet.size, PET_KINDS[pet.kind]].filter(Boolean).join(" ")}</span>
                </p>
              </li>
            ))}
            {!people.length && !pets.length && <li className="py-2">{NOT_SET}</li>}
          </ul>
          <p className="mt-3 text-xs text-ink-3">Names and medication names are shown only on this device.</p>
        </Section>

        <Section title="Home and location">
          <dl>
            <Row label="Region">
              {location.region ? [location.region, location.setting && SETTINGS[location.setting]].filter(Boolean).join(", ") : NOT_SET}
            </Row>
            <Row label="Home">
              {home.type ? [HOME_TYPES[home.type], home.floors && `${home.floors} floors`, home.basement && "basement"].filter(Boolean).join(", ") : NOT_SET}
            </Row>
            <Row label="Heating">{home.heating ? HEATING[home.heating] : NOT_SET}</Row>
            <Row label="Water">{home.water ? WATER_SOURCE[home.water] : NOT_SET}</Row>
            <Row label="Backup power">{home.backupPower ? BACKUP_POWER[home.backupPower] : NOT_SET}</Row>
          </dl>
        </Section>
      </div>

      <Section title="Supplies">
        <dl>
          <Row label="Water">{supplies.waterGallons !== undefined ? `${supplies.waterGallons} gallons` : NOT_SET}</Row>
          <Row label="Food">{supplies.foodDays !== undefined ? `${supplies.foodDays} days` : NOT_SET}</Row>
          <Row label="On hand">{supplies.have.length ? supplies.have.map((id) => SUPPLY_LABELS[id] ?? id).join(", ") : NOT_SET}</Row>
        </dl>
      </Section>

      <Section title="Inventory check">
        <InventoryCheck findings={findings} />
      </Section>

      <Section title="What the scenario engine sees">
        <p className="mb-2 text-sm text-ink-2">
          This is everything sent about your household when an exercise starts. Names, medication and device names are
          replaced or left out.
        </p>
        <pre className="whitespace-pre-wrap rounded-control border border-line bg-field p-3 font-mono text-xs text-ink-2">{preview}</pre>
      </Section>
    </div>
  );
}
