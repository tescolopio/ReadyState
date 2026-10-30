# Scenario catalog

**Status:** draft for review, 2026-10-29. It extends [Scenario sets and severity](scenario-sets.md). Work items G5 and G14, with R2, R6, R7 and R8.

This maps every planned scenario across the four severity levels, and how the household changes each one. Nothing here is built yet. Statements about real events and agency guidance need source records (R1) before they reach a prompt or a debrief; §7 lists them.

## 1. How an exercise is assembled

An exercise is built from layers. The first two set the **world**: what happens, how bad and for how long. The rest set the **impact**: what that world means for this household.

| Layer | Set by | What it changes |
| --- | --- | --- |
| 1. Scenario | The participant | The kind of emergency, its stages and its real hazards |
| 2. Severity | The participant | Duration, how wide the damage is, how long help takes |
| 3. Where and when | Profile region and setting; season and onset (new) | Which hazards are likely, the weather, the time of day it starts |
| 4. Home | Profile home | Shelter options, utilities that fail, what breaks |
| 5. People | Profile people and needs | What's at stake, who needs help, who can help |
| 6. Pets | Profile pets | Food, water and shelter limits, and evacuation |
| 7. Supplies | Profile supplies, inventory check | Which gaps the story tests |

**The principle: severity sets the world; the household sets the stakes.** The same level 2 power outage is an inconvenience for Alex, a serious medical problem for Priya's mother on oxygen, and a heating problem for Sam's family. The world stays the same, so exercises are comparable, and the debrief explains why it mattered more for one household than another.

**How the layers reach the engine.** Layers 1–2 come from the scenario file (`data/scenarios/`). Layers 3–7 are the masked household baseline the engine already receives. What's new is **modifier rules**: on the device, the rules engine (`lib/rules/engine.ts`) picks the injects, look-fors and guidance that fit this scenario, level and household, and sends only those. It uses the same facts the inventory check already uses, such as `home.type`, `needs.kinds` and `pets.any`. This keeps the prompt within its token budget and makes the selection testable.

## 2. Severity, defined once

| | 1 Disruption | 2 Emergency | 3 Disaster | 4 Catastrophe |
| --- | --- | --- | --- | --- |
| **Duration** | Hours to 1 day | 2–4 days | 1–2 weeks | Weeks or more |
| **Area** | Neighborhood | Town or county | Region | Multi-state |
| **Services** | Working | Stretched; slow response | Overwhelmed; shelters open | Largely unavailable |
| **Help arrives** | As normal | Delayed hours | Delayed days | Delayed weeks |
| **Stores, fuel, cash** | Normal | Shortages of key items | Many closed | Mostly closed |
| **Exercise length** | 3–5 decisions | 5–8 | 8–12 | 10–14 |
| **Default** | Yes, for first exercises | Yes | Opt-in | Opt-in, with a confirmation |

The exercise clock (72 hours today, `TARGET_DURATION_HOURS`) becomes per level: about 24 hours at level 1, 72 hours at level 2, 7 days at level 3 and 14 days at level 4. Longer games need the history summaries (G6) first.

## 3. The catalog

**Realism labels, per level:**
- **Real:** based on real events.
- **Planning:** an official planning scenario, such as a USGS or FEMA exercise scenario.
- **Speculative:** plausible but unprecedented.
- **Fictional.**

Scenarios marked _(new)_ aren't in `SCENARIOS` today.

### Everyday

**Power outage**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | A neighborhood outage for an afternoon and evening | Real |
| 2 | A storm takes down lines; power is out for 3 days | Real |
| 3 | Widespread damage; power is out for 1–2 weeks | Real |
| 4 | Grid failure across several states for weeks (overlaps "Rare but real") | Planning |

Real hazards: no light, refrigeration, heating or cooling, devices, medical power or water pressure (on a well).

**Water contamination (boil-water notice)**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | A 24-hour boil notice after a main break | Real |
| 2 | A multi-day notice | Real |
| 3 | A "do not use" order: not even for washing | Real |
| 4 | — | — |

Real hazards: safe water for drinking, cooking, hygiene, infants and pets. On a private well, the scenario becomes testing after a flood rather than a notice.

**Heat wave**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | A hot weekend | Real |
| 2 | A week of extreme heat, with nights that don't cool | Real |
| 3 | Extreme heat plus power cuts: no air conditioning | Real |
| 4 | — | — |

Real hazards: heat illness, especially for older adults, infants, people on certain medications, people outdoors and pets. Also medication storage and cooling centers.

**Home fire** _(new)_

| Level | What happens | Label |
| --- | --- | --- |
| 1 | A small kitchen fire, put out | Real |
| 2 | A fire forces everyone out at night | Real |
| 3 | Displacement: the home is unlivable for weeks | Real |
| 4 | — | — |

Real hazards: escape routes, smoke alarms, a meeting point, documents, temporary housing. It's the most likely disaster most households face, and a gentle sample candidate at level 1.

### Regional

**Winter storm**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | Snow day: roads closed, power on | Real |
| 2 | Ice storm: power out for 2–3 days in freezing cold | Real |
| 3 | A week of outage in deep cold; pipes freeze; water fails | Real |
| 4 | A region unused to cold loses power and water for weeks | Real |

Real hazards: staying warm without indoor combustion, frozen pipes, CO, travel, checking on neighbors. Level 4 is Texas, February 2021 (to verify).

**Tornado**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | A warning, sheltering, no touchdown nearby | Real |
| 2 | A touchdown nearby: neighborhood damage, power out for days | Real |
| 3 | A direct hit: the home is damaged and the family is displaced | Real |
| 4 | An outbreak across a region: dozens of towns hit, help is weeks away | Real |

Real hazards: where to shelter, warnings at night, debris, gas leaks, finding family, insurance documents.

**Flood and flash flood**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | Street flooding; roads close | Real |
| 2 | A flash flood warning at night; water reaches the yard | Real |
| 3 | The home floods; evacuation by vehicle or rescue | Real |
| 4 | A regional river flood: weeks of displacement | Real |

Real hazards: never driving into water, when to leave, utilities, contaminated water, mold, documents.

**Hurricane**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | A tropical storm: wind and rain, a brief outage | Real |
| 2 | Category 1–2: an outage for days, trees down | Real |
| 3 | A major hurricane: evacuation orders, a week or more without services | Real |
| 4 | A catastrophic landfall, or inland flooding like Helene in western North Carolina (to verify) | Real |

Real hazards: leaving or staying, surge (coastal only), inland flooding, wind, long outages, generators. Inland locations get no surge and no landfall (eval finding 11).

**Wildfire and smoke**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | Smoke from a distant fire: bad air for days | Real |
| 2 | A fire nearby: evacuation warning, then a "be ready" order | Real |
| 3 | An evacuation order with little time; the route is congested | Real |
| 4 | A fast fire overruns the community | Real |

Real hazards: indoor air, go-bags, leaving early, animals and livestock, the route out. Level 4 is Paradise, 2018 and Lahaina, 2023 (to verify), handled with care.

**Earthquake**

| Level | What happens | Label |
| --- | --- | --- |
| 1 | Moderate shaking: things fall, no damage | Real |
| 2 | Strong shaking: some damage, utilities out for days | Real |
| 3 | A major quake: the region is damaged, aftershocks continue | Real |
| 4 | A major fault rupture: services out for weeks (USGS and FEMA planning scenarios such as ShakeOut and Cascadia, to verify) | Planning |

Real hazards: drop, cover and hold on, gas shutoff only if leaking, water, injuries, aftershocks, communication.

### Rare but real

| Scenario | Level 2 | Level 3 | Level 4 |
| --- | --- | --- | --- |
| **Long grid failure** (power outage at level 4) | — | — | Real hazards: as power outage, for weeks |
| **Solar storm** _(new)_ | Radio and GPS disruption | Regional grid damage | Multi-state transformer damage, for weeks (Planning) |
| **Pandemic** _(new)_ | Schools close, shortages | A household member is sick, isolation | Supply chains and care strained for months |
| **Hazardous materials release** _(new)_ | A shelter-in-place order for hours | Evacuation for days | — |
| **Dam or levee failure** _(new)_ | — | A flood with little warning | — |

Real hazards: sealing a room and listening for official updates (hazmat); isolation care and supplies (pandemic).

### Fictional and speculative

**When the systems turn** (pilot, see [Scenario sets §3](scenario-sets.md#3-pilot-storyline-when-the-systems-turn))

| Level | What happens | Label |
| --- | --- | --- |
| 1 | Payments down | Real |
| 2 | Grid takeover | Real |
| 3 | Cascade | Speculative |
| 4 | Judgment Day | Fictional |

**Candidates, pending decision (§8):**
- **Alien arrival:** sheltering in place, then evacuation, with a communications blackout and shortages.
- **Zombie outbreak:** the CDC's 2011 campaign framing (to verify). It covers quarantine, supplies and staying put.

Each must name its real hazards underneath, as the pilot does.

## 4. Where and when (layer 3)

**Region fit.** Each scenario level declares where it's plausible. The region in the profile, a state today and a county later (R8), sorts the library:

| Fit | Example | Behavior |
| --- | --- | --- |
| Likely here | Tornado in Oklahoma, wildfire in California | Shown first; "Common where you live" |
| Possible here | Winter storm in Texas, earthquake in Missouri | Shown; "Less common here; worth practicing" |
| Unlikely here | Hurricane landfall in Colorado | Shown last, with a note. The engine adapts: an inland hurricane becomes remnant flooding |
| Anywhere | Power outage, home fire, boil notice, the AI storyline | No label |

The first version uses a hand-written state table. FEMA's National Risk Index county scores replace it later (R8). Only the coarse region is ever used, never an address.

**Season.** Ask nothing new: use the current month and the region. A winter storm in July stays available but shifts to "practice for the coming season". Heat and cold change every scenario: an outage in January is a heating problem; in August it's a cooling problem.

**Onset (new):** time of day, and who's home. This is one of the biggest drivers of realism. A tornado at 3 a.m. is a warning problem; on a school day it's a reunification problem. Proposed:
- The engine picks the onset at random unless the participant chooses one.
- The profile gains an optional "usually away from home" for each person: work, school or none.
- It stays coarse, with no schedules or places, and only what the scenario needs: "two adults at work, one child at school".

## 5. The household (layers 4–7)

What each profile detail changes. Most rows already exist as profile facts. Rows marked _(new)_ need a profile addition.

### Home

| Detail | Changes |
| --- | --- |
| Apartment, upper floor | Elevators stop in an outage. Tornado shelter is an interior hallway on the lowest floor. Neighbors are close: help, or need |
| Mobile or manufactured home | Tornado and high wind: leave for a sturdy shelter before the storm; staying isn't an option. Flood: leave earlier |
| Basement | Tornado shelter. Flood risk, and sump pumps fail without power |
| Gas furnace (needs power) | No heat in an outage despite gas. CO risk if someone improvises |
| Electric heat or heat pump | No heat in an outage |
| Wood stove | Heat without power; fire and CO safety |
| Private well | No water when the power is out. Testing needed after a flood. Boil notices don't apply |
| Septic | Use limits in floods (existing guidance `sanitation.septic`) |
| Backup power and its rating | What can run, for how long (existing device runtime math). Generator safety |
| Rural, suburban or urban | Distance to help, road access, neighbors, how fast services return |
| Renter or owner _(new)_ | Who fixes what; renter's insurance; landlord contact |
| Vehicle and fuel _(new)_ | Whether evacuation is possible, phone charging, keeping a car's tank full before storms |

### People

| Detail | Changes |
| --- | --- |
| Infant | Formula and clean water, warmth, diapers. Heat and cold risk |
| Children | Reunification if at school, fear and routine, supervision during cleanup |
| Teen | Can help; may be away from home; has their own phone |
| Older adult | Heat and cold risk, medication, mobility, hearing (existing needs) |
| Pregnancy | Heat, travel, access to care (existing need) |
| Refrigerated medication | Cold chain, days of supply (existing math) |
| Powered medical device | Runtime on backup power. Severity depends on the device: a CPAP is a sleep problem, oxygen can be urgent. Eval finding 10: send the device type and how serious losing it is |
| Mobility or stairs | Evacuation, upper floors without elevators, shelter access |
| Hearing or vision | Getting warnings: sirens, alerts and broadcasts |
| Air-quality sensitivity | Smoke, mold, dust from cleanup |
| Household size | Supply math (existing), coordination, who's responsible for whom |
| Language _(new, optional)_ | Getting alerts and official information |

### Pets

| Detail | Changes |
| --- | --- |
| Dogs and cats | Food and water (existing math), carriers, shelters that turn pets away, stress and bolting |
| Giant breeds | Water and food at scale (Charlotte), transport |
| Birds | Heat, cold and air quality sensitivity |
| Horses and livestock | Evacuation needs a trailer and a place to go, and must start early. Water at scale |

### Supplies

Every inventory gap (F15) is a candidate inject at levels 2 and above: water short, no radio, medication days below the outage length. The rule from G1 still applies: setbacks are proportionate, and a gap is tested once, not punished repeatedly.

Scenarios add supplies the current list lacks _(new)_:
- Cash on hand and paper copies of key documents (the AI storyline, home fire, evacuation).
- Fire extinguisher and smoke alarms (home fire).
- N95 masks (smoke, cleanup, pandemic).
- Sandbags or flood barriers (flood).
- Vehicle fuel (evacuation).

## 6. Worked examples

The same world, three households.

**Tornado, level 2 (touchdown nearby, power out for days)**

| | Alex: Illinois apartment, 4th floor, alone | Sam: Ohio house with basement, 2 kids, large dog | Charlotte: NC house, CPAP, two Great Danes |
| --- | --- | --- | --- |
| Warning | Where to shelter with no basement: interior hallway, lowest floor | Basement; getting the anxious dog down the stairs | Sheltering with two 130 lb dogs; the CPAP stays behind |
| First hours | Elevator out; checking on neighbors | Gas smell from a damaged line? Shut-off decisions | Damage nearby; trees down across the road |
| First day | One flashlight, a power bank, 1 gallon of water: tested | Furnace off without power; the child with asthma and dust from cleanup | CPAP runtime on the power station; dog water at scale |
| Look-fors that apply | Shelter, light, communication | Shelter, gas safety, pets, breathing | Shelter, device power, pets, water |

**When the systems turn, level 1 (payments down)**

| | Alex | Sam | Priya: Texas townhouse, mother on oxygen |
| --- | --- | --- | --- |
| Tests | Cash on hand: almost none. Food: 2 days | Groceries for 4 and dog food without a card | Prescription refill needs payment; heat |
| Carries over | Keep some cash; know who you'd borrow from | A cash envelope; a paper contact list | A medication buffer; pharmacy payment options |

## 7. Sources to add before use

Each needs a record in `data/rules/sources.json` and a guidance or precedent record:
- Texas February 2021 winter storm: official after-action reports.
- Hurricane Helene's inland flooding, 2024. Partly covered by `noaa-inland-flooding` and `nhc-2025-season-lessons`.
- Camp Fire (2018) and Lahaina (2023): official reports.
- USGS ShakeOut scenario, and FEMA Cascadia Rising.
- Solar storm grid-risk assessments.
- Tornado sheltering for apartments and mobile homes. Partly covered by `tornado.shelter`.
- NFPA or USFA home-fire escape guidance.
- Hazmat shelter-in-place guidance (Ready.gov).
- CDC 2011 zombie preparedness campaign, if the zombie candidate goes ahead.
- The AI storyline precedents: the CrowdStrike outage (2024), the Ukraine grid attack (2015) and Colonial Pipeline (2021).

## 8. Decisions for review

| # | Question | Proposed |
| --- | --- | --- |
| 1 | Do levels change the clock length? | Yes: about 24 h, 72 h, 7 days, 14 days. Level 3 and above wait for G6 |
| 2 | Region fit: hide unlikely scenarios, or label them? | Label and sort, never hide |
| 3 | Onset: random, or chosen? | Random by default, with an optional chooser after the first exercise |
| 4 | New profile fields: away-from-home, vehicle, renter, language, cash and documents | All optional; add with the scenarios that need them |
| 5 | Home fire as a new everyday scenario, and as the gentle sample | Add it; keep the power outage as the sample for now |
| 6 | Which fictional candidates beyond the AI storyline | Decide after the AI pilot's eval |
| 7 | Build order | Power outage, winter storm and tornado at all levels first (most guidance and look-fors exist), then the AI storyline levels 1–2, then the rest |
