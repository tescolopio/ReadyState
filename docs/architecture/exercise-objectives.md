# Exercise objectives: gaps, look-fors and the running plan

_Proposed design, 2026-10-27. Status: the inventory check (step 1) is built; steps 2 and 3 await review._

A tabletop exercise exists to do three things:

1. **Find gaps:** in supplies, plans, skills and assumptions.
2. **Prepare for the worst:** pressure-test the plan against realistic, escalating developments.
3. **Leave with a plan:** a checklist of what to get, decide and practice.

There's no win or lose (decision D8). Every part of the exercise feeds the household's answers to "what do I/we need to know?" and "what can I/we do better?"

```
Household build ──► 1. Inventory check ──► gaps ─┐
                                                 ├──► injects test the gaps ("prepare for the worst")
Each turn ───────► 2. Look-fors for this stage ──┤
                     covered / missed            └──► 3. Running plan: Get · Plan · Practice ──► debrief
```

## 1. Inventory check (built)

`lib/inventory.ts` compares the household profile with published guidance, without the model:
- Water and food against 3 days and 2 weeks.
- Pet food, and pet-friendly shelter planning.
- Medication against 7 days, plus a cold chain for refrigerated medication.
- Backup power for medical devices, with daily kWh.
- CO detectors wherever something burns fuel, and smoke detectors.
- The Ready.gov basic kit.
- Checks for the chosen emergency, such as warmth in a cold outage, documents before an evacuation, and water treatment for a boil-water notice.

Each finding has a status (Missing, Short, Partly covered, To check, Covered), an area, and an action marked **Get** or **Plan**.

- **In the wizard:** findings appear on the Review step, gaps first.
- **In the prompt:** gaps (but not unrecorded items) are sent with the household summary as "Gaps found by the inventory check (test these in the exercise)". The engine can then build injects around the household's real weak points.
- **Sources:** the thresholds are listed at the top of `lib/inventory.ts` and should become sourced knowledge-base records (R1, R3).

## 2. Look-fors at each stage (proposed)

A *look-for* is something a sound response should cover at a given stage of a given emergency. FEMA's exercise program (HSEEP) calls these critical tasks in its exercise evaluation guides. Today the model judges responses from its own sense of what matters. Look-fors make that judgment explicit, consistent and sourced.

**Stages**, from the exercise clock:

| Stage | Hours | Typical focus |
| --- | --- | --- |
| Warning | before or at 0 | Information, early protective steps, staying put versus leaving |
| First hours | 0–6 | Life safety, utilities, heat or cooling, medical needs |
| First day | 6–24 | Supplies, communication, checking on others |
| Days 2–3 | 24–72 | Sustaining people, pets and medication, sanitation, morale, deciding when to leave |

**A look-for record:**

```ts
interface LookFor {
  id: string;                    // "winter.first-hours.heat-safely"
  scenarios: ScenarioId[];       // ["winter-storm", "power-outage"]
  stage: "warning" | "first-hours" | "first-day" | "days-2-3";
  appliesIf?: (profile: HouseholdProfile) => boolean;   // e.g. has refrigerated medication
  task: string;                  // "Keeps warm without indoor fuel-burning heat"
  why: string;                   // one sentence, grounded in the source
  source: string;                // knowledge-base record id (R3)
}
```

Examples for Sam's household in a winter storm:

| Stage | Look-for | Applies because |
| --- | --- | --- |
| First hours | Keeps warm without indoor fuel-burning heat; picks one room to heat | Always, in a cold outage |
| First hours | Protects pipes (drip taps, open cabinets) and knows where the water shutoff is | Has a house with plumbing |
| First hours | Keeps the CO detector working and knows the symptoms | Has a gas furnace and gas stove |
| First day | Plans for the child with asthma: inhaler supply and cold-air triggers | A person has `air-quality` |
| First day | Plans for the dog: warmth, short outdoor trips, food | Has a pet |
| Days 2–3 | Sets a point at which the family leaves, and where it goes | Always, in a long outage |

**How it would work:**

1. **Selection:** the client picks the look-fors that apply to the profile and scenario. It already has the structured profile, and the tasks are generic, so they contain nothing private.
2. **Request:** it sends the current stage's look-fors with the turn request. The route adds them to the prompt: "A sound response at this stage covers: …".
3. **Feedback:** the `generate_turn` feedback gains `addressed` and `missed`, both lists of look-for ids. "What you covered" and "What to consider" keep their wording; the ids make coverage countable.
4. **Escalation:** look-fors missed earlier, and inventory gaps, become candidates for later injects. A skipped water shutoff becomes a burst pipe the next day. That's "prepare for the worst" with a reason, and the proportionate-setbacks rule (G1) still applies.
5. **Debrief:** the debrief receives the coverage, so "what you can do better" is built from what was actually missed, not the model's memory.
6. **Guided options:** response options (G12) should include at least one option that covers the current look-fors and one that misses something important, without saying which is which.

**Privacy:** look-fors are generic text. The only household-specific step, deciding which ones apply, runs on the device.

**Open questions for review:**
- Should missed look-fors be shown as they happen (in "What to consider"), or only at the debrief? Proposed: as they happen, in calm wording.
- How many look-fors per stage? Proposed: 3–6, so the prompt stays under the token budget (G7).
- Who writes and reviews them? Proposed: Research team (R5, R6), with D6 sign-off on medical items.

## 3. The running plan (proposed)

One checklist builds through the exercise, from three sources:

| Source | Example | Category |
| --- | --- | --- |
| Inventory check | "Store about 4 more gallons" | Get |
| Missed look-fors | "Agree when you'd leave, and where you'd go" | Plan |
| Feedback and suggested actions | "Practice shutting off the water main" | Practice |

- **Grouping:** items are grouped as **Get** (supplies), **Plan** (decisions and arrangements) and **Practice** (skills and drills). Each links to the moment that produced it, per brief UX04.
- **The participant decides:** they keep, edit or dismiss each item. Nothing is auto-assigned.
- **Storage:** the checklist is stored locally (F3, F12) and can be printed or exported (F6).
- **Debrief:** "What you can do better" becomes the reviewed list, not a separate paragraph.

## Build order

1. ✅ Inventory check in the wizard and the baseline (this change).
2. Running plan from inventory findings and suggested actions (F12). This needs no engine change.
3. Look-fors: a first library for the power-outage and winter-storm scenarios (R5, R6), the request and prompt changes, `addressed` and `missed` in feedback, and coverage in the debrief (G13).
4. Coverage checks in `npm run eval`: does feedback catch missed look-fors, and do injects follow up on gaps?
