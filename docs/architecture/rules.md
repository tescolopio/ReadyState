# Rules database

ReadyState's preparedness rules are **data**, kept in `data/rules/`. They aren't buried in code or prompts. Each rule names its sources and review status, so the Research team can add, correct and review rules (R1, R3, R5, D6) without touching the engine. The same files run the inventory check, the safety rules the model follows, the evaluation's safety checks and, once built, the look-fors.

| File | What it holds | Used by |
| --- | --- | --- |
| `sources.json` | The source registry: title, publisher, URL, license, date verified | Every rule's `sources` |
| `guidance.json` | Authoritative facts, such as "1 gallon of water per person per day", with the source's exact words where available | Sent to the scenario engine when relevant to the household; linked from inventory rules |
| `inventory.json` | Inventory checks: supply thresholds, required items, plan prompts | `lib/inventory.ts`, the wizard's Review step, the engine baseline |
| `safety.json` | Safety rules: a line for the model's prompt, plus patterns that flag unsafe advice | `app/api/ttx/route.ts`, `npm run eval` |
| `look-fors.json` | What a sound response covers at each stage of an emergency (draft) | Not wired in yet; see [Exercise objectives](exercise-objectives.md) |

`lib/rules/schema.ts` defines the format, and `lib/rules/index.ts` validates every file when it loads. `lib/rules/rules.test.ts` runs in `npm test`, and so in CI, and rejects:
- duplicate ids
- sources that aren't in the registry
- reviewed rules without a reviewer
- facts the engine doesn't provide
- supply, need and scenario ids that don't exist
- regular expressions that don't compile

Why files and not a hosted database? Rules are shared reference content, not anyone's personal data. They must work in self-hosted and offline installs that have no Supabase, and every change should go through review in a pull request. That review is where D6 sign-off on medical content happens. The hosted service can load these same files into Supabase later if an admin editor is wanted. The files stay the source of truth.

## Guidance

`guidance.json` holds one record per authoritative fact:
- `statement`: our plain-language version.
- `values`: the numbers, for rules and tests to use.
- `brief`: a compact form for the model.
- `quote`: the source's exact words, from US government (public-domain) sources only. Copyrighted sources such as the Red Cross are paraphrased and cited, never quoted.

**How it's used:**
- **By the scenario engine:** records marked `prompt` are sent to the engine when their `when` condition holds for the household. Insulin storage goes only to households with refrigerated medication, flood-water depths only to flood and hurricane exercises. The guidance is appended after privacy masking, because it's public text.
- **By inventory rules:** a rule can name the guidance it implements (`"guidance": "water.supply"`). Tests then check the rule's thresholds match the guidance values.

### Coverage (researched 2026-10-27)

| Topic | Guidance | Sources |
| --- | --- | --- |
| Water | 1 gal per person per day; at least 3 days, 2 weeks if possible; more for pregnancy, nursing, children, illness, pets and heat (needs can double in extreme heat); about ¾ gal of fluid a day; don't ration; replace self-stored water every 6 months | CDC, Ready.gov |
| Water treatment | Boil 1 minute (3 minutes above 5,000 ft); bleach 8 drops per gallon of 6% or 6 drops of 8.25%, doubled if cloudy, 30-minute wait; unscented bleach only | EPA, Ready.gov |
| Food | At least 3 days of non-perishable, no-cook food and a manual can opener; 2 weeks for staying home | FEMA, Ready.gov, Red Cross |
| Food safety | Closed fridge about 4 hours; discard perishables after 4 hours without power or 2 hours above 40 °F; full freezer 48 hours, half 24; ice-crystal rule; 25 lb dry ice keeps 10 ft³ frozen for 3–4 days | CDC, Ready.gov |
| Medication | 7–10 days of prescription and OTC medication plus a written list; refrigerated medication after a day without power; insulin 59–86 °F for up to 28 days, never frozen | CDC, FDA, Red Cross |
| Infants | Ready-to-feed formula is safest; powder only with bottled or boiled water; use within 2 hours | CDC, Ready.gov |
| Carbon monoxide | Generators outdoors only, 20+ ft from openings; never heat with a gas range or oven, grill or camp stove indoors; battery CO detectors near sleeping areas | CDC |
| Fire and electrical | Flashlights over candles; never touch fallen power lines | CDC |
| Cold | Hypothermia signs; below 95 °F is an emergency; possible above 40 °F when wet; frostbite signs and rewarming | CDC |
| Heat | Heat stroke at 103 °F+ (call 911, cool the person); heat exhaustion care; fans may not be enough | CDC |
| Flood | 6 in of moving water knocks adults down, 12 in floats most cars, 2 ft carries SUVs; never enter flood water | NWS |
| Earthquake | Drop, Cover, Hold On; no running outside or doorways; aftershocks; tsunami high ground | Ready.gov |
| Wildfire smoke | A closed room with an air cleaner; N95 or P100 outdoors; cloth masks don't help | EPA |
| Pets | Evacuate with pets; many shelters refuse them; food, water, ID, leash, microchip | Ready.gov |
| Hygiene | Soap and the cleanest water available; sanitizer with at least 60% alcohol | CDC |
| Kit | Ready.gov's basic kit (12 items) and additional supplies | Ready.gov |
| Tornado | A safe room or shelter; otherwise a small interior windowless room or basement on the lowest level; cover head and neck; no safe option in a car | Ready.gov |
| Hurricane, inland | Not just coastal: rain flooding caused 57% of US hurricane deaths over the last decade and can last days; evacuate immediately when told; never drive around barricades; interior room for wind; highest level, not a closed attic, for flooding | Ready.gov, NOAA, NHC, Mecklenburg County |
| Calories | About 1,400 kcal a day for a child, 2,200 for a teen or adult, 1,800 for an older adult (low activity, rounded) | USDA/HHS Dietary Guidelines |
| Pet calories and water | 70 × kg^0.75 × 1.6 kcal a day for a neutered adult dog (cat 1.2), ±50%; dogs drink about 1 oz per lb per day | Pet Nutrition Alliance, AKC (cite-only) |
| Sanitation | Twin-bucket emergency toilet (5-gallon buckets, 3–5 mil bags, half a cup of cover per use, fill halfway, nothing buried within 100 ft of water); limit flushing in floods; don't pump septic past half | Oregon State Extension (cite-only), CDC |
| Medical devices | CPAP about 56 W (73 W peak, more with a humidifier); home oxygen concentrator about 350 W; portable concentrator batteries 2–4 h, up to 12 with packs | CDC-hosted study, Philips, ResMed (cite-only) |

### Corrections and conflicts found

- **No current federal source for a 2-week food goal.** Ready.gov now says "a several-day supply" for both food and water, without a number. CDC gives 3 days and 2 weeks for **water**. For **food**, FEMA's basic kit gives 3 days, and the 2-week figure is the Red Cross's (cited, not quoted).
- **Medication days differ by source:** CDC says 7–10 days and the Red Cross says 7. The rule flags below 7.
- **The heat stroke threshold differs:** some CDC materials say 103 °F and others 104 °F. We use 103 °F, the more conservative figure.
- **Pet food has no authoritative number** ("several days"). Our 3-day and 2-week thresholds mirror the human guidance, and the rule says so.
- **The twin-bucket toilet isn't a CDC method.** It comes from New Zealand's Wellington Region Emergency Management Office after the 2011 Christchurch earthquake, adapted by Oregon State University Extension. CDC's own guidance covers bucket latrines with bag liners, and septic systems.
- **Calorie figures are simplified.** The Dietary Guidelines give estimates by sex, age and activity. The profile records only an age range, so each range uses one rounded low-activity figure; the record's notes keep the ranges.
- **Device wattages are per model.** One CPAP and one home concentrator, from manufacturer specifications; the wizard offers them only as "typical" figures when the user doesn't know their own device's rating.

### Not yet covered

- Tornado safety for mobile homes (NWS guidance to research)
- Coastal evacuation zones by state (for example ReadyNC's Know Your Zone): Charlotte is inland, so it isn't needed yet
- Older adults' and children's specific guidance (CDC has pages); phased in later
- More device types: ventilators, suction, feeding pumps, power wheelchairs
- CO poisoning symptoms in detail
- The survival "rule of threes": a wilderness heuristic, not household guidance and not found in federal sources. It could appear as UI flavor text once it has a citable source, never as consequence logic.

## Review status

Every rule has `status`: `draft` or `reviewed`. Drafts work, but haven't had the review D6 requires. A reviewed rule must name `reviewedBy`. **All rules are drafts today.**

A source's `verified` date means its page was retrieved and checked against the rules that cite it. This was done on 2026-10-27, by direct fetch or from search results that quote the page. It's an automated check, not the human sign-off D6 requires. Sources still marked `null` have not been checked.

## Local assessment and answer semantics

`/assessment` is an AI-free entry point sharing the household store, rule engine
and action plan with the rest of the app. A short profile is enough to start;
optional topics can be revisited independently. `assessInventory(profile,
{ scenario: false })` ignores the selected exercise scenario, while retaining
checks independently supported by household facts. Exercises continue to use
the scenario-aware assessment and S2's review-before-send.

Supply presence and absence are separate: `supplies.have` records positives,
`supplies.absent` records explicit negatives. Numeric zero and explicit home
answers such as backup power `none` remain facts. Local `answers` metadata
distinguishes `unknown`, `skipped` and `withheld`; those states are not gaps.
`Person.absentNeeds` records explicitly inapplicable practical needs rather
than inferring them from an empty needs list. Formula alone can be marked
`not-applicable`, meaning no formula feeding; that suppresses only the formula
check, not other infant or supply guidance.

Household storage version 1 migrates old checkbox data conservatively:
positive items/needs, numbers (including zero) and explicit home choices survive;
unchecked items/needs remain unassessed. Editing or clearing an answer removes
the previous factual value before recording its new answer state.

Conditions use three-valued logic internally: true, false and unassessed.
Negating an unassessed item never makes it absent. `all`/`any` preserve a
decisive false/true respectively, so an unrelated unknown does not erase
independently supported findings. `exists: false` is deliberately a
missing-information check, not a confirmed deficiency. Missing applicability
or pass answers produce an unassessed finding without a purchase/action.

Findings carry a category and the actual supporting facts (quantities,
relevant item answers and contextual facts), shown alongside the rule and
source links:

- **Confirmed gaps:** explicitly absent items or known below-threshold supplies.
- **Unassessed answers:** information not provided, unknown or withheld.
- **Planning actions and guidance:** relevant reminders, not an assertion that
  no arrangement exists. A future planning-gap rule must require an explicit
  negative answer.
- **Scenario-specific concerns:** concerns conditional on the selected exercise.
- **Recorded resources:** recorded facts meeting that check, not a safety certification.

Known gaps remain visible alongside unknown items. Only findings with a real
action can be saved to the shared plan, and duplicate action text is not added.
There is no aggregate preparedness score. All existing content-review caveats
still apply; this implementation does not certify draft rules.

Saved actions retain their original wording, source, timestamp and chosen
status when household answers change. The plan explicitly labels them as
earlier choices, not live deficiencies, and links back to the current
assessment. Updating a profile never silently deletes or completes a saved
action; users decide whether to keep, complete or remove it.

Outgoing briefings exclude unassessed findings and local answer-status metadata.
They retain explicitly supported gaps and explicitly reported supply absences
(including items without inventory rules), with the existing masking/review
boundary. Negative health-need metadata stays local.
Assessment results and plan saving require neither an API key nor a model call.
Dedicated communication/evacuation questions are outside this first increment.

### Local snapshots

The assessment's save/load controls share the existing working household and
plan stores. `lib/household-saves.ts` defines a strict, versioned portable JSON
contract and the separate `readystate-household-saves` named snapshot library.
Snapshots preserve all household answer semantics and the selected action
history, not derived findings; results are recalculated using the installed
rules after restore. A snapshot is an independent copy, not a second assessment
engine or a live profile.

File parsing validates identifiers, answer enums, nonnegative finite numbers,
timestamps, supported not-applicable states and contradictory answers.
Unrecognized fields are rejected, including provider settings. Imports are
limited to 2 MiB, require a replacement confirmation, and never merge actions
or silently overwrite named copies. Working household/plan persistence is
written with rollback on ordinary write failure before rehydrating the shared
stores. An open wizard draft is discarded only after a confirmed successful
restore, so stale edits cannot overwrite restored data.

All data stays local; household-only snapshots are unencrypted and include sensitive local
details. Deleting the current profile, named copies and downloaded files are
separate operations. No exercise session, provider settings, API keys or
masking ledger are serialized in that format. Local save/load does not bypass S2.

The separate full-data format (`lib/full-backups.ts`) includes browser-saved
provider settings/keys, local progress/history, the active exercise/draft,
private tag mappings, named household copies and appearance. It is encrypted
with Web Crypto AES-256-GCM using a fresh 16-byte salt, 12-byte IV and
PBKDF2-SHA256 (600,000 iterations). The password is not persisted. Versioned
strict schemas validate the decrypted application state before replacement.
Encrypted backup containers are excluded from the logical payload to prevent
recursive growth; server configuration/keys, cookies, eval capture metadata,
outgoing approvals and retry credentials are never included.

`readystate-local-records` retains the assessment topic and explicit dated
snapshots. Assessment reports preserve the answers, category/status,
explanations, supporting facts, next steps, rule IDs and source references at
save time; they are not recomputed historical scores. Saved exercises retain
participant text and completed tool outputs/debrief quality notices, not
transport or eval metadata. Local history is unencrypted and may contain
private mappings; its UI discloses this before saving. A saved resume point is
consumed after loading; it is not continuous exercise autosave. Full restore
reloads the page, invalidating stale reviews and memory-only retry credentials.
Reopening a saved exercise sends nothing and requires fresh S2 review for a new
response. Previously captured retry settings are not reconstructible.

Historical Alex replay/evaluation evidence uses the baseline frozen in
`lib/fixtures/alex-replay-turns.json` from pre-migration main `3f9dc8d`.
Its legacy unchecked-as-absent interpretation is historical evidence only,
not the behavior for current or migrated households. No evaluation was rerun.

## Facts

Rules never read the profile directly. They use named facts from `lib/rules/engine.ts`, so the vocabulary stays stable when the profile changes:

| Fact | Meaning |
| --- | --- |
| `people.count`, `headcount` | People recorded; headcount is at least 1, for per-person supplies |
| `people.ageRanges` | Age range ids present (`infant`, `child`, `teen`, `adult`, `older-adult`) |
| `needs.kinds` | Need ids recorded for anyone (`refrigerated-medication`, `powered-device`, …) |
| `pets.count`, `pets.any` | Pets recorded |
| `home.type`, `home.floors`, `home.heating`, `home.cooking`, `home.water`, `home.backupPower` | The home, as ids from `lib/household.ts` |
| `home.burnsFuel` | Heating, cooking or backup power burns fuel |
| `hasBackupPower` | Backup power other than none |
| `scenario` | The chosen emergency id |
| `supplies.have` | Checked supply item ids |
| `supplies.absent` | Only supply items explicitly reported absent |
| `water.daysPerPerson`, `food.days`, `petFood.days` | Days of supply |

Rules with `"forEach": "need"` run once per recorded need, and also get `person.id`, `person.label` ("Person 3 (older adult (65+))"), `need.kind`, `need.label`, `need.asksDays`, `need.daysSupply`, `need.watts` and `need.kwhPerDay`.

## Conditions

`when` decides whether a rule applies; a check's `pass` decides whether it's satisfied.

```json
{ "fact": "home.water", "equals": "well" }
{ "fact": "scenario", "in": ["winter-storm", "power-outage"] }
{ "fact": "supplies.have", "includes": "co-detector" }
{ "fact": "supplies.have", "includesAny": ["sleeping-bags", "blankets"] }
{ "fact": "home.floors", "gt": 1 }
{ "fact": "need.watts", "exists": true }
{ "all": [ … ] }   { "any": [ … ] }   { "not": { … } }
```

## Inventory rule types

- **`supply`** grades a days-of-supply `metric`: below `minimum` is Short, below `goal` (optional) is Partly covered, and anything else is Recorded. A missing value is Unassessed, with no action. Its `messages` and `actions` templates can use `{days}`, `{shortBy}` and `{shortByGallons}`.
- **`check`** applies when `when` holds. It reports `failStatus` unless `pass` holds; with no `pass` it reports guidance or missing information as appropriate. `reportOk` shows a neutral Recorded finding when it passes, rather than reusing its failure text.
- **`kit`** lists only explicitly absent supply `items`. It's Short when more than `shortAbove` items are explicitly absent, otherwise Partly covered. Unknown items are listed separately, never counted as missing. It is Recorded only when all required items are positively recorded. Templates can use `{missingCount}`, `{total}` and `{missingList}`.

**Templates:**
- `{fact}` inserts a value.
- `{fact? text}` includes the text only when the fact is set, for example `per day{pets.any?, plus extra for pets}`.

## Adding a rule

1. Add the source to `sources.json` if it's new. Use `public-domain` for US government works and `cite-only` for copyrighted guidance. Paraphrase copyrighted guidance; don't copy it.
2. Add the rule with `"status": "draft"`, citing the source ids.
3. Run `npm test`. The validation tests explain anything wrong.
4. For medical or life-safety content, ask the D6 reviewer to check it, then set `"status": "reviewed"` and `"reviewedBy"`.
