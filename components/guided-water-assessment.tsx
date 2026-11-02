"use client";

import { Droplets, Home, HeartPulse, PawPrint, Users, PackageCheck } from "lucide-react";
import { useId, useRef, useState } from "react";

import { HouseholdWizard, InventoryCheck } from "@/components/household-wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  WATER_CONTAINERS, countedWater, waterReviewKey, waterTopicStatus, type GuidedAssessment,
} from "@/lib/guided-water";
import { UNASSESSED_ANSWERS, withAnswer, type UnassessedAnswer } from "@/lib/household";
import { assessInventory } from "@/lib/inventory";
import { guidanceValue, profileFacts } from "@/lib/rules/engine";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { waterDisplay, waterInput } from "@/lib/water-display";

function ContainerGraphic({ shape }: { shape: "bottle" | "jug" }) {
  return (
    <svg viewBox="0 0 64 80" fill="none" stroke="currentColor" strokeWidth="2" className="h-16 w-12 shrink-0 text-action" aria-hidden="true" focusable="false">
      {shape === "bottle" ? <path d="M25 4h14v12l7 10v46H18V26l7-10Z" />
        : <path d="M18 10h20v10h12v52H10V26l8-6Zm20 18h6v15h-6Z" />}
      <path d="M20 46h24v22H20Z" className="fill-action-soft" />
    </svg>
  );
}

export function GuidedWaterAssessment({
  state, update, openSimple,
}: {
  state: GuidedAssessment;
  update: (patch: Partial<GuidedAssessment>) => boolean;
  openSimple: (topic: number | null) => void;
}) {
  const profile = useHouseholdStore(store => store.profile);
  const [error, setError] = useState("");
  const [completeCount, setCompleteCount] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const findings = assessInventory(profile, { scenario: false });
  const waterFindings = findings.filter(finding => finding.area === "Water");
  const facts = profileFacts(profile);
  const count = countedWater(state.counts);
  const numeric = profile.supplies.waterGallons;
  const answer = profile.answers?.["supplies.waterGallons"];
  const show = (screen: GuidedAssessment["screen"]) => {
    if (update({ screen, ...(screen === "water" ? { waterStarted: true } : {}) })) {
      setCompleteCount(false); setError("");
      setTimeout(() => heading.current?.focus(), 0);
    }
  };
  const save = (gallons: number | undefined, unassessed?: UnassessedAnswer) => {
    setError("");
    if (gallons !== undefined && (!Number.isFinite(gallons) || gallons < 0)) {
      setError("Enter a nonnegative amount, or leave this unknown."); return false;
    }
    try {
      // Read the latest household so editing here never replaces unrelated answers.
      const current = useHouseholdStore.getState();
      current.setProfile(withAnswer({
        ...current.profile, supplies: { ...current.profile.supplies, waterGallons: gallons },
      }, "supplies.waterGallons", unassessed));
      return true;
    } catch { setError("This answer could not be saved to browser storage. Check storage before leaving or reloading."); return false; }
  };
  const unsure = (answer: UnassessedAnswer) => {
    if (save(undefined, answer)) show("results");
  };
  const recorded = numeric === undefined
    ? answer ? UNASSESSED_ANSWERS[answer] : "Not answered"
    : `${numeric > 0 && numeric < 0.001 ? "less than 0.001" : waterDisplay(numeric)} US gallons${numeric === 0 ? " (explicitly none)" : ""}`;
  const availableTopics = [
    { title: "People", detail: "Who needs to be considered; names optional.", icon: Users, topic: 0 },
    { title: "Pets", detail: "Pet kind and optional weight for water estimates.", icon: PawPrint, topic: 1 },
    { title: "Home", detail: "Heating, access, water source and backup resources.", icon: Home, topic: 2 },
    { title: "Health and accessibility", detail: "Optional continuity needs; no diagnosis required.", icon: HeartPulse, topic: 3 },
    { title: "Food and other supplies", detail: "Known resources, explicit absences and unanswered questions.", icon: PackageCheck, topic: 4 },
  ];
  return (
    <section aria-label="Guided assessment" className="space-y-5">
      <div>
        <h2 ref={heading} tabIndex={-1} className="scroll-mt-24 text-2xl font-semibold">
          {state.screen === "topics" ? "Your household journey" : state.screen === "water" ? "Water you have set aside" : "Understand your water findings"}
        </h2>
        {state.screen === "topics" && <p className="mt-2 text-sm text-ink-2">Water is the first guided prototype. Other topics open Simple. No AI required.</p>}
      </div>
      {state.screen === "topics" ? <>
        <p className="text-sm text-ink-2">Topic labels describe your review, not preparedness. You can review a topic while leaving answers unknown. Changes to supporting answers make it need review again.</p>
        <div className="rounded-panel border border-line bg-surface p-4">
          <div className="flex items-center gap-2"><Droplets aria-hidden="true" className="h-6 w-6 text-action" /><h3 className="text-lg font-semibold">Water supplies</h3></div>
          <p className="my-2 text-sm">Recorded amount: {recorded}</p>
          <p className="mb-3 text-sm">Topic: <strong>{waterTopicStatus(profile, state.reviewedWater, state.waterStarted)}</strong></p>
          <Button onClick={() => show("water")}>Explore water supplies</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {availableTopics.map(({ title, detail, icon: Icon, topic }) => <div key={title} className="space-y-2 rounded-panel border border-line p-4">
            <h3 className="flex items-center gap-2 font-semibold"><Icon aria-hidden="true" className="h-5 w-5 shrink-0" />{title}</h3>
            <p className="text-sm text-ink-2">{detail}</p>
            <Button className="max-w-full whitespace-normal" variant="outline" onClick={() => openSimple(topic)}>Open {title.toLowerCase()} in Simple</Button>
          </div>)}
        </div>
        <p className="text-sm text-ink-3">Staying connected, reunification and leaving-home planning need their own question/rule/guidance review; they are not assessed by this prototype.</p>
      </> : <>
        <Button variant="outline" onClick={() => show("topics")}>Back to topics</Button>
        {state.screen === "water" ? <section aria-label="Water question" className="space-y-4 rounded-panel border border-line bg-surface p-4">
          <h3 className="text-xl font-semibold">Do you know how much drinking water you have stored?</h3>
          <p>Count drinking water already set aside for an emergency, not water you plan to buy.</p>
          <p className="text-sm">Current answer: <strong>{recorded}</strong>. You can replace or clear it below.</p>
          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Ways to answer water question">
            <Button variant="outline" aria-pressed={state.entry === "amount"} onClick={() => { update({ entry: "amount" }); setError(""); }}>Enter an amount</Button>
            <Button variant="outline" aria-pressed={state.entry === "count"} onClick={() => { update({ entry: "count" }); setCompleteCount(false); setError(""); }}>Help me count</Button>
            <Button variant="outline" onClick={() => unsure("unknown")}>Not sure</Button>
            <Button variant="outline" onClick={() => unsure("skipped")}>Skip for now</Button>
            <Button variant="outline" onClick={() => unsure("withheld")}>Prefer not to say</Button>
            <Button variant="outline" onClick={() => { if (save(0)) show("results"); }}>I have none (zero)</Button>
          </div>
          <p className="text-xs text-ink-3">An uncertainty choice clears the amount; none records zero. Switching experiences keeps your answer.</p>
          <details className="rounded-control border border-line p-3">
            <summary className="cursor-pointer font-semibold">Show me an example</summary>
            <p className="mt-2 text-sm">Two full containers labeled 1 US gallon hold 2 US gallons. Do not count the same water twice. For partially filled or different-sized containers, use their actual amount rather than guessing.</p>
          </details>
          {state.entry === "amount" && <div className="space-y-2">
            <label htmlFor={`${id}-amount`} className="block font-semibold">Stored drinking water (US gallons)</label>
            <Input id={`${id}-amount`} type="number" min={0} step="any" inputMode="decimal" value={amountDraft ?? waterInput(numeric)}
              onBlur={() => setAmountDraft(null)}
              onChange={event => {
                const raw = event.target.value;
                setAmountDraft(raw);
                save(raw.trim() === "" ? undefined : Number(raw), raw.trim() === "" ? "skipped" : undefined);
              }} />
            <p className="text-sm">Saved as you edit. Blank means skipped, not zero.</p>
            <Button onClick={() => show("results")}>Explain this answer</Button>
          </div>}
          {state.entry === "count" && <section aria-label="Water container helper" className="space-y-3">
            <h4 className="font-semibold">Help me check: count your full containers</h4>
            <p className="text-sm">Count full containers by their labels. Leave unused rows blank. Counts stay a draft until you apply them.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {WATER_CONTAINERS.map(container => <div key={container.id} className="flex items-center gap-3 rounded-control border border-line p-3">
                <ContainerGraphic shape={container.shape} />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`${id}-${container.id}`} className="block text-sm font-semibold">Number of {container.label}s</label>
                  <Input id={`${id}-${container.id}`} type="number" min={0} max={999999} step={1} inputMode="numeric"
                    value={state.counts[container.id]}
                    onChange={event => {
                      const raw = event.target.value;
                      if (raw !== "" && !/^\d{1,6}$/.test(raw)) { setError("Container counts must be whole numbers from 0 to 999999."); return; }
                      if (update({ counts: { ...state.counts, [container.id]: raw } })) { setCompleteCount(false); setError(""); }
                    }} />
                </div>
              </div>)}
            </div>
            <div role="status" className="space-y-2 rounded-control border border-line p-3 text-sm">
              <p>{WATER_CONTAINERS.map(container => `${state.counts[container.id] || 0} x ${container.label}`).join(" + ")}</p>
              <p>Draft total: <strong>{waterDisplay(count.litres)} litres / {waterDisplay(count.gallons)} US gallons</strong>.</p>
              <p>Not saved as your supply until you choose Use counted amount.</p>
            </div>
            <details className="rounded-control border border-line p-3 text-sm">
              <summary className="cursor-pointer font-semibold">Counting and conversion details</summary>
              <p>Check capacity on your own label; drawings are not to scale. Do not count duplicates. For partial or different-size containers, enter their measured amount directly.</p>
              <p>1 US gallon = 3.785411784 litres. Displays round down; calculations retain full precision. Blank rows contribute zero to this draft, not an answer of no water.</p>
            </details>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={completeCount} onChange={event => setCompleteCount(event.target.checked)} />
              This count includes all the stored drinking water I want to record, without duplicates.
            </label>
            <Button disabled={!completeCount} onClick={() => { if (save(count.gallons)) show("results"); }}>Use counted amount</Button>
            <p className="text-xs text-ink-3">If the count is incomplete, keep it as a draft and choose Not sure instead. A confirmed zero total is an explicit answer of none.</p>
          </section>}
          <Button variant="outline" className="max-w-full whitespace-normal" onClick={() => show("results")}>Keep current answer and see findings</Button>
        </section> : <>
          <p className="text-sm">Your recorded answer: <strong>{recorded}</strong>. Uncertainty is not a deficiency.</p>
          <Button variant="outline" onClick={() => show("water")}>Edit water answer</Button>
          <section aria-label="Water calculation explained" className="space-y-2 rounded-panel border border-line p-4 text-sm">
            <h3 className="text-lg font-semibold">What this estimate uses</h3>
            <p>{profile.people.length} {profile.people.length === 1 ? "person" : "people"} recorded. Guidance: {guidanceValue("water.supply", "minimumDays")}-day minimum, {guidanceValue("water.supply", "goalDays")}-day goal.</p>
            {profile.people.length === 0 ? <p>No person count is recorded, so days of supply cannot be calculated. Add household members when you know who to include; no names are required.</p>
              : <p>Daily estimate: {waterDisplay(Number(facts["water.gallonsPerDay"]))} US gallons.
                {typeof facts["water.days"] === "number" && numeric !== undefined ? ` ${waterDisplay(numeric)} stored US gallons / daily estimate = about ${waterDisplay(facts["water.days"], 2)} days.` : " Stored quantity is unassessed; duration is unknown."}</p>}
            <p>Displays round down; duration and findings use the unrounded daily need and stored total.</p>
            {facts["pets.weightsMissing"] && <p>Some dog/cat weights are missing; their water is not included.</p>}
            <details>
              <summary className="cursor-pointer font-semibold">Assumptions and limits</summary>
              <p>General guidance uses {guidanceValue("water.supply", "gallonsPerPersonPerDay")} US gallon per person per day for drinking and sanitation, plus recorded dog/cat weights. Targets are not supplies you already have.</p>
              {profile.pets.length > 0 && <p>Pet estimate: {String(facts["pets.waterGallonsPerDay"] ?? "not available")} US gallons/day from recorded dog/cat weights. Other species are not included in this estimate.</p>}
            <p>Needs vary with heat, health and other circumstances. This is general draft guidance, not a certification or a guarantee. Review the sources below.</p>
            </details>
            <Button variant="outline" onClick={() => setPeopleOpen(value => !value)}>{peopleOpen ? "Close people editor" : "Add or edit people"}</Button>
            {profile.pets.length > 0 && <Button variant="outline" className="max-w-full whitespace-normal" onClick={() => openSimple(1)}>Edit pet details in Simple</Button>}
          </section>
          {peopleOpen && <HouseholdWizard purpose="assessment" initialStep={0} onStart={() => setPeopleOpen(false)} onClose={() => setPeopleOpen(false)} />}
          <InventoryCheck findings={waterFindings} />
          {findings.some(finding => finding.category === "gap" && finding.area !== "Water") && <details className="space-y-2 rounded-control border border-line p-3">
            <summary className="cursor-pointer font-semibold">Other confirmed household gaps still apply</summary>
            <ul className="my-2 list-inside list-disc text-sm">
              {findings.filter(finding => finding.category === "gap" && finding.area !== "Water").map((finding, index) => <li key={`${finding.id}-${index}`}>{finding.finding}</li>)}
            </ul>
            <Button className="max-w-full whitespace-normal" variant="outline" onClick={() => openSimple(null)}>See all findings and evidence in Simple</Button>
          </details>}
          <p className="text-sm">Choose one useful next step from a supported finding above; you do not need to resolve every question now. Previously saved actions keep their original meaning even if your answers change.</p>
          <Button className="max-w-full whitespace-normal" onClick={() => { if (update({ reviewedWater: waterReviewKey(profile) })) show("topics"); }}>Mark water reviewed and return to topics</Button>
          <p className="text-xs text-ink-3">Reviewed means you looked at this topic, even with unknown answers. It does not mean prepared.</p>
        </>}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
      </>}
    </section>
  );
}
