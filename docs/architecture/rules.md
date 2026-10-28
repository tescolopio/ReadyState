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

### Corrections and conflicts found

- **No current federal source for a 2-week food goal.** Ready.gov now says "a several-day supply" for both food and water, without a number. CDC gives 3 days and 2 weeks for **water**. For **food**, FEMA's basic kit gives 3 days, and the 2-week figure is the Red Cross's (cited, not quoted).
- **Medication days differ by source:** CDC says 7–10 days and the Red Cross says 7. The rule flags below 7.
- **The heat stroke threshold differs:** some CDC materials say 103 °F and others 104 °F. We use 103 °F, the more conservative figure.
- **Pet food has no authoritative number** ("several days"). Our 3-day and 2-week thresholds mirror the human guidance, and the rule says so.

### Not yet covered

- Emergency toilets and waste disposal
- Calorie needs per person
- Hurricane evacuation zones and shelter-in-place details
- Older adults' and children's specific guidance (CDC has pages)
- Medical-device wattages by device type
- CO poisoning symptoms in detail
- Tornado safety
- Survival "rules of three" (3 minutes of air, 3 hours of shelter, 3 days of water, 3 weeks of food): a common heuristic, **not found in federal guidance**. It could come from public military survival doctrine (Distribution A) after checking.

## Review status

Every rule has `status`: `draft` or `reviewed`. Drafts work, but haven't had the review D6 requires. A reviewed rule must name `reviewedBy`. **All rules are drafts today.**

A source's `verified` date means its page was retrieved and checked against the rules that cite it. This was done on 2026-10-27, by direct fetch or from search results that quote the page. It's an automated check, not the human sign-off D6 requires. Sources still marked `null` have not been checked.

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

- **`supply`** grades a days-of-supply `metric`: below `minimum` is Short, below `goal` (optional) is Partly covered, and anything else is Covered. A missing value is To check. Its `messages` and `actions` templates can use `{days}`, `{shortBy}` and `{shortByGallons}`.
- **`check`** applies when `when` holds. It reports `failStatus` unless `pass` holds; with no `pass` it always reports, which suits plan prompts. `reportOk` also shows a Covered finding when it passes.
- **`kit`** is a checklist of supply `items`. It's Short when more than `shortAbove` items are missing, otherwise Partly covered. Templates can use `{missingCount}`, `{total}` and `{missingList}`.

**Templates:**
- `{fact}` inserts a value.
- `{fact? text}` includes the text only when the fact is set, for example `per day{pets.any?, plus extra for pets}`.

## Adding a rule

1. Add the source to `sources.json` if it's new. Use `public-domain` for US government works and `cite-only` for copyrighted guidance. Paraphrase copyrighted guidance; don't copy it.
2. Add the rule with `"status": "draft"`, citing the source ids.
3. Run `npm test`. The validation tests explain anything wrong.
4. For medical or life-safety content, ask the D6 reviewer to check it, then set `"status": "reviewed"` and `"reviewedBy"`.
