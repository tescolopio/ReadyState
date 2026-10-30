import { AGE_RANGES, PET_KINDS, SCENARIOS, SETTINGS, type HouseholdProfile } from "@/lib/household";

const ageLabels = (profile: HouseholdProfile) =>
  profile.people.map((person) => (person.ageRange ? AGE_RANGES[person.ageRange] : "person"));
const petLabels = (profile: HouseholdProfile) =>
  profile.pets.map((pet) => [pet.size, PET_KINDS[pet.kind]].filter(Boolean).join(" "));

/** "2 people, 1 pet · Ohio, suburban": the active household at a glance. */
export function householdLine(profile: HouseholdProfile) {
  const { people, pets } = profile;
  const who = [
    people.length ? `${people.length} ${people.length === 1 ? "person" : "people"}` : null,
    pets.length ? `${pets.length} ${pets.length === 1 ? "pet" : "pets"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const where = [profile.location.region, profile.location.setting && SETTINGS[profile.location.setting]]
    .filter(Boolean)
    .join(", ");
  return [who, where].filter(Boolean).join(" · ") || "Household";
}

export function HouseholdSummary({ profile }: { profile: HouseholdProfile | null }) {
  if (!profile) return <p className="text-sm text-ink-3">No household yet.</p>;
  const ages = ageLabels(profile);
  const pets = petLabels(profile);
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between gap-2">
        <dt className="text-ink-3">People</dt>
        <dd className="text-right">{ages.length ? ages.join(", ") : "not set"}</dd>
      </div>
      {pets.length > 0 && (
        <div className="flex justify-between gap-2">
          <dt className="text-ink-3">Pets</dt>
          <dd className="text-right">{pets.join(", ")}</dd>
        </div>
      )}
      <div className="flex justify-between gap-2">
        <dt className="text-ink-3">Emergency</dt>
        <dd className="text-right">{SCENARIOS[profile.scenario]}</dd>
      </div>
    </dl>
  );
}
