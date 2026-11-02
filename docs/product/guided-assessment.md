# Simple and Guided assessment: water prototype

## Shared foundation

Simple remains the dependable quick-entry/editing experience. Guided is a
second presentation of the same household, `assessInventory` rules and chosen
action plan, not a second assessment engine. Both work offline without provider
keys or model requests. Neither implies a preparedness score.

The first increment implements one complete topic: water supplies. It does not
add communication, reunification, evacuation or transport questions/rules.
Existing rules remain draft guidance, not verified safety advice.

| Surface | Already exists | Wording/interaction in this prototype | New fact or rule? |
| --- | --- | --- | --- |
| People and pets | People count, age groups, optional pet kind/weight | Explain missing count/weight; optional existing People editor and Simple pet editing | No |
| Home | Water source and backup power | Existing well/power findings shown unchanged; home editing stays Simple | No |
| Stored water | `supplies.waterGallons`, local answer metadata | Plain-language question, optional counting helper, explicit zero and uncertainty choices | No |
| Food/other supplies and health | Existing optional topic forms | Dashboard links to Simple, preserving all answers/actions | No |
| Results | Category, evidence, sources, practical actions | Water-only slice of the existing `InventoryCheck`, with transparent assumptions | No |
| Topic journey | Local assessment progress | Mode, screen, helper draft and review fingerprint in local records | UI state only |

### Question to result trace

| Question | Choices | Rule affected | Guidance/result | Source |
| --- | --- | --- | --- | --- |
| Do you know how much drinking water you have stored? | Enter US gallons; help me count; none (zero); not sure; skip; prefer not to say | Existing `water` rule; identical quantity and metadata as Simple | Known amount supports the existing duration/shortfall finding; unassessed amount does not assert a water deficiency | Existing `water.supply`: CDC / Ready.gov |
| How many full containers of each labeled size do you have? | Nonnegative whole counts; leave unused rows blank; explicit confirmation before applying the total | No rule until Use counted amount; then existing `water` | Sum actual quantities, never suggested purchases; incomplete draft can remain separate while answer stays unknown | Capacity from the user's label; unit conversion below |
| Who is included? (existing editor) | Existing people and optional pet answers | Existing daily-water facts | No duration without people; weighed dogs/cats only; missing pet weights remain disclosed | Existing CDC / Ready.gov / AKC sources, still draft rules |

`0` means explicitly none. Not sure is `unknown`; skip/clearing is `skipped`;
prefer not to say is `withheld`. These do not assert absence. Not applicable
is not offered for household water. No missing answer hides independently
supported food, safety or other findings.

## Complete path

1. Switch **Simple assessment / Guided assessment** at any time. Answers and
   actions stay in the shared stores. Simple retains the last form topic.
2. The Guided dashboard offers Water supplies; other implemented topics
   explicitly open their Simple forms. Unimplemented planning areas are labeled
   as future work, not assumed gaps.
3. Enter an amount quickly, or open **Help me count**. Counts are whole numbers
   for full 500 mL, 1 litre, 1 US gallon and 5 US gallon containers. Text labels
   convey everything shown by the schematic SVGs.
4. The helper exposes each multiplication and the sum. One US gallon equals
   3.785411784 litres (exact US liquid gallon conversion). Counted water and
   guidance targets are visibly separate. Duplicate, partial and different-size
   containers must not be silently treated as full supported containers.
5. Applying a count requires confirmation that it is the full quantity the user
   wants recorded. Unused rows contribute zero only to the draft; an untouched
   helper never saves an answer of none. A confirmed zero is explicit.
6. Results explain the existing daily estimate, recorded people, included pet
   weights, unknown quantity/count limitations and sourced findings. Save a
   supported action using the same existing plan control. Historical chosen
   actions are not rewritten when answers change.
7. Mark reviewed and return later. **Reviewed** means the user looked at the
   topic, even with uncertainty; relevant answer/context changes invalidate it.
   Not started / Started / Needs a few answers / Needs review are progress labels, not risk
   ratings or readiness percentages.

Mode, screen, helper branch, container-count draft and reviewed-answer
fingerprint persist in local records and full encrypted backups. Applying
confirmation is intentionally transient and must be repeated after remount.
Older records/backups without Guided state retain the Simple default.
Household-only files intentionally carry answers/actions, not presentation
progress. No calculator draft, review label or new UI metadata enters provider
briefings. Applying a total changes only the already-supported water quantity.

## Prototype visual style and asset register

Use the existing ReadyState type, surface, action and focus tokens in both
visual styles. Choice buttons use text, pressed state and clear borders rather
than color alone. Sections stack on narrow screens; helpers expand inline.
No animation is introduced, so reduced-motion users lose no information.
Measurements remain HTML text, not baked into pictures.

| Asset | Source / location | License / attribution | Intended use | Review status |
| --- | --- | --- | --- | --- |
| Topic icons | Existing `lucide-react` dependency | ISC, plus MIT for Feather-derived icons; existing full dependency notices | Redundant navigation cues alongside text | Existing icon library; prototype accessibility checked, no safety meaning |
| Bottle schematic | Original `ContainerGraphic` SVG in `components/guided-water-assessment.tsx` | Repository AGPL-3.0-only; no external attribution | Recognize the count row, not product identification or scale | Text capacity is authoritative; prototype, user testing pending |
| Jug schematic | Same original SVG component | Repository AGPL-3.0-only; no external attribution | Same; no equipment connection or safety instruction | Same |
| Container arithmetic | HTML output and `lib/guided-water.ts` | Repository AGPL-3.0-only | User quantities, exposed multiplication/sum, unit conversion | Automated zero/mixed-unit/exact-gallon tests; not safety approval |
| Results card | Existing `InventoryCheck` | Repository AGPL-3.0-only | Same grouped categories/evidence/sources and saved-action behavior as Simple | Existing rules remain draft; shared parity tests |
| Unit conversion reference | NIST, [SP 811 Appendix B](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors) | Cited factual conversion; no copied illustration | US liquid gallons to litres, not imperial gallons | Exact conversion constant; thresholds still come from existing rules |
| Home/household illustrations | Not created or downloaded | License/attribution to be reviewed before adding | Future consistent welcoming artwork | Deferred until water usability feedback |
| Safety or product-label diagrams | Not created or downloaded | Authoritative source/technical review required | Future instruction only if reviewed | Deferred; generated imagery must not supply measurements or safety steps |

## Evaluation before expansion

With synthetic households and all model/external requests blocked:

- Compare equivalent Simple/Guided answers and findings, including zero, unknown,
  skipped, withheld and independently supported gaps.
- Count, abandon, switch modes, reload, apply, edit and clear. Check that helper
  drafts never overwrite known supplies until deliberately applied.
- Save an action, change its supporting answer and check current/historical
  meaning remains clear.
- Check topic/review progress, full-backup compatibility, keyboard focus,
  screen-reader labels, mobile wrapping and no dependence on graphics.
- Ask people whether they understand the question, count only water they have,
  leave uncertainty without pressure and choose a practical next step.

Browser automation is not human usability evidence. Physical phones, Safari,
Firefox and assistive-technology testing require their own recorded evidence.
Expand this topic and illustration library only after the walkthrough informs
what actually helps.
