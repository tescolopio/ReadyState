"use client";

import { ArrowLeft, ArrowRight, Home, Play, Plus, Trash2, X } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AGE_RANGES,
  BACKUP_POWER,
  COOKING,
  HEATING,
  HOME_TYPES,
  NEED_INFO,
  PET_KINDS,
  SCENARIOS,
  SETTINGS,
  SUPPLY_ITEMS,
  WATER_SOURCE,
  describeHousehold,
  hasProfile,
  newId,
  type AgeRange,
  type HouseholdProfile,
  type Need,
  type NeedKind,
  type Person,
  type Pet,
  type PetKind,
  type SupplyId,
} from "@/lib/household";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { maskInput } from "@/utils/obfuscator";

const labelClass = "font-mono text-[10px] uppercase tracking-widest text-zinc-500";
const fieldClass =
  "flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500";
const textAreaClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500";

const STEPS = ["People", "Pets", "Home", "Health needs", "Supplies", "Review"] as const;
type Step = (typeof STEPS)[number];

const WHY: Record<Step, string> = {
  People:
    "Ages shape what can go wrong and who can help. Names are optional and never leave this device; the scenario sees “older adult”, not a name.",
  Pets: "Pets need food, water and a plan: many shelters don't accept them, and stressed animals bolt.",
  Home: "Heating, water and power decide how a storm or outage plays out. A general region (like a state) is enough: never enter an address.",
  "Health needs":
    "Describe what a need demands, not a diagnosis. Medication and device names stay on this device; the scenario sees only the constraint, such as “refrigerated medication, 14 days on hand”.",
  Supplies: "What you already have changes which problems you face. Skip anything you're unsure of: it stays unknown, not assumed.",
  Review: "This is exactly what the scenario engine will receive. Anything you skipped is marked unknown.",
};

/** Parses a number field, keeping blank as "unknown" rather than 0. */
const toNumber = (value: string) => (value.trim() === "" ? undefined : Math.max(0, Number(value)));

/** A `<select>` over a label map, with a blank "not sure" choice. */
function Choice<K extends string>({
  label,
  options,
  value,
  onChange,
  blank = "Not sure / skip",
}: {
  label: string;
  options: Record<K, string>;
  value?: K;
  onChange: (value: K | undefined) => void;
  blank?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange((event.target.value || undefined) as K | undefined)}
        className={fieldClass}
      >
        <option value="">{blank}</option>
        {(Object.entries(options) as [K, string][]).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          type="number"
          min={0}
          inputMode="decimal"
          value={value ?? ""}
          placeholder={placeholder ?? "Not sure"}
          onChange={(event) => onChange(toNumber(event.target.value))}
        />
      )}
    </Field>
  );
}

const personTitle = (person: Person, index: number) =>
  person.localName?.trim() || `Person ${index + 1}${person.ageRange ? ` (${AGE_RANGES[person.ageRange]})` : ""}`;

/**
 * Step-by-step household setup (work breakdown F2). Every step can be skipped,
 * progress is saved as the person goes, and the last step previews exactly
 * what the scenario engine will see.
 */
export function HouseholdWizard({
  onStart,
  onClose,
}: {
  onStart: (baseline: string) => void;
  onClose: () => void;
}) {
  const saved = useHouseholdStore((state) => state.profile);
  const setProfile = useHouseholdStore((state) => state.setProfile);
  const clearProfile = useHouseholdStore((state) => state.clearProfile);
  const [profile, setDraft] = useState<HouseholdProfile>(saved);
  const [step, setStep] = useState(0);

  // Save as the person goes, so an interruption never loses their answers.
  const update = (next: HouseholdProfile) => {
    setDraft(next);
    setProfile(next);
  };
  const go = (delta: number) => setStep((current) => Math.min(STEPS.length - 1, Math.max(0, current + delta)));

  const current = STEPS[step];
  const preview = useMemo(
    () => (current === "Review" ? maskInput(describeHousehold(profile), { dryRun: true }) : ""),
    [current, profile],
  );

  const setPerson = (id: string, patch: Partial<Person>) =>
    update({ ...profile, people: profile.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const setPet = (id: string, patch: Partial<Pet>) =>
    update({ ...profile, pets: profile.pets.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const setNeed = (person: Person, kind: NeedKind, patch: Partial<Need> | null) => {
    const others = person.needs.filter((need) => need.kind !== kind);
    const existing = person.needs.find((need) => need.kind === kind) ?? { kind };
    setPerson(person.id, { needs: patch === null ? others : [...others, { ...existing, ...patch }] });
  };
  const toggleSupply = (id: SupplyId, on: boolean) =>
    update({
      ...profile,
      supplies: {
        ...profile.supplies,
        have: on ? [...profile.supplies.have, id] : profile.supplies.have.filter((item) => item !== id),
      },
    });

  return (
    <section aria-label="Household setup" className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-emerald-400">
            <Home className="h-4 w-4" aria-hidden />
            My household · step {step + 1} of {STEPS.length}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{current}</h2>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose} aria-label="Close household setup">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <ol className="flex flex-wrap gap-1" aria-label="Steps">
        {STEPS.map((name, index) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => setStep(index)}
              aria-current={index === step ? "step" : undefined}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                index === step
                  ? "border-emerald-500 text-emerald-300"
                  : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {name}
            </button>
          </li>
        ))}
      </ol>

      <p className="text-sm text-zinc-400">{WHY[current]}</p>

      {current === "People" && (
        <div className="space-y-3">
          {profile.people.map((person, index) => (
            <div key={person.id} className="grid gap-2 rounded-md border border-zinc-800 p-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={`Person ${index + 1} name (optional, this device only)`}>
                {(id) => (
                  <Input
                    id={id}
                    value={person.localName ?? ""}
                    autoComplete="off"
                    onChange={(event) => setPerson(person.id, { localName: event.target.value })}
                  />
                )}
              </Field>
              <Choice
                label="Age range"
                options={AGE_RANGES}
                value={person.ageRange}
                onChange={(ageRange) => setPerson(person.id, { ageRange })}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-end"
                aria-label={`Remove ${personTitle(person, index)}`}
                onClick={() => update({ ...profile, people: profile.people.filter((p) => p.id !== person.id) })}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {(Object.entries(AGE_RANGES) as [AgeRange, string][]).map(([ageRange, text]) => (
              <Button
                key={ageRange}
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  update({ ...profile, people: [...profile.people, { id: newId(), ageRange, needs: [] }] })
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {text}
              </Button>
            ))}
          </div>
        </div>
      )}

      {current === "Pets" && (
        <div className="space-y-3">
          {profile.pets.map((pet, index) => (
            <div key={pet.id} className="grid gap-2 rounded-md border border-zinc-800 p-3 sm:grid-cols-2">
              <Field label={`Pet ${index + 1} name (optional, this device only)`}>
                {(id) => (
                  <Input
                    id={id}
                    value={pet.localName ?? ""}
                    autoComplete="off"
                    onChange={(event) => setPet(pet.id, { localName: event.target.value })}
                  />
                )}
              </Field>
              <Choice
                label="Kind"
                options={PET_KINDS}
                value={pet.kind}
                blank="Choose"
                onChange={(kind) => setPet(pet.id, { kind: kind ?? "other" })}
              />
              <Choice
                label="Size"
                options={{ small: "small", medium: "medium", large: "large" }}
                value={pet.size}
                onChange={(size) => setPet(pet.id, { size })}
              />
              <Field label="Needs or behavior (optional)">
                {(id) => (
                  <Input
                    id={id}
                    value={pet.notes ?? ""}
                    placeholder="e.g. daily medication, afraid of thunder"
                    onChange={(event) => setPet(pet.id, { notes: event.target.value })}
                  />
                )}
              </Field>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => update({ ...profile, pets: profile.pets.filter((p) => p.id !== pet.id) })}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove pet
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {(["dog", "cat", "bird", "small-animal", "horse", "livestock", "other"] as PetKind[]).map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update({ ...profile, pets: [...profile.pets, { id: newId(), kind }] })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {PET_KINDS[kind]}
              </Button>
            ))}
          </div>
        </div>
      )}

      {current === "Home" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Region (state or province)">
            {(id) => (
              <Input
                id={id}
                value={profile.location.region ?? ""}
                placeholder="e.g. Colorado"
                onChange={(event) => update({ ...profile, location: { ...profile.location, region: event.target.value } })}
              />
            )}
          </Field>
          <Choice
            label="Area"
            options={SETTINGS}
            value={profile.location.setting}
            onChange={(setting) => update({ ...profile, location: { ...profile.location, setting } })}
          />
          <Choice
            label="Home type"
            options={HOME_TYPES}
            value={profile.home.type}
            onChange={(type) => update({ ...profile, home: { ...profile.home, type } })}
          />
          <NumberField
            label="Floors"
            value={profile.home.floors}
            onChange={(floors) => update({ ...profile, home: { ...profile.home, floors } })}
          />
          <Choice
            label="Basement"
            options={{ yes: "Yes", no: "No" }}
            value={profile.home.basement === undefined ? undefined : profile.home.basement ? "yes" : "no"}
            onChange={(answer) =>
              update({ ...profile, home: { ...profile.home, basement: answer === undefined ? undefined : answer === "yes" } })
            }
          />
          <Choice
            label="Heating"
            options={HEATING}
            value={profile.home.heating}
            onChange={(heating) => update({ ...profile, home: { ...profile.home, heating } })}
          />
          <Choice
            label="Cooking"
            options={COOKING}
            value={profile.home.cooking}
            onChange={(cooking) => update({ ...profile, home: { ...profile.home, cooking } })}
          />
          <Choice
            label="Water"
            options={WATER_SOURCE}
            value={profile.home.water}
            onChange={(water) => update({ ...profile, home: { ...profile.home, water } })}
          />
          <Choice
            label="Backup power"
            options={BACKUP_POWER}
            value={profile.home.backupPower}
            onChange={(backupPower) => update({ ...profile, home: { ...profile.home, backupPower } })}
          />
          {profile.home.backupPower && profile.home.backupPower !== "none" && (
            <NumberField
              label="Backup capacity (watts)"
              value={profile.home.backupWatts}
              onChange={(backupWatts) => update({ ...profile, home: { ...profile.home, backupWatts } })}
            />
          )}
          <div className="sm:col-span-2">
            <Field label="Anything else about the home (optional)">
              {(id) => (
                <textarea
                  id={id}
                  rows={2}
                  className={textAreaClass}
                  value={profile.home.notes ?? ""}
                  placeholder="e.g. detached garage, no AC, steep driveway, ground-floor windows face the river"
                  onChange={(event) => update({ ...profile, home: { ...profile.home, notes: event.target.value } })}
                />
              )}
            </Field>
          </div>
        </div>
      )}

      {current === "Health needs" && (
        <div className="space-y-3">
          {profile.people.length === 0 && (
            <p className="text-sm text-zinc-400">Add people in the first step to record their needs.</p>
          )}
          {profile.people.map((person, index) => (
            <fieldset key={person.id} className="space-y-2 rounded-md border border-zinc-800 p-3">
              <legend className="px-1 text-sm font-medium">{personTitle(person, index)}</legend>
              {(Object.entries(NEED_INFO) as [NeedKind, (typeof NEED_INFO)[NeedKind]][]).map(([kind, info]) => {
                const need = person.needs.find((n) => n.kind === kind);
                return (
                  <div key={kind} className="space-y-2">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={Boolean(need)}
                        onChange={(event) => setNeed(person, kind, event.target.checked ? {} : null)}
                      />
                      <span>
                        {info.label}
                        {info.hint && <span className="block text-xs text-zinc-500">{info.hint}</span>}
                      </span>
                    </label>
                    {need && info.asks && (
                      <div className="ml-6 grid gap-2 sm:grid-cols-2">
                        <Field label={info.asks === "days" ? "Medication name (this device only)" : "Device (this device only)"}>
                          {(id) => (
                            <Input
                              id={id}
                              value={need.localDetail ?? ""}
                              autoComplete="off"
                              onChange={(event) => setNeed(person, kind, { localDetail: event.target.value })}
                            />
                          )}
                        </Field>
                        {info.asks === "days" ? (
                          <NumberField
                            label="Days of supply on hand"
                            value={need.daysSupply}
                            onChange={(daysSupply) => setNeed(person, kind, { daysSupply })}
                          />
                        ) : (
                          <NumberField
                            label="Power draw (watts, if known)"
                            value={need.watts}
                            onChange={(watts) => setNeed(person, kind, { watts })}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
      )}

      {current === "Supplies" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              label="Stored water (gallons)"
              value={profile.supplies.waterGallons}
              onChange={(waterGallons) => update({ ...profile, supplies: { ...profile.supplies, waterGallons } })}
            />
            <NumberField
              label="Food (days)"
              value={profile.supplies.foodDays}
              onChange={(foodDays) => update({ ...profile, supplies: { ...profile.supplies, foodDays } })}
            />
            {profile.pets.length > 0 && (
              <NumberField
                label="Pet food (days)"
                value={profile.supplies.petFoodDays}
                onChange={(petFoodDays) => update({ ...profile, supplies: { ...profile.supplies, petFoodDays } })}
              />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(SUPPLY_ITEMS).map(([group, items]) => (
              <fieldset key={group} className="space-y-1">
                <legend className={labelClass}>{group}</legend>
                {(Object.entries(items) as [SupplyId, string][]).map(([id, text]) => (
                  <label key={id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={profile.supplies.have.includes(id)}
                      onChange={(event) => toggleSupply(id, event.target.checked)}
                    />
                    {text}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <Field label="Anything else (optional)">
            {(id) => (
              <textarea
                id={id}
                rows={2}
                className={textAreaClass}
                value={profile.supplies.other ?? ""}
                placeholder="e.g. 2 cases of MREs, a chainsaw, 20 lb propane tank, kayak"
                onChange={(event) => update({ ...profile, supplies: { ...profile.supplies, other: event.target.value } })}
              />
            )}
          </Field>
        </div>
      )}

      {current === "Review" && (
        <div className="space-y-3">
          <Choice
            label="Emergency to practice"
            options={SCENARIOS}
            value={profile.scenario}
            blank="Surprise me"
            onChange={(scenario) => update({ ...profile, scenario: scenario ?? "surprise" })}
          />
          <div>
            <p className={labelClass}>What the scenario engine sees</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
              {preview}
            </pre>
          </div>
          <p className="text-xs text-zinc-500">
            Your profile is saved in this browser only.{" "}
            <button
              type="button"
              className="underline hover:text-zinc-300"
              onClick={() => {
                clearProfile();
                setDraft(useHouseholdStore.getState().profile);
                setStep(0);
              }}
            >
              Delete it
            </button>
          </p>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2 border-t border-zinc-800 pt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => go(-1)} disabled={step === 0}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </Button>
        {current === "Review" ? (
          <Button
            type="button"
            size="sm"
            disabled={!hasProfile(profile)}
            onClick={() => onStart(describeHousehold(profile))}
          >
            <Play className="h-4 w-4" aria-hidden />
            Start exercise
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => go(1)}>
            {step === STEPS.length - 2 ? "Review" : "Next"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </section>
  );
}
