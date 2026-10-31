# Rules database

ReadyState's preparedness rules are **data**, kept in `data/rules/`. They aren't buried in code or prompts. Each rule names its sources and review status, so the Research team can add, correct and review rules (R1, R3, R5, D6) without touching the engine. The same files run the inventory check, the safety rules the model follows, the evaluation's safety checks and, once built, the look-fors.

| File | What it holds | Used by |
| --- | --- | --- |
| `sources.json` | The source registry: title, publisher, URL, license, date verified | Every rule's `sources` |
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

## Review status

Every rule has `status`: `draft` or `reviewed`. Drafts work, but haven't had the review D6 requires. A reviewed rule must name `reviewedBy`. **All rules are drafts today.** Each source's `verified` date is `null` until someone confirms the page says what the rule claims.

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
